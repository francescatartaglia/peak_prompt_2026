import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadHikeData } from "./data.js";
import { zoneConfig } from "./zones.js";
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

const state = {
  data: null,
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
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
};

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
      onChange: (vol) => state.audio.setVolume(vol),
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
  controls.dampingFactor = 0.055;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.minDistance = 0.5; // zoom dentro la sfera
  controls.maxDistance = 160; // zoom out ampio
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI;
  controls.target.set(0, 0, 0);

  // Vista iniziale: tutta la sfera (zona 1, raggio ~32) con margine
  frameWholeSphere(camera, controls, zoneConfig(1).radius);

  state.renderer = renderer;
  state.scene = scene;
  state.camera = camera;
  state.controls = controls;

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Mantieni solo il framing all'avvio; dopo l'utente naviga liberamente
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
  applyDensity(state.sphere, { radius: cfg.radius, coverage: cfg.coverage });
  applyShaderGrade(state.sphere, cfg.saturation, cfg.contrast, cfg.brightness ?? 1);
  applyMediaOpacity(state.sphere, 1);
  state.fluid?.setPalette({ a: cfg.bgA, b: cfg.bgB, c: cfg.bgC }, { duration: 0 });
  state.fluid?.setSpeed(cfg.fluidSpeed ?? 1);
  state.audio.setBpm(state.avgBpm);
  ensureHeartbeat();
  resumeActiveVideos(state.sphere);
  syncZoneAmbient();
  document.documentElement.style.setProperty("--accent", cfg.accent);
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
    radius: from.radius,
    coverage: from.coverage,
    saturation: from.saturation,
    contrast: from.contrast,
    brightness: from.brightness ?? 1,
    opacity: 1,
  };

  const applyProxy = () => {
    applyDensity(state.sphere, { radius: proxy.radius, coverage: proxy.coverage });
    applyShaderGrade(state.sphere, proxy.saturation, proxy.contrast, proxy.brightness);
    applyMediaOpacity(state.sphere, proxy.opacity);
  };

  if (typeof gsap === "undefined") {
    setActiveZoneMedia(state.sphere, zoneId);
    Object.assign(proxy, {
      radius: to.radius,
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
    proxy.radius = from.radius;
    proxy.coverage = from.coverage;
    proxy.saturation = from.saturation;
    proxy.contrast = from.contrast;
    proxy.brightness = from.brightness ?? 1;
    proxy.opacity = 0;
    applyProxy();
    resumeActiveVideos(state.sphere);
  });

  tl.to(proxy, {
    radius: to.radius,
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

function animate() {
  requestAnimationFrame(animate);
  const elapsed = state.clock.elapsedTime;
  const transport = state.audio.getSyncTime(elapsed);
  applyHeartbeat(state.sphere, transport, state.avgBpm);
  keepVideosPlaying(state.sphere);
  state.controls.update();
  state.renderer.render(state.scene, state.camera);
}

boot();
