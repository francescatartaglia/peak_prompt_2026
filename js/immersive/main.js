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
import { createCrtCursor } from "./crtCursor.js";
import { createFocusController } from "./focus.js";

const state = {
  data: null,
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  sphere: null,
  hud: null,
  mediaHover: null,
  mediaFocus: null,
  cursor: null,
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
  /** Media inspection / focus mode */
  isInspectingMedia: false,
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
  state.cursor = createCrtCursor({
    getCamera: () => state.camera,
    getMeshes: () => state.sphere?.activeMeshes || [],
    // Gate: diamond on ACCESS OK. Intro zoom after click: square only.
    isHotEnabled: () => {
      if (!state.started) return true;
      return state.navReady && !state.introTween;
    },
    isMediaHotEnabled: () =>
      state.started && state.navReady && !state.autoplayOn && !state.isInspectingMedia,
  });
  bindStartGate();

  try {
    state.data = await loadHikeData();
    state.fluid = createFluidBackground(document.getElementById("bg"));
    setupThree(canvas);

    const stats = state.data?.stats || {};
    const { min: bpmMin, max: bpmMax } = gateBpmRange(stats, state.data?.track || []);
    state.hud = createHudSidebar(document.getElementById("hud-root"), {
      track: state.data.track || [],
      startZone: 1,
      soundVol: state.ambient.getVolume(),
      heartVol: state.audio.getVolume(),
      title: "PEAK PROMPT",
      report: {
        examId: "CT-2026-991",
        series: "3D CARDIAC RECON",
        patientId: "HK-8842",
        patientName: "FRANCESCA TARTAGLIA",
        scanDate: stats.start ? formatGateScanDate(stats.start) : "02 OCT 2026",
        bpmMin,
        bpmMax,
        kv: 120,
        ma: 400,
        hikeType: "TREKKING",
        location: formatGateLocation(state.data?.title || state.data?.location),
        endBpm: gateEndBpm(stats, state.data?.track || []),
        duration: Number.isFinite(Number(stats.duration_seconds))
          ? formatGateDuration(stats.duration_seconds)
          : "02:32:59",
        distance: Number.isFinite(Number(stats.distance_km))
          ? formatGateDistance(stats.distance_km)
          : "3.31 KM",
      },
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
        isEnabled: () =>
          state.started &&
          state.navReady &&
          !state.autoplayOn &&
          !state.isInspectingMedia,
      });
    }

    const captionEl = document.getElementById("autoplay-caption");
    const placeCaption = () => {
      if (!captionEl?.classList.contains("is-on")) return;
      const layout = state.isInspectingMedia
        ? state.mediaFocus?.layoutCaption?.()
        : state.autoplay?.layoutCaption?.();
      if (!layout) return;
      captionEl.style.transform = "none";
      captionEl.style.left = `${Math.round(layout.left)}px`;
      captionEl.style.top = `${Math.round(layout.top)}px`;
    };

    state.mediaFocus = createFocusController({
      camera: state.camera,
      controls: state.controls,
      scene: state.scene,
      getMeshes: () => state.sphere?.activeMeshes || [],
      getSphereRadius: () => state.sphere?.radius || SPHERE_RADIUS,
      getSphereGroup: () => state.sphere?.group || null,
      isEnabled: () =>
        state.started && state.navReady && !state.autoplayOn && !state.mediaFocus?.animating,
      onInspectChange: (on) => {
        state.isInspectingMedia = on;
        if (on) {
          state.mediaHover?.hide?.();
          state.cursor?.reset?.();
        }
      },
      onCaption: (lines) => {
        if (!captionEl) return;
        if (!lines) {
          captionEl.classList.remove("is-on");
          captionEl.innerHTML = "";
          captionEl.setAttribute("aria-hidden", "true");
          return;
        }
        captionEl.innerHTML = lines
          .map(() => `<div class="text-morph crt-text"></div>`)
          .join("");
        captionEl.classList.add("crt-text", "crt-text--soft", "is-on");
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
    });
    state.mediaFocus.bind(canvas);

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
          .map(() => `<div class="text-morph crt-text"></div>`)
          .join("");
        captionEl.classList.add("crt-text", "crt-text--soft");
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

function gateScrambleCount(text) {
  return [...String(text ?? "")].filter((ch) => /[A-Za-z0-9]/.test(ch)).length;
}

/** Lock timing so lines of different length finish together. */
function gateSyncMorphOpts(text, targetMs = 3200) {
  const n = Math.max(1, gateScrambleCount(text));
  const lock = Math.max(28, targetMs / n);
  return {
    slowLock: lock,
    fastLock: lock * 0.82,
    scrambleMs: 28,
    startDelay: 0,
    fastFrom: -1,
  };
}

function formatGateDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function formatGateDistance(km) {
  const n = Number(km);
  if (!Number.isFinite(n)) return "3.31 KM";
  return `${n.toFixed(2)} KM`;
}

/** Compact English LOCATION from hike title / explicit location. */
function formatGateLocation(raw) {
  const fallback = "FALZAREGO · LAGAZUOI";
  const s = String(raw || "").trim();
  if (!s) return fallback;
  const parts = s
    .split(/\s*[-–—]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const short = (name) =>
      String(name)
        .replace(/^(pian|rifugio|forcella)\s+/i, "")
        .trim();
    return `${short(parts[0])} · ${short(parts[parts.length - 1])}`.toUpperCase();
  }
  return s.toUpperCase();
}

/** BPM at hike end (last track sample). */
function gateEndBpm(stats, track) {
  for (let i = (track || []).length - 1; i >= 0; i -= 1) {
    const bpm = Number(track[i]?.bpm);
    if (Number.isFinite(bpm) && bpm > 0) return Math.round(bpm);
  }
  const avg = Number(stats?.hr_avg);
  if (Number.isFinite(avg)) return Math.round(avg);
  return 111;
}

function formatGateScanDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "02 OCT 2026";
  const months = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ];
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mon = months[d.getUTCMonth()] || "OCT";
  const yyyy = d.getUTCFullYear();
  return `${dd} ${mon} ${yyyy}`;
}

function gateBpmRange(stats, track) {
  let min = Number(stats?.hr_min);
  let max = Number(stats?.hr_max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    const bpms = (track || [])
      .map((p) => Number(p?.bpm))
      .filter((v) => Number.isFinite(v) && v > 0);
    if (bpms.length) {
      min = Math.min(...bpms);
      max = Math.max(...bpms);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    // Fallback: recap cardiaco Apple Health (campioni HR)
    return { min: 87, max: 184 };
  }
  return { min: Math.round(min), max: Math.round(max) };
}

/** Sync corner meta da GPX (hike_viz) + recap cardiaco. */
function applyGateHikeStats() {
  const stats = state.data?.stats || {};
  const track = state.data?.track || [];

  const duration = Number.isFinite(Number(stats.duration_seconds))
    ? formatGateDuration(stats.duration_seconds)
    : "02:32:59";
  const distance = Number.isFinite(Number(stats.distance_km))
    ? formatGateDistance(stats.distance_km)
    : "3.31 KM";
  const { min: bpmMin, max: bpmMax } = gateBpmRange(stats, track);
  const scanDate = stats.start
    ? formatGateScanDate(stats.start)
    : "02 OCT 2026";

  const location = formatGateLocation(state.data?.title || state.data?.location);
  const endBpm = gateEndBpm(stats, track);
  const durEl = document.querySelector("[data-gate-duration]");
  const distEl = document.querySelector("[data-gate-distance]");
  const bpmEl = document.querySelector("[data-gate-bpm]");
  const pulseEl = document.querySelector("[data-gate-pulse]");
  const scanEl = document.querySelector("[data-gate-scan]");
  const locEl = document.querySelector("[data-gate-location]");
  if (durEl) durEl.dataset.final = `DURATION: ${duration}`;
  if (distEl) distEl.dataset.final = `DISTANCE: ${distance}`;
  if (bpmEl) bpmEl.dataset.final = `BPM RANGE: ${bpmMin} - ${bpmMax} BPM`;
  if (pulseEl) pulseEl.dataset.final = `PEAK PULSE: ${endBpm} BPM`;
  if (scanEl) scanEl.dataset.final = `SCAN DATE: ${scanDate}`;
  if (locEl) locEl.dataset.final = `LOCATION: ${location}`;
}

/** Splash: titolo → ACCESS → overlay DICOM 4 angoli (morph). */
function bindStartGate() {
  const gate = document.getElementById("gate");
  const btn = document.getElementById("gate-start");
  const title = document.getElementById("gate-title");
  const corners = gate ? [...gate.querySelectorAll(".gate-corner")] : [];
  if (!btn || !gate || gate.dataset.bound === "1") return;
  gate.dataset.bound = "1";

  const fullText =
    title?.getAttribute("aria-label") ||
    title?.textContent?.trim() ||
    "EVERY PEAK HAS ITS OWN BEAT";
  const ctaText =
    (btn.getAttribute("aria-label") || btn.textContent || "").trim() ||
    "[ACCESS CARDIAC REPORT]";

  btn.textContent = "";
  btn.style.minWidth = `${ctaText.length}ch`;

  const metaLines = corners.flatMap((corner) => [
    ...corner.querySelectorAll("[data-gate-line]"),
  ]);
  metaLines.forEach((line) => {
    line.dataset.final = (line.textContent || "").trim();
    line.textContent = "";
    line.style.minWidth = `${(line.dataset.final || "").length}ch`;
  });

  const runSequence = async () => {
    // 1) Titolo — leggerissimo fade-in mentre inizia a comporsi
    if (title) {
      title.classList.add("is-in");
      await gateMorph(title, fullText, {
        slowLock: 160,
        fastLock: 108,
        scrambleMs: 26,
        fastFrom: fullText.indexOf("ITS OWN"),
      });
    }

    // 2) Info DICOM — leggero fade-in mentre iniziano a comporsi
    await new Promise((r) => setTimeout(r, 300));
    applyGateHikeStats();
    metaLines.forEach((line) => {
      const finalText = line.dataset.final || "";
      line.style.minWidth = `${finalText.length}ch`;
    });
    corners.forEach((corner) => corner.classList.add("is-in"));

    const INFO_MORPH_MS = 3400;
    await Promise.all(
      metaLines.map((line) => {
        const text = line.dataset.final || "";
        return gateMorph(line, text, gateSyncMorphOpts(text, INFO_MORPH_MS));
      })
    );

    // 3) ACCESS — leggerissimo fade-in mentre inizia a comporsi
    await new Promise((r) => setTimeout(r, 280));
    btn.classList.add("is-in");
    await gateMorph(btn, ctaText, {
      slowLock: 152,
      fastLock: 112,
      scrambleMs: 26,
      startDelay: 64,
    });
    await new Promise((r) => setTimeout(r, 160));
    btn.classList.add("is-pulse");
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
    btn.blur();
    // Leave ACCESS diamond → square for exploration
    state.cursor?.reset?.();

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

  // Receive focus without needing an extra click after ACCESS
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Immersive sphere view");

  // Vista iniziale: tutta la sfera (raggio fisso) con margine
  frameWholeSphere(camera, controls, SPHERE_RADIUS);

  state.renderer = renderer;
  state.scene = scene;
  state.camera = camera;
  state.controls = controls;

  // Zoom subito dopo l’intro (senza dover cliccare prima la canvas)
  const _zoomOffset = new THREE.Vector3();
  window.addEventListener(
    "wheel",
    (e) => {
      if (!state.navReady || !controls.enabled) return;
      if (state.autoplayOn || state.isInspectingMedia) return;
      if (state.mediaFocus?.animating) return;
      if (
        e.target?.closest?.(
          'input, textarea, select, button, .hud, .hud-zone-slider, .hud-h-slider, .hud-track, [role="slider"]'
        )
      ) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      _zoomOffset.copy(camera.position).sub(controls.target);
      const dist = _zoomOffset.length();
      if (dist < 1e-6) return;

      // deltaY > 0 → zoom out (lontano dal target)
      const factor = Math.exp(0.0018 * (controls.zoomSpeed || 1) * e.deltaY);
      const next = THREE.MathUtils.clamp(
        dist * factor,
        controls.minDistance,
        controls.maxDistance
      );
      _zoomOffset.multiplyScalar(next / dist);
      camera.position.copy(controls.target).add(_zoomOffset);
      controls.update();
    },
    { passive: false, capture: true }
  );

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
  const canvas = state.renderer?.domElement;
  if (!controls || !camera) return;

  const R = SPHERE_RADIUS;
  const maxDist = Math.max(R * 2.9, frameDistance(R, camera, 1.45));

  camera.up.set(0, 1, 0);
  controls.enabled = true;
  controls.enableZoom = true;
  controls.enableRotate = true;
  controls.enablePan = false;
  controls.minDistance = 1.5;
  controls.maxDistance = maxDist;
  controls.target.set(0, 0, 0);
  controls.update();
  state.navReady = true;

  // Drop focus from ACCESS so wheel/drag work immediately
  try {
    document.activeElement?.blur?.();
  } catch {
    /* ignore */
  }
  if (canvas) {
    requestAnimationFrame(() => {
      try {
        canvas.focus({ preventScroll: true });
      } catch {
        canvas.focus?.();
      }
    });
  }
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
    state.cursor?.reset?.();
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
  if (state.isInspectingMedia) void state.mediaFocus?.unfocus();

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

  if (on && state.isInspectingMedia) {
    await state.mediaFocus?.unfocus();
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
  const inspecting = state.isInspectingMedia;
  const approaching = !!state.mediaFocus?.isApproaching;

  if (state.sphere?.group && !state.autoplayOn && !inspecting) {
    state.sphere.group.rotation.y += delta * sphereSpinRate;
  }
  // During approach: spin frozen (inspecting) but media keep contracting
  applyHeartbeat(state.sphere, transport, state.avgBpm, {
    frozen: inspecting && !approaching,
  });
  if (state.started) keepVideosPlaying(state.sphere);

  if (state.navReady && state.controls?.enabled && !state.autoplayOn && !inspecting) {
    state.controls.update();
  } else if (!state.navReady && state.controls && !state.introTween) {
    state.camera.lookAt(state.controls.target);
  }

  if (!state.autoplayOn && !inspecting) state.mediaHover?.tick?.();
  else if (state.autoplayOn || inspecting) state.placeCaption?.();

  state.renderer.render(state.scene, state.camera);
}

boot();
