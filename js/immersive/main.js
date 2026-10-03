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
} from "./sphere.js";
import { createZoneSlider } from "./slider.js";

const state = {
  data: null,
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  sphere: null,
  slider: null,
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
      onAudioToggle: async (btn) => {
        if (state.audio.enabled) {
          state.audio.stop();
          btn.classList.remove("is-live");
        } else {
          state.audio.setBpm(state.avgBpm);
          state.audio.setIntensity(zoneConfig(state.zone).audio);
          await state.audio.start(state.clock.elapsedTime);
          resumeActiveVideos(state.sphere);
          btn.classList.add("is-live");
        }
      },
    });

    // Sblocca video muti al primo gesto
    const unlock = () => {
      resumeActiveVideos(state.sphere);
      canvas.removeEventListener("pointerdown", unlock);
    };
    canvas.addEventListener("pointerdown", unlock);

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

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 300);
  camera.position.set(0, 10, 52);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.minDistance = 0.4;
  controls.maxDistance = 100;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI;
  controls.target.set(0, 0, 0);
  controls.update();

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

function applyZoneInstant(zoneId) {
  const zone = state.data.zones[zoneId];
  const cfg = zoneConfig(zoneId);
  state.zone = zoneId;
  state.avgBpm = zone.avgBpm;

  setActiveZoneMedia(state.sphere, zoneId);
  state.sphere.pulseDepth = cfg.pulseDepth;
  state.sphere.groupPulse = cfg.groupPulse;
  applyDensity(state.sphere, { radius: cfg.radius, coverage: cfg.coverage });
  applyShaderGrade(state.sphere, cfg.saturation, cfg.contrast);
  applyMediaOpacity(state.sphere, 1);
  state.fluid?.setPalette({ a: cfg.bgA, b: cfg.bgB, c: cfg.bgC });
  state.audio.setBpm(state.avgBpm);
  state.audio.setIntensity(cfg.audio);
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
  state.audio.setIntensity(to.audio);
  state.fluid?.setPalette({ a: to.bgA, b: to.bgB, c: to.bgC });
  document.documentElement.style.setProperty("--accent", to.accent);

  const proxy = {
    radius: from.radius,
    coverage: from.coverage,
    saturation: from.saturation,
    contrast: from.contrast,
    opacity: 1,
  };

  const applyProxy = () => {
    applyDensity(state.sphere, { radius: proxy.radius, coverage: proxy.coverage });
    applyShaderGrade(state.sphere, proxy.saturation, proxy.contrast);
    applyMediaOpacity(state.sphere, proxy.opacity);
  };

  if (typeof gsap === "undefined") {
    setActiveZoneMedia(state.sphere, zoneId);
    Object.assign(proxy, {
      radius: to.radius,
      coverage: to.coverage,
      saturation: to.saturation,
      contrast: to.contrast,
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
    proxy.opacity = 0;
    applyProxy();
    resumeActiveVideos(state.sphere);
  });

  tl.to(proxy, {
    radius: to.radius,
    coverage: to.coverage,
    saturation: to.saturation,
    contrast: to.contrast,
    opacity: 1,
    duration: 1.25,
    ease: "power2.inOut",
    onUpdate: applyProxy,
  });
}

function animate() {
  requestAnimationFrame(animate);
  const transport = state.audio.getSyncTime(state.clock.elapsedTime);
  applyHeartbeat(state.sphere, transport, state.avgBpm);
  state.controls.update();
  state.renderer.render(state.scene, state.camera);
}

boot();
