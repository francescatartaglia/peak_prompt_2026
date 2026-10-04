import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadHikeData } from "./data.js";
import { zoneConfig, SPHERE_RADIUS } from "./zones.js";
import { createFluidBackground } from "./fluidBackground.js";
import { createHeartbeatAudio } from "./audio.js";
import {
  createImmersiveSphere,
  setActiveZoneMedia,
  applyDensity,
  applyShaderGrade,
  applyMediaOpacity,
  applyHeartbeat,
  resumeActiveVideos,
  keepVideosPlaying,
} from "./sphere.js";
import { createZoneAmbient } from "./zoneAmbient.js";
import { createHudSidebar } from "./hudSidebar.js";
import { createMediaHover } from "./mediaHover.js";
import { morphTextInPlace } from "./textMorph.js";
import { createAutoplayController, buildChronoPlaylist } from "./autoplay.js";

const state = {
  data: null,
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  sphere: null,
  hud: null,
  mediaHover: null,
  autoplay: null,
  ambient: createZoneAmbient(),
  fluid: null,
  audio: createHeartbeatAudio(),
  clock: new THREE.Clock(),
  zone: 1,
  avgBpm: 118,
  zoneTween: null,
  introTween: null,
  /** Dopo l’intro: OrbitControls attivi */
  navReady: false,
  /** Dopo click su Start: audio + intro zoom */
  started: false,
  /** Slideshow autoplay attivo */
  autoplayOn: false,
  /** Risolto quando sfera + scena sono pronti */
  ready: null,
};

/** Fine intro: camera vicino al centro. */
const INTRO_CENTER_DIST = 2.5;

async function boot() {
  const canvas = document.getElementById("c");
  const bootEl = document.getElementById("boot");

  // Digita il titolo appena la pagina carica (non aspetta i media)
  let resolveReady;
  state.ready = new Promise((r) => {
    resolveReady = r;
  });
  bindStartGate();

  try {
    state.data = await loadHikeData();
    state.fluid = createFluidBackground(document.getElementById("bg"));
    setupThree(canvas);

    state.hud = createHudSidebar(document.getElementById("hud-root"), {
      track: state.data.track || [],
      startZone: 1,
      soundVol: state.ambient.getVolume(),
      heartVol: state.audio.getVolume(),
      title: "PEAK PROMPT",
      onZoneChange: (zone) => {
        if (state.autoplayOn) return;
        transitionToZone(zone);
      },
      onSoundChange: (vol) => {
        state.ambient.setVolume(vol);
        // In autoplay regola anche la clip audio corrente
        state.autoplay?.setClipVolume?.(vol);
      },
      onHeartChange: (vol) => {
        state.audio.setVolume(vol);
        if (state.started) ensureHeartbeat();
      },
      onAutoplayChange: (on) => {
        void setAutoplay(on);
      },
      onTrackSeek: (trackIndex) => {
        state.autoplay?.seekToTrackIndex?.(trackIndex);
      },
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && state.started) resumeActiveVideos(state.sphere);
    });

    const capped = {
      ...state.data,
      zones: {
        1: { ...state.data.zones[1], media: state.data.zones[1].media.slice(0, 52) },
        2: { ...state.data.zones[2], media: state.data.zones[2].media.slice(0, 40) },
        3: state.data.zones[3],
        4: state.data.zones[4],
      },
    };

    state.sphere = await createImmersiveSphere(capped, {
      maxPerZone: 52,
      onProgress: (done, total) => {
        bootEl.dataset.progress = String(Math.round((done / total) * 100));
      },
    });
    state.scene.add(state.sphere.group);

    const hoverRoot = document.getElementById("media-hover-root");
    if (hoverRoot) {
      state.mediaHover = createMediaHover(hoverRoot, {
        camera: state.camera,
        domElement: canvas,
        getMeshes: () => state.sphere?.activeMeshes || [],
        isEnabled: () => state.started && state.navReady && !state.autoplayOn,
      });
    }

    const captionEl = document.getElementById("autoplay-caption");
    const placeCaption = () => {
      if (!captionEl?.classList.contains("is-on")) return;
      const layout = state.autoplay?.layoutCaption?.();
      if (!layout) return;
      captionEl.style.transform = "none";
      captionEl.style.left = `${Math.round(layout.left)}px`;
      captionEl.style.top = `${Math.round(layout.top)}px`;
    };

    state.autoplay = createAutoplayController({
      camera: state.camera,
      controls: state.controls,
      scene: state.scene,
      getSphere: () => state.sphere,
      getPlaylist: () => buildChronoPlaylist(state.sphere, state.data),
      findMesh: (asset) => {
        const key = asset?.id || asset?.path;
        return (
          state.sphere?.allMeshes?.find(
            (m) => (m.userData?.asset?.id || m.userData?.asset?.path) === key
          ) || null
        );
      },
      onZone: (zoneId) => applyZoneForAutoplay(zoneId),
      onProgress: (idx) => state.hud?.setTrackProgress(idx),
      onCaption: (lines) => {
        if (!captionEl) return;
        if (!lines) {
          captionEl.classList.remove("is-on");
          captionEl.innerHTML = "";
          captionEl.setAttribute("aria-hidden", "true");
          return;
        }
        captionEl.innerHTML = lines
          .map(() => `<div class="text-morph"></div>`)
          .join("");
        captionEl.classList.add("is-on");
        captionEl.setAttribute("aria-hidden", "false");
        [...captionEl.children].forEach((node, i) => {
          morphTextInPlace(node, lines[i] ?? "", {
            click: false,
            slowLock: 42,
            fastLock: 30,
            scrambleMs: 18,
            startDelay: 36 + i * 48,
          });
        });
        placeCaption();
      },
      getSoundVolume: () => state.ambient.getVolume(),
      setSpinEnabled: (on) => {
        if (spinBoostTween) {
          spinBoostTween.kill();
          spinBoostTween = null;
        }
        const target = on ? SPHERE_SPIN : 0;
        if (typeof gsap === "undefined") {
          sphereSpinRate = target;
          return;
        }
        const proxy = { r: sphereSpinRate };
        spinBoostTween = gsap.to(proxy, {
          r: target,
          duration: on ? 0.75 : 1.2,
          ease: "power2.inOut",
          onUpdate: () => {
            sphereSpinRate = proxy.r;
          },
          onComplete: () => {
            sphereSpinRate = target;
            spinBoostTween = null;
          },
        });
      },
    });
    state.placeCaption = placeCaption;

    applyZoneInstant(1);
    for (const mesh of state.sphere.allMeshes) {
      mesh.userData.videoHandle?.pause();
    }
    // Vista esterna dietro al blur; niente audio / zoom finché non si clicca Start
    frameWholeSphere(state.camera, state.controls, SPHERE_RADIUS);

    bootEl.classList.remove("is-error");
    bootEl.classList.add("is-done");
    resolveReady?.();
  } catch (err) {
    console.error(err);
    bootEl.dataset.error = err?.message || String(err);
    bootEl.classList.add("is-error");
    resolveReady?.();
    return;
  }

  animate();
}

function gateMorph(el, text, opts = {}) {
  return morphTextInPlace(el, text, {
    click: false,
    ...opts,
  });
}

function formatGateDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function formatGateDistance(km) {
  const n = Number(km);
  if (!Number.isFinite(n)) return "3,31 KM";
  return `${n.toFixed(2).replace(".", ",")} KM`;
}

function gateReportLines() {
  const stats = state.data?.stats || {};
  const duration = Number.isFinite(Number(stats.duration_seconds))
    ? formatGateDuration(stats.duration_seconds)
    : "2:32:59";
  const distance = Number.isFinite(Number(stats.distance_km))
    ? formatGateDistance(stats.distance_km)
    : "3,31 KM";
  return [
    "NAME: PEAK PROMPT",
    "REPORT NUMBER: 01",
    "TYPE: TREKKING",
    `DURATION: ${duration}`,
    `DISTANCE: ${distance}`,
  ];
}

/** Splash: titolo → ACCESS → meta destra (morph in sequenza). */
function bindStartGate() {
  const gate = document.getElementById("gate");
  const btn = document.getElementById("gate-start");
  const title = document.getElementById("gate-title");
  const meta = document.getElementById("gate-meta");
  if (!btn || !gate || gate.dataset.bound === "1") return;
  gate.dataset.bound = "1";

  const fullText =
    title?.getAttribute("aria-label") ||
    title?.textContent?.trim() ||
    "EVERY PEAK HAS ITS OWN BEAT";
  const ctaText =
    (btn.getAttribute("aria-label") || btn.textContent || "").trim() ||
    "[ACCESS CARDIAC REPORT]";

  // Riserva layout sottotitoli vuoti finché non tocca a loro
  btn.textContent = "";
  btn.style.minWidth = `${ctaText.length}ch`;
  const metaLines = meta ? [...meta.querySelectorAll("[data-gate-line]")] : [];
  metaLines.forEach((line) => {
    line.dataset.final = (line.textContent || "").trim();
    line.textContent = "";
  });

  const runSequence = async () => {
    if (title) {
      await gateMorph(title, fullText, {
        slowLock: 58,
        fastLock: 36,
        scrambleMs: 14,
        fastFrom: fullText.indexOf("ITS OWN"),
      });
    }

    await new Promise((r) => setTimeout(r, 160));
    btn.classList.add("is-in");
    await gateMorph(btn, ctaText, {
      slowLock: 56,
      fastLock: 40,
      scrambleMs: 14,
      startDelay: 48,
    });

    await new Promise((r) => setTimeout(r, 280));
    const lines = gateReportLines();
    // Allinea nodi DOM alle righe (incluso NAME PEAK PROMPT)
    if (meta && metaLines.length !== lines.length) {
      meta.innerHTML = lines.map(() => `<div data-gate-line></div>`).join("");
      metaLines.length = 0;
      metaLines.push(...meta.querySelectorAll("[data-gate-line]"));
    }
    metaLines.forEach((line, i) => {
      line.dataset.final = lines[i] || "";
      line.textContent = "";
      line.style.minWidth = `${(lines[i] || "").length}ch`;
    });
    meta?.classList.add("is-in");
    await Promise.all(
      metaLines.map((line, i) =>
        gateMorph(line, line.dataset.final || lines[i] || "", {
          slowLock: 95,
          fastLock: 68,
          scrambleMs: 24,
          startDelay: 90 + i * 110,
        })
      )
    );
  };

  runSequence();

  const start = async () => {
    if (state.started) return;
    state.started = true;
    btn.classList.add("is-loading");
    if (state.ready) await state.ready;
    if (!state.sphere) {
      state.started = false;
      btn.classList.remove("is-loading");
      return;
    }
    gate.classList.add("is-gone");
    gate.setAttribute("aria-hidden", "true");
    document.body.classList.add("is-entered");
    btn.classList.remove("is-loading");

    await ensureHeartbeat();
    resumeActiveVideos(state.sphere);
    syncZoneAmbient();
    playIntroZoom();
  };

  btn.addEventListener("click", start);
}

function setupThree(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 400);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.enableZoom = true;
  controls.enableRotate = true;
  controls.zoomSpeed = 1.1;
  controls.rotateSpeed = 0.85;
  controls.minPolarAngle = 0.05;
  controls.maxPolarAngle = Math.PI - 0.05;
  controls.target.set(0, 0, 0);
  controls.minDistance = 1.5;
  controls.maxDistance = 400;
  controls.enabled = false;

  // Vista iniziale: tutta la sfera (raggio fisso) con margine
  frameWholeSphere(camera, controls, SPHERE_RADIUS);

  state.renderer = renderer;
  state.scene = scene;
  state.camera = camera;
  state.controls = controls;

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

/** Posiziona la camera fuori dalla sfera in modo da vederla intera. */
function frameWholeSphere(camera, controls, radius, padding = 1.45) {
  const distance = frameDistance(radius, camera, padding);
  const elev = distance * 0.22;
  const z = Math.sqrt(Math.max(distance * distance - elev * elev, 1));
  camera.position.set(0, elev, z);
  controls.target.set(0, 0, 0);
  controls.update();
}

/** Orbit + zoom: dentro/fuori la sfera, mentre lei continua a girare. */
function enableOrbitNav() {
  const controls = state.controls;
  const camera = state.camera;
  if (!controls || !camera) return;

  const R = SPHERE_RADIUS;
  const maxDist = Math.max(R * 2.9, frameDistance(R, camera, 1.45));

  controls.enabled = true;
  controls.enableZoom = true;
  controls.enableRotate = true;
  controls.enablePan = false;
  controls.minDistance = 1.5;
  controls.maxDistance = maxDist;
  controls.target.set(0, 0, 0);
  controls.update();
  state.navReady = true;
}

function frameDistance(radius, camera, padding = 1.45) {
  const fov = (camera.fov * Math.PI) / 180;
  const fitHeight = radius / Math.tan(fov / 2);
  const fitWidth = radius / (Math.tan(fov / 2) * Math.max(camera.aspect, 0.2));
  return Math.max(fitHeight, fitWidth) * padding;
}

/**
 * 2s sulla sfera intera (che gira) → zoom al centro → OrbitControls.
 */
function playIntroZoom() {
  const camera = state.camera;
  const controls = state.controls;
  const radius = SPHERE_RADIUS;
  if (!camera || !controls) return;

  if (state.introTween && typeof gsap !== "undefined") state.introTween.kill();

  state.navReady = false;
  controls.enabled = false;
  frameWholeSphere(camera, controls, radius);

  const from = camera.position.clone();
  const to = from.clone().normalize().multiplyScalar(INTRO_CENTER_DIST);
  const proxy = { t: 0 };

  const finishNav = () => {
    camera.position.copy(to);
    camera.lookAt(0, 0, 0);
    enableOrbitNav();
    state.introTween = null;
  };

  const runZoom = () => {
    if (typeof gsap === "undefined") {
      finishNav();
      return;
    }

    state.introTween = gsap.to(proxy, {
      t: 1,
      duration: 4.2,
      ease: "power2.inOut",
      onUpdate: () => {
        camera.position.lerpVectors(from, to, proxy.t);
        camera.lookAt(0, 0, 0);
      },
      onComplete: finishNav,
    });
  };

  // Attende 2s: sfera visibile e in rotazione, poi zoom verso il centro
  window.setTimeout(runZoom, 2000);
}

async function ensureHeartbeat() {
  state.audio.setBpm(state.avgBpm);
  if (!state.audio.enabled) {
    try {
      await state.audio.start(state.clock.elapsedTime);
    } catch {
      /* retry on next gesture */
    }
  }
}

/** Ambient per zona: tracce della zona in sequenza, loop, stessa altezza, crossfade. */
function syncZoneAmbient() {
  const tracks = state.data?.zones?.[state.zone]?.audio || [];
  if (!tracks.length) {
    state.ambient.stop();
    return;
  }

  const changed = state.ambient.setTracks(tracks);
  state.ambient.start({ force: changed });
}

function applyZoneInstant(zoneId) {
  const zone = state.data.zones[zoneId];
  const cfg = zoneConfig(zoneId);
  state.zone = zoneId;
  state.avgBpm = zone.avgBpm;

  setActiveZoneMedia(state.sphere, zoneId);
  state.sphere.pulseDepth = cfg.pulseDepth;
  state.sphere.groupPulse = cfg.groupPulse;
  applyDensity(state.sphere, { radius: SPHERE_RADIUS, coverage: cfg.coverage });
  applyShaderGrade(state.sphere, cfg.saturation, cfg.contrast, cfg.brightness ?? 1);
  applyMediaOpacity(state.sphere, 1);
  state.fluid?.setPalette({ a: cfg.bgA, b: cfg.bgB, c: cfg.bgC }, { duration: 0 });
  state.fluid?.setSpeed(cfg.fluidSpeed ?? 1);
  state.audio.setBpm(state.avgBpm);
  if (state.started) {
    ensureHeartbeat();
    resumeActiveVideos(state.sphere);
    syncZoneAmbient();
  }
  document.documentElement.style.setProperty("--accent", cfg.accent);
  document.documentElement.style.setProperty("--hud-accent", cfg.accent);
  state.hud?.setZone(zoneId, { silent: true });
}

/** Cambio zona durante autoplay: menù + sfondo + battito; sfera nascosta; no ambient. */
function applyZoneForAutoplay(zoneId) {
  const to = zoneConfig(zoneId);
  const zone = state.data.zones[zoneId];
  const changed = zoneId !== state.zone;

  state.zone = zoneId;
  state.avgBpm = zone.avgBpm || to.fallbackBpm;
  state.sphere.pulseDepth = to.pulseDepth;
  state.sphere.groupPulse = to.groupPulse;
  state.audio.setBpm(state.avgBpm);
  if (state.started) ensureHeartbeat();
  state.ambient.stop();
  state.fluid?.setPalette(
    { a: to.bgA, b: to.bgB, c: to.bgC },
    { duration: changed ? 0.9 : 0 }
  );
  state.fluid?.setSpeed(to.fluidSpeed ?? 1);
  document.documentElement.style.setProperty("--accent", to.accent);
  document.documentElement.style.setProperty("--hud-accent", to.accent);
  state.hud?.setZone(zoneId, { silent: true });

  // Aggiorna media attivi / grade ma non mostrare la sfera
  if (changed) {
    setActiveZoneMedia(state.sphere, zoneId);
    applyDensity(state.sphere, { radius: SPHERE_RADIUS, coverage: to.coverage });
  }
  applyShaderGrade(state.sphere, to.saturation, to.contrast, to.brightness ?? 1);
  if (state.sphere?.group) state.sphere.group.visible = false;
  for (const mesh of state.sphere?.allMeshes || []) {
    if (mesh.userData?.slideshowLock) continue;
    mesh.visible = false;
  }
}

/** Cambio zona: swap immagini + rotazione rapida (niente fade). */
function transitionToZone(zoneId) {
  if (state.autoplayOn) return;
  if (zoneId === state.zone) return;

  const to = zoneConfig(zoneId);
  const zone = state.data.zones[zoneId];

  if (state.zoneTween && typeof gsap !== "undefined") state.zoneTween.kill();
  state.zoneTween = null;

  state.zone = zoneId;
  state.avgBpm = zone.avgBpm;
  state.sphere.pulseDepth = to.pulseDepth;
  state.sphere.groupPulse = to.groupPulse;
  state.audio.setBpm(state.avgBpm);
  state.fluid?.setPalette({ a: to.bgA, b: to.bgB, c: to.bgC }, { duration: 1.35 });
  state.fluid?.setSpeed(to.fluidSpeed ?? 1);
  if (state.started) syncZoneAmbient();
  document.documentElement.style.setProperty("--accent", to.accent);
  document.documentElement.style.setProperty("--hud-accent", to.accent);
  state.hud?.setZone(zoneId, { silent: true });
  state.mediaHover?.hide?.();

  setActiveZoneMedia(state.sphere, zoneId);
  applyDensity(state.sphere, { radius: SPHERE_RADIUS, coverage: to.coverage });
  applyShaderGrade(state.sphere, to.saturation, to.contrast, to.brightness ?? 1);
  applyMediaOpacity(state.sphere, 1);
  resumeActiveVideos(state.sphere);

  // Burst di rotazione: le nuove immagini “passano” con lo spin
  boostSphereSpin(1.55, 0.85);
}

async function setAutoplay(on) {
  if (!state.started) {
    state.hud?.setAutoplay(false, { silent: true });
    return;
  }

  if (!state.navReady) {
    if (on) {
      const waitNav = async () => {
        while (!state.navReady && state.started) {
          await new Promise((r) => setTimeout(r, 80));
        }
        if (state.hud?.getAutoplay?.()) await setAutoplay(true);
      };
      void waitNav();
    }
    return;
  }

  if (on === state.autoplayOn) return;
  state.autoplayOn = on;
  state.mediaHover?.hide?.();

  if (on) {
    state.controls.enabled = false;
    // Fade ambient in parallelo all’ingresso slideshow
    void state.ambient.stop();
    // Non await: altrimenti non si può spegnere il toggle durante lo slideshow
    void state.autoplay?.start();
  } else {
    await state.autoplay?.stop();
    if (state.navReady) state.controls.enabled = true;
    syncZoneAmbient();
  }
}

/** Rotazione costante della sfera — mai interrotta. */
const SPHERE_SPIN = 0.14; // rad/s
let sphereSpinRate = SPHERE_SPIN;
let spinBoostTween = null;

function boostSphereSpin(peakRate, duration = 0.85) {
  if (typeof gsap === "undefined") {
    sphereSpinRate = SPHERE_SPIN;
    return;
  }
  if (spinBoostTween) spinBoostTween.kill();
  const proxy = { rate: Math.max(sphereSpinRate, SPHERE_SPIN) };
  spinBoostTween = gsap
    .timeline({
      onComplete: () => {
        sphereSpinRate = SPHERE_SPIN;
        spinBoostTween = null;
      },
    })
    .to(proxy, {
      rate: peakRate,
      duration: duration * 0.22,
      ease: "power3.out",
      onUpdate: () => {
        sphereSpinRate = proxy.rate;
      },
    })
    .to(proxy, {
      rate: SPHERE_SPIN,
      duration: duration * 0.78,
      ease: "power3.inOut",
      onUpdate: () => {
        sphereSpinRate = proxy.rate;
      },
    });
}

function animate() {
  requestAnimationFrame(animate);
  const delta = state.clock.getDelta();
  const elapsed = state.clock.elapsedTime;
  const transport = state.audio.getSyncTime(elapsed);

  if (state.sphere?.group && !state.autoplayOn) {
    state.sphere.group.rotation.y += delta * sphereSpinRate;
  }
  applyHeartbeat(state.sphere, transport, state.avgBpm);
  if (state.started) keepVideosPlaying(state.sphere);

  if (state.navReady && state.controls?.enabled && !state.autoplayOn) {
    state.controls.update();
  } else if (!state.navReady && state.controls && !state.introTween) {
    state.camera.lookAt(state.controls.target);
  }

  if (!state.autoplayOn) state.mediaHover?.tick?.();
  else state.placeCaption?.();

  state.renderer.render(state.scene, state.camera);
}

boot();
