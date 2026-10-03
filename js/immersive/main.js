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
import { createZoneSlider } from "./slider.js";
import { createVolumeSlider } from "./volumeSlider.js";
import { createZoneAmbient } from "./zoneAmbient.js";
import { createInsideControls } from "./insideControls.js";

const state = {
  data: null,
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  inside: null,
  sphere: null,
  slider: null,
  volumeSlider: null,
  ambientSlider: null,
  ambient: createZoneAmbient(),
  fluid: null,
  audio: createHeartbeatAudio(),
  clock: new THREE.Clock(),
  zone: 1,
  avgBpm: 118,
  zoneTween: null,
  introTween: null,
  /** Dopo l’intro: navigazione solo dentro la sfera */
  insideReady: false,
};

/**
 * Zoom interno:
 * - min ≈ centro (dezoom massimo)
 * - max ≈ appena sotto la parete (zoom verso le foto senza uscire)
 */
const INSIDE_CENTER_MIN = 0.15;
/** Quanto prima della parete si ferma lo zoom (unità mondo). */
const INSIDE_WALL_MARGIN = 14;

async function boot() {
  const canvas = document.getElementById("c");
  const bootEl = document.getElementById("boot");

  try {
    state.data = await loadHikeData();
    state.fluid = createFluidBackground(document.getElementById("bg"));
    setupThree(canvas);

    state.slider = createZoneSlider(document.getElementById("slider-root"), {
      startZone: 1,
      onChange: (zone) => transitionToZone(zone),
    });

    state.volumeSlider = createVolumeSlider(document.getElementById("volume-root"), {
      value: state.audio.getVolume(),
      label: "bpm",
      ariaLabel: "Volume battito",
      onChange: (vol) => {
        state.audio.setVolume(vol);
        ensureHeartbeat();
      },
    });

    state.ambientSlider = createVolumeSlider(document.getElementById("ambient-root"), {
      value: state.ambient.getVolume(),
      label: "snd",
      ariaLabel: "Volume audio zona",
      onChange: (vol) => state.ambient.setVolume(vol),
    });

    // Battito + ambient + video: avvio al load / gesto (policy browser)
    ensureHeartbeat();
    const unlock = () => {
      ensureHeartbeat();
      resumeActiveVideos(state.sphere);
      syncZoneAmbient();
    };
    window.addEventListener("pointerdown", unlock, { once: false });
    window.addEventListener("keydown", unlock, { once: true });
    window.addEventListener("touchstart", unlock, { once: true, passive: true });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) resumeActiveVideos(state.sphere);
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
    applyZoneInstant(1);
    resumeActiveVideos(state.sphere);

    bootEl.classList.remove("is-error");
    bootEl.classList.add("is-done");
    playIntroZoom();
  } catch (err) {
    console.error(err);
    bootEl.dataset.error = err?.message || String(err);
    bootEl.classList.add("is-error");
    return;
  }

  animate();
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
  controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI;
  controls.target.set(0, 0, 0);
  controls.minDistance = 0.5;
  controls.maxDistance = 400;
  controls.enabled = false;

  // Dentro: a riposo al centro; zoom solo verso la parete di fronte
  const inside = createInsideControls(camera, canvas, {
    getRadius: () => state.sphere?.radius ?? SPHERE_RADIUS,
    centerDistance: INSIDE_CENTER_MIN,
    wallMargin: INSIDE_WALL_MARGIN,
    zoomSpeed: 2.8,
    rotateSpeed: 0.0045,
  });
  inside.setEnabled(false);

  // Vista iniziale: tutta la sfera (raggio fisso) con margine
  frameWholeSphere(camera, controls, SPHERE_RADIUS);

  state.renderer = renderer;
  state.scene = scene;
  state.camera = camera;
  state.controls = controls;
  state.inside = inside;

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

/** Posiziona la camera fuori dalla sfera in modo da vederla intera. */
function frameWholeSphere(camera, controls, radius, padding = 1.45) {
  const fov = (camera.fov * Math.PI) / 180;
  const fitHeight = radius / Math.tan(fov / 2);
  const fitWidth = radius / (Math.tan(fov / 2) * camera.aspect);
  const distance = Math.max(fitHeight, fitWidth) * padding;

  // Leggera elevazione per leggere meglio la forma sferica
  const elev = distance * 0.22;
  const z = Math.sqrt(Math.max(distance * distance - elev * elev, 1));
  camera.position.set(0, elev, z);
  controls.target.set(0, 0, 0);
  controls.update();
}

/** Attiva navigazione interna: camera ferma al centro finché l’utente non zooma. */
function lockInsideSphere() {
  const camera = state.camera;
  const controls = state.controls;
  const inside = state.inside;
  if (!camera || !inside) return;

  controls.enabled = false;
  // Resta al centro; lo sguardo punta la parete che aveva di fronte nell’intro
  camera.position.setLength(INSIDE_CENTER_MIN);
  inside.setEnabled(true); // syncLookFromCamera: zoom=0 al centro
  state.insideReady = true;
}

/**
 * 1s sulla sfera intera → lento zoom fino al centro → navigazione interna.
 */
function playIntroZoom() {
  const camera = state.camera;
  const controls = state.controls;
  const radius = SPHERE_RADIUS;
  if (!camera || !controls) return;

  if (state.introTween && typeof gsap !== "undefined") state.introTween.kill();

  state.insideReady = false;
  state.inside?.setEnabled(false);
  controls.enabled = false;
  controls.minDistance = 0.5;
  controls.maxDistance = 400;
  frameWholeSphere(camera, controls, radius);

  const from = camera.position.clone();
  const toDist = Math.max(INSIDE_CENTER_MIN + 0.15, 0.5);
  const to = from.clone().normalize().multiplyScalar(toDist);
  const proxy = { t: 0 };

  const finishInside = () => {
    camera.position.copy(to);
    // Solo a fine intro: navigazione con sguardo alle pareti
    lockInsideSphere();
    state.introTween = null;
  };

  const runZoom = () => {
    if (typeof gsap === "undefined") {
      finishInside();
      return;
    }

    state.introTween = gsap.to(proxy, {
      t: 1,
      duration: 4.2,
      ease: "power2.inOut",
      onUpdate: () => {
        // Come prima: avvicinamento al centro guardando sempre il centro
        camera.position.lerpVectors(from, to, proxy.t);
        camera.lookAt(0, 0, 0);
      },
      onComplete: finishInside,
    });
  };

  window.setTimeout(runZoom, 1000);
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
  const root = document.getElementById("ambient-root");
  const tracks = state.data?.zones?.[state.zone]?.audio || [];
  const hasAudio = tracks.length > 0;
  root?.classList.toggle("is-active", hasAudio);

  if (!hasAudio) {
    state.ambient.stop();
    return;
  }

  const changed = state.ambient.setTracks(tracks);
  // force solo al cambio zona/playlist; i gesti successivi non ripartono da capo
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
  ensureHeartbeat();
  resumeActiveVideos(state.sphere);
  syncZoneAmbient();
  document.documentElement.style.setProperty("--accent", cfg.accent);
  if (state.insideReady) state.inside?.update();
}

/** Transizione fluida — la camera non viene mai resettata. */
function transitionToZone(zoneId) {
  if (zoneId === state.zone) return;

  const from = zoneConfig(state.zone);
  const to = zoneConfig(zoneId);
  const zone = state.data.zones[zoneId];

  if (state.zoneTween && typeof gsap !== "undefined") state.zoneTween.kill();

  state.zone = zoneId;
  state.avgBpm = zone.avgBpm;
  state.sphere.pulseDepth = to.pulseDepth;
  state.sphere.groupPulse = to.groupPulse;
  state.audio.setBpm(state.avgBpm);
  // Crossfade cromatico ~1s: fonde i colori, poi lascia spazio alla zona
  state.fluid?.setPalette({ a: to.bgA, b: to.bgB, c: to.bgC }, { duration: 1.85 });
  state.fluid?.setSpeed(to.fluidSpeed ?? 1);
  syncZoneAmbient();
  document.documentElement.style.setProperty("--accent", to.accent);

  const proxy = {
    coverage: from.coverage,
    saturation: from.saturation,
    contrast: from.contrast,
    brightness: from.brightness ?? 1,
    opacity: 1,
  };

  const applyProxy = () => {
    // Raggio sfera sempre fisso: anima solo la dimensione delle immagini
    applyDensity(state.sphere, { radius: SPHERE_RADIUS, coverage: proxy.coverage });
    applyShaderGrade(state.sphere, proxy.saturation, proxy.contrast, proxy.brightness);
    applyMediaOpacity(state.sphere, proxy.opacity);
    if (state.insideReady) state.inside?.update();
  };

  if (typeof gsap === "undefined") {
    setActiveZoneMedia(state.sphere, zoneId);
    Object.assign(proxy, {
      coverage: to.coverage,
      saturation: to.saturation,
      contrast: to.contrast,
      brightness: to.brightness ?? 1,
      opacity: 1,
    });
    applyProxy();
    return;
  }

  const tl = gsap.timeline({
    onComplete: () => {
      state.zoneTween = null;
    },
  });
  state.zoneTween = tl;

  tl.to(proxy, {
    opacity: 0,
    duration: 0.32,
    ease: "power1.inOut",
    onUpdate: () => applyMediaOpacity(state.sphere, proxy.opacity),
  });

  tl.add(() => {
    setActiveZoneMedia(state.sphere, zoneId);
    proxy.coverage = from.coverage;
    proxy.saturation = from.saturation;
    proxy.contrast = from.contrast;
    proxy.brightness = from.brightness ?? 1;
    proxy.opacity = 0;
    applyProxy();
    resumeActiveVideos(state.sphere);
  });

  tl.to(proxy, {
    coverage: to.coverage,
    saturation: to.saturation,
    contrast: to.contrast,
    brightness: to.brightness ?? 1,
    opacity: 1,
    duration: 1.25,
    ease: "power2.inOut",
    onUpdate: applyProxy,
  });
}

/** Rotazione continua della sfera (immagini + wireframe). */
const SPHERE_SPIN = 0.14; // rad/s

function animate() {
  requestAnimationFrame(animate);
  const delta = state.clock.getDelta();
  const elapsed = state.clock.elapsedTime;
  const transport = state.audio.getSyncTime(elapsed);
  if (state.sphere?.group) {
    state.sphere.group.rotation.y += delta * SPHERE_SPIN;
  }
  applyHeartbeat(state.sphere, transport, state.avgBpm);
  keepVideosPlaying(state.sphere);
  if (state.insideReady && state.inside?.enabled) {
    state.inside.update();
  } else if (!state.insideReady && state.controls && !state.introTween) {
    state.camera.lookAt(state.controls.target);
  }
  state.renderer.render(state.scene, state.camera);
}

boot();
