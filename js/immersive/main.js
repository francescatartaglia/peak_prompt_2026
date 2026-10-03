import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadHikeData, zoneList } from "./data.js";
import { createHeartbeatAudio } from "./audio.js";
import { createZoneTorus, applyPulse, applySpin } from "./torus.js";
import { createFocusController } from "./focus.js";

const state = {
  data: null,
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  zones: {},
  activeZone: 1,
  audio: createHeartbeatAudio(),
  focus: null,
  clock: new THREE.Clock(),
  dragDist: 0,
};

async function boot() {
  const canvas = document.getElementById("c");
  const status = document.getElementById("load-status");

  try {
    status.textContent = "Loading hike data…";
    state.data = await loadHikeData();
    document.getElementById("title").textContent = shortTitle(state.data.title);

    setupThree(canvas);
    state.focus = createFocusController({
      camera: state.camera,
      controls: state.controls,
    });
    wireUi();
    wirePointer(canvas);

    status.textContent = "Building toroidal zones…";
    await buildZones((done, total) => {
      status.textContent = `Placing media… ${done}/${total}`;
    });

    setActiveZone(1, { silent: true });
    document.getElementById("boot").classList.add("is-done");
    animate();
  } catch (err) {
    console.error(err);
    status.textContent = err.message || "Failed to start";
  }
}

function shortTitle(title) {
  if (!title) return "Rifugio Lagazuoi";
  if (title.includes("Lagazuoi")) return "Rifugio Lagazuoi";
  return title.split(" - ")[0];
}

function setupThree(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#f6f4ef");
  scene.fog = new THREE.Fog("#f6f4ef", 55, 120);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 300);
  camera.position.set(0, 16, 42);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 12;
  controls.maxDistance = 85;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.target.set(0, 0, 0);
  controls.update();

  // Soft fill so tinted unlit media still read well on light bg
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));

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

async function buildZones(onProgress) {
  const list = zoneList(state.data);
  let done = 0;
  for (const zone of list) {
    const maxMedia = zone.id === 1 ? 96 : 120;
    const torus = await createZoneTorus(zone, { maxMedia });
    state.scene.add(torus.group);
    state.zones[zone.id] = torus;
    done += 1;
    onProgress?.(done, list.length);
  }
}

function setActiveZone(id, { silent = false } = {}) {
  const switchZone = () => {
    state.activeZone = id;
    Object.values(state.zones).forEach((z) => {
      z.group.visible = z.id === id;
    });

    const zone = state.data.zones[id];
    state.audio.setBpm(zone.avgBpm);

    document.querySelectorAll("[data-zone]").forEach((btn) => {
      btn.classList.toggle("is-active", Number(btn.dataset.zone) === id);
    });
    document.getElementById("zone-label").textContent = zone.label;
    document.getElementById("zone-range").textContent = zone.range;
    document.getElementById("zone-bpm").textContent = `${Math.round(zone.avgBpm)} BPM`;
    document.getElementById("zone-count").textContent = `${Math.min(zone.media.length, id === 1 ? 96 : 120)} media`;

    if (!silent) {
      // Gentle camera reset outward for the toroid
      gsap?.to?.(state.camera.position, {
        x: 0,
        y: 16,
        z: 42,
        duration: 0.9,
        ease: "power2.inOut",
        onUpdate: () => state.controls.update(),
      });
      state.controls.target.set(0, 0, 0);
    }
  };

  if (state.focus?.focused) {
    state.focus.unfocus().then(switchZone);
  } else {
    switchZone();
  }
}

function wireUi() {
  const nav = document.getElementById("zone-nav");
  nav.innerHTML = "";
  zoneList(state.data).forEach((zone) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "zone-btn";
    btn.dataset.zone = String(zone.id);
    btn.style.setProperty("--zone", zone.tint);
    btn.innerHTML = `<span class="dot"></span><span>${zone.label}</span><small>${Math.round(zone.avgBpm)} bpm</small>`;
    btn.addEventListener("click", () => setActiveZone(zone.id));
    nav.appendChild(btn);
  });

  const audioBtn = document.getElementById("btn-audio");
  audioBtn.addEventListener("click", async () => {
    if (state.audio.enabled) {
      state.audio.stop();
      audioBtn.classList.remove("is-live");
      audioBtn.textContent = "Enable heartbeat";
    } else {
      state.audio.setBpm(state.data.zones[state.activeZone].avgBpm);
      await state.audio.start();
      audioBtn.classList.add("is-live");
      audioBtn.textContent = "Mute heartbeat";
    }
  });
}

function wirePointer(canvas) {
  let downX = 0;
  let downY = 0;

  canvas.addEventListener("pointerdown", (e) => {
    downX = e.clientX;
    downY = e.clientY;
    state.dragDist = 0;
  });

  canvas.addEventListener("pointermove", (e) => {
    state.dragDist = Math.hypot(e.clientX - downX, e.clientY - downY);
  });

  canvas.addEventListener("pointerup", (e) => {
    if (state.dragDist > 6 || state.focus.animating) return;
    const zone = state.zones[state.activeZone];
    if (!zone) return;

    const hit = state.focus.pick(zone.mediaMeshes, e);

    if (state.focus.focused) {
      if (hit && hit === state.focus.focused) return;
      if (hit) {
        // Swap to another asset
        state.focus.focus(hit);
      } else {
        // Click background → return home
        state.focus.unfocus();
      }
      return;
    }

    if (hit) state.focus.focus(hit);
  });
}

function animate() {
  requestAnimationFrame(animate);
  const delta = state.clock.getDelta();
  const elapsed = state.clock.elapsedTime;
  const active = state.zones[state.activeZone];
  const focused = state.focus?.focused || null;

  applySpin(active, delta, Boolean(focused));
  const beat = applyPulse(active, elapsed, focused);
  document.documentElement.style.setProperty("--beat", String(beat));

  state.controls.update();
  state.renderer.render(state.scene, state.camera);
}

boot();
