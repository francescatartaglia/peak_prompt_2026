/**
 * Autoplay: fermo-immagine — zoom, sfera nascosta, una media al centro
 * (foto/video/audio), slideshow cronologico, sync zona + battito.
 */

import * as THREE from "three";
import { createMediaMaterial } from "./mediaShader.js";
import { mediaHoverLines, displayMediaName } from "./mediaHover.js";
import { ZONE_ORDER, SPHERE_RADIUS } from "./zones.js";
import { bendGeometry, flattenGeometry } from "./sphere.js";

const IMAGE_DWELL_MS = 3400;
const VIDEO_DWELL_MS = 5400;
const FADE_MS = 0.35;

function assetKey(asset) {
  return asset?.id || asset?.path || "";
}

function sleep(ms, shouldAbort) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      if (shouldAbort?.()) {
        resolve(false);
        return;
      }
      if (performance.now() - t0 >= ms) {
        resolve(true);
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function setOpacity(mesh, opacity) {
  const mat = mesh?.material;
  if (!mat?.uniforms?.uOpacity) return;
  mat.uniforms.uOpacity.value = Math.min(1, Math.max(0, opacity));
  const fade = opacity < 0.999;
  mat.transparent = fade;
  mat.depthWrite = !fade || opacity > 0.85;
}

function fadeOpacity(mesh, from, to, duration = FADE_MS) {
  return new Promise((resolve) => {
    if (!mesh) {
      resolve();
      return;
    }
    if (typeof gsap === "undefined") {
      setOpacity(mesh, to);
      resolve();
      return;
    }
    const proxy = { o: from };
    setOpacity(mesh, from);
    gsap.to(proxy, {
      o: to,
      duration,
      ease: "power1.inOut",
      onUpdate: () => setOpacity(mesh, proxy.o),
      onComplete: resolve,
    });
  });
}

function makeAudioTexture(asset) {
  const w = 512;
  const h = 360;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, w, h);

  // Cornice TAC
  ctx.strokeStyle = "rgba(210,220,230,0.55)";
  ctx.lineWidth = 3;
  ctx.strokeRect(18, 18, w - 36, h - 36);

  // Waveform stilizzata
  const bars = 36;
  const baseY = h * 0.52;
  ctx.fillStyle = "rgba(200,210,220,0.72)";
  for (let i = 0; i < bars; i += 1) {
    const t = i / (bars - 1);
    const n = Math.abs(Math.sin(t * 17.2) * 0.55 + Math.sin(t * 41.0) * 0.35);
    const bh = 18 + n * 90;
    const x = 48 + t * (w - 96);
    ctx.fillRect(x, baseY - bh * 0.5, 6, bh);
  }

  ctx.fillStyle = "rgba(230,235,240,0.9)";
  ctx.font = "600 28px VT323, monospace";
  ctx.textAlign = "center";
  ctx.fillText("AUDIO", w / 2, 64);
  ctx.font = "400 22px VT323, monospace";
  ctx.fillStyle = "rgba(180,190,200,0.85)";
  const label = displayMediaName(asset).slice(0, 28);
  ctx.fillText(label, w / 2, h - 48);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createAudioCard(asset) {
  const tex = makeAudioTexture(asset);
  const baseW = 2.8;
  const baseH = 2.0;
  const geo = new THREE.PlaneGeometry(baseW, baseH, 1, 1);
  const mat = createMediaMaterial(tex, {
    saturation: 0.35,
    contrast: 1.35,
    brightness: 1.15,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.asset = asset;
  mesh.userData.baseW = baseW;
  mesh.userData.baseH = baseH;
  mesh.userData.mediaScale = 1;
  mesh.userData.isAudioCard = true;
  mesh.userData.homePosition = new THREE.Vector3(0, 0, 0);
  mesh.userData.homeQuaternion = new THREE.Quaternion();
  mesh.userData.slideshowParent = null;
  mesh.visible = false;
  return mesh;
}

function probeAudioDuration(path) {
  return new Promise((resolve) => {
    const el = new Audio();
    el.preload = "metadata";
    const done = (sec) => {
      el.removeAttribute("src");
      el.load?.();
      resolve(sec);
    };
    el.addEventListener("loadedmetadata", () => {
      const d = Number(el.duration);
      done(Number.isFinite(d) && d > 0 ? d : 4);
    });
    el.addEventListener("error", () => done(4));
    el.src = path;
  });
}

/**
 * @param {{
 *  camera: THREE.PerspectiveCamera,
 *  controls: any,
 *  scene: THREE.Scene,
 *  getSphere: () => any,
 *  getPlaylist: () => any[],
 *  findMesh: (asset) => THREE.Mesh | null,
 *  onZone: (zoneId: number) => void,
 *  onProgress: (trackIndex: number) => void,
 *  onCaption: (lines: string[] | null, mesh?: THREE.Mesh | null) => void,
 *  setSpinEnabled: (on: boolean) => void,
 *  getSoundVolume?: () => number,
 * }} opts
 */
export function createAutoplayController(opts) {
  const {
    camera,
    controls,
    scene,
    getSphere,
    getPlaylist,
    findMesh,
    onZone,
    onProgress,
    onCaption,
    setSpinEnabled,
    getSoundVolume,
  } = opts;

  let running = false;
  let generation = 0;
  let currentMesh = null;
  let savedCam = null;
  let activeClip = null;
  /** Indice playlist richiesto dallo scrub della mappa (null = nessuno). */
  let seekIndex = null;
  const audioCards = new Map();

  const _fwd = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _pos = new THREE.Vector3();
  const _v = new THREE.Vector3();

  function aborting(gen) {
    return !running || gen !== generation;
  }

  function interrupted(gen) {
    return aborting(gen) || seekIndex != null;
  }

  function playlistIndexForTrack(trackIdx, list) {
    if (!list?.length) return 0;
    let bestI = 0;
    let bestD = Infinity;
    let hasTrack = false;
    for (let i = 0; i < list.length; i += 1) {
      const ti = Number(list[i].trackIndex);
      if (!Number.isFinite(ti)) continue;
      hasTrack = true;
      const d = Math.abs(ti - trackIdx);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    if (hasTrack) return bestI;
    // Fallback: mappa indice GPX → posizione in playlist
    const t = Math.min(1, Math.max(0, trackIdx / 150));
    return Math.round(t * (list.length - 1));
  }

  function seekToTrackIndex(trackIdx) {
    if (!running) return;
    const list = getPlaylist?.() || [];
    if (!list.length) return;
    const idx = Math.max(0, Math.round(Number(trackIdx) || 0));
    seekIndex = playlistIndexForTrack(idx, list);
    stopClip();
    const asset = list[seekIndex];
    if (asset && Number.isFinite(Number(asset.trackIndex))) {
      onProgress?.(Number(asset.trackIndex));
    } else {
      onProgress?.(idx);
    }
  }

  function hideSphere() {
    const sphere = getSphere();
    if (sphere?.group) sphere.group.visible = false;
    for (const mesh of sphere?.allMeshes || []) {
      if (mesh === currentMesh) continue;
      mesh.visible = false;
      mesh.userData.videoHandle?.pause?.();
    }
  }

  function showSphere() {
    const sphere = getSphere();
    if (sphere?.group) sphere.group.visible = true;
    for (const mesh of sphere?.allMeshes || []) {
      const on = (sphere.activeMeshes || []).includes(mesh);
      mesh.visible = on;
      setOpacity(mesh, 1);
    }
  }

  function clipGainFromSlider(vol) {
    const v = Math.min(1, Math.max(0, Number(vol) || 0));
    // Un filo sopra lo slider SOUND, ma 0 resta muto
    return Math.min(1, v * 1.75);
  }

  function setClipVolume(vol) {
    if (!activeClip) return;
    try {
      activeClip.volume = clipGainFromSlider(vol);
    } catch {
      /* ignore */
    }
  }

  function stopClip() {
    if (!activeClip) return;
    try {
      activeClip.pause();
      activeClip.removeAttribute("src");
      activeClip.load?.();
    } catch {
      /* ignore */
    }
    activeClip = null;
  }

  /** Piano 2D piatto: usa baseH (non la scala curva della sfera). */
  function framePose(mesh) {
    camera.updateMatrixWorld(true);
    camera.getWorldDirection(_fwd);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);

    const dist = 5.35;
    _pos.copy(camera.position).addScaledVector(_fwd, dist).addScaledVector(_up, 0.06);

    const baseH = mesh?.userData?.baseH || 2.2;
    const desiredH = 2.15;
    const scale = desiredH / Math.max(baseH, 0.05);

    return {
      position: _pos.clone(),
      quaternion: camera.quaternion.clone(),
      scale,
    };
  }

  function flattenForSlideshow(mesh) {
    if (!mesh?.geometry?.userData?.flat) return;
    flattenGeometry(mesh.geometry);
    mesh.userData.slideshowFlat = true;
  }

  function restoreSphereBend(mesh) {
    if (!mesh?.userData?.slideshowFlat) return;
    const s = mesh.userData.mediaScale || 1;
    bendGeometry(mesh.geometry, SPHERE_RADIUS, s);
    mesh.userData.slideshowFlat = false;
  }

  async function parkCamera(gen) {
    if (aborting(gen)) return;
    const targetDist = 4.2;
    const from = camera.position.clone();
    const dir =
      from.lengthSq() > 1e-6 ? from.clone().normalize() : new THREE.Vector3(0, 0.12, 1);
    const to = dir.multiplyScalar(targetDist);

    if (typeof gsap === "undefined") {
      camera.position.copy(to);
      camera.lookAt(0, 0, 0);
      return;
    }

    const proxy = { t: 0 };
    await new Promise((resolve) => {
      gsap.to(proxy, {
        t: 1,
        duration: 1.05,
        ease: "power2.inOut",
        onUpdate: () => {
          if (aborting(gen)) return;
          camera.position.lerpVectors(from, to, proxy.t);
          camera.lookAt(0, 0, 0);
        },
        onComplete: resolve,
      });
    });
  }

  function ensureAudioCard(asset) {
    const key = assetKey(asset);
    let mesh = audioCards.get(key);
    if (mesh) return mesh;
    mesh = createAudioCard(asset);
    audioCards.set(key, mesh);
    return mesh;
  }

  function resolveMesh(asset) {
    if (asset?.kind === "audio") return ensureAudioCard(asset);
    return findMesh?.(asset) || null;
  }

  function pullToScene(mesh) {
    if (!mesh || mesh.parent === scene) return;
    const parent = mesh.parent;
    mesh.userData.slideshowParent = parent;
    mesh.userData.slideshowLock = true;
    parent?.updateMatrixWorld?.(true);
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    if (parent) {
      mesh.matrixWorld.decompose(worldPos, worldQuat, worldScale);
      parent.remove(mesh);
    }
    scene.add(mesh);
    if (parent) {
      mesh.position.copy(worldPos);
      mesh.quaternion.copy(worldQuat);
      mesh.scale.copy(worldScale);
    }
    mesh.visible = true;
  }

  function shelveMesh(mesh) {
    if (!mesh) return;
    stopClip();
    if (mesh.userData?.isAudioCard) {
      if (mesh.parent) mesh.parent.remove(mesh);
      setOpacity(mesh, 1);
      mesh.visible = false;
      mesh.userData.slideshowLock = false;
      return;
    }
    restoreSphereBend(mesh);
    const parent = mesh.userData.slideshowParent || getSphere()?.group;
    const homePos = mesh.userData.homePosition?.clone?.() || new THREE.Vector3();
    const homeQuat = mesh.userData.homeQuaternion?.clone?.() || new THREE.Quaternion();
    if (mesh.parent) mesh.parent.remove(mesh);
    if (parent) {
      parent.add(mesh);
      mesh.position.copy(homePos);
      mesh.quaternion.copy(homeQuat);
      mesh.scale.setScalar(1);
    }
    setOpacity(mesh, 1);
    mesh.visible = false;
    mesh.userData.slideshowLock = false;
    mesh.userData.slideshowParent = null;
    mesh.userData.videoHandle?.pause?.();
  }

  async function presentMesh(mesh, gen) {
    pullToScene(mesh);
    flattenForSlideshow(mesh);
    const pose = framePose(mesh);
    mesh.position.copy(pose.position);
    mesh.quaternion.copy(pose.quaternion);
    mesh.scale.setScalar(pose.scale);
    mesh.visible = true;
    setOpacity(mesh, 0);
    await fadeOpacity(mesh, 0, 1, FADE_MS);
    if (interrupted(gen)) return;
  }

  async function playAudioSlide(asset, gen) {
    stopClip();
    const el = new Audio(asset.path);
    el.preload = "auto";
    el.volume = clipGainFromSlider(getSoundVolume?.() ?? 0.5);
    activeClip = el;

    let durationSec = Number(asset.duration);
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      durationSec = await probeAudioDuration(asset.path);
    }

    try {
      await el.play();
    } catch {
      /* autoplay policy / missing file */
    }

    const dwell = Math.min(24000, Math.max(2200, durationSec * 1000 + 350));
    const ok = await sleep(dwell, () => interrupted(gen));
    stopClip();
    return ok;
  }

  /** Caption a destra della foto, allineata al bordo alto. */
  function layoutCaption() {
    if (!currentMesh || !running) return null;
    camera.updateMatrixWorld(true);
    currentMesh.updateMatrixWorld(true);

    const geo = currentMesh.geometry;
    const w0 = geo?.userData?.width || currentMesh.userData.baseW || 2.2;
    const h0 = geo?.userData?.height || currentMesh.userData.baseH || 2.2;
    const hw = w0 * 0.5;
    const hh = h0 * 0.5;

    // Angoli del piano locale (foto piatta in slideshow)
    const locals = [
      [-hw, hh, 0],
      [hw, hh, 0],
      [-hw, -hh, 0],
      [hw, -hh, 0],
    ];

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    for (const [lx, ly, lz] of locals) {
      _v.set(lx, ly, lz).applyMatrix4(currentMesh.matrixWorld).project(camera);
      if (_v.z < -1 || _v.z > 1) continue;
      const sx = (_v.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-_v.y * 0.5 + 0.5) * window.innerHeight;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;

    const gap = 16;
    const left = maxX + gap;
    const top = minY;
    // Evita che esca dal viewport a destra
    const maxLeft = window.innerWidth - 12;
    return {
      left: Math.min(left, maxLeft),
      top: Math.max(8, top),
    };
  }

  async function showItem(asset, gen, { first = false } = {}) {
    stopClip();
    if (currentMesh) {
      onCaption?.(null, null);
      await fadeOpacity(currentMesh, 1, 0, FADE_MS);
      shelveMesh(currentMesh);
      currentMesh = null;
      if (interrupted(gen)) return;
    }

    const zoneId = Number(asset.zone) || 1;
    onZone?.(zoneId);
    onProgress?.(Number.isFinite(asset.trackIndex) ? asset.trackIndex : 0);
    hideSphere();

    await sleep(32, () => interrupted(gen));
    if (interrupted(gen)) return;

    const mesh = resolveMesh(asset);
    if (!mesh) {
      onCaption?.(mediaHoverLines(asset), null);
      hideSphere();
      await sleep(IMAGE_DWELL_MS * 0.55, () => interrupted(gen));
      return;
    }

    hideSphere();
    currentMesh = mesh;
    await presentMesh(mesh, gen);
    if (interrupted(gen)) return;

    onCaption?.(mediaHoverLines(asset), mesh);

    if (asset.kind === "audio") {
      await playAudioSlide(asset, gen);
      return;
    }

    const vh = mesh.userData.videoHandle;
    if (vh?.video) {
      try {
        vh.video.currentTime = 0;
        vh.play?.();
      } catch {
        /* ignore */
      }
    }

    const dwell =
      asset.kind === "video"
        ? Math.min(VIDEO_DWELL_MS, Math.max(2800, (Number(asset.duration) || 5) * 1000))
        : IMAGE_DWELL_MS;
    await sleep(first ? dwell + 350 : dwell, () => interrupted(gen));
  }

  async function runLoop(gen) {
    const list = getPlaylist?.() || [];
    if (!list.length) {
      running = false;
      return;
    }

    savedCam = {
      position: camera.position.clone(),
      target: controls?.target?.clone?.() || new THREE.Vector3(),
    };

    if (controls) controls.enabled = false;
    setSpinEnabled?.(false);
    onCaption?.(null, null);
    seekIndex = null;

    await parkCamera(gen);
    if (aborting(gen)) return;
    hideSphere();

    let i = 0;
    let first = true;
    while (!aborting(gen)) {
      if (seekIndex != null) {
        i = seekIndex;
        seekIndex = null;
        first = false;
      }
      await showItem(list[i], gen, { first });
      first = false;
      if (aborting(gen)) break;
      if (seekIndex != null) continue;
      i = (i + 1) % list.length;
      await sleep(120, () => interrupted(gen));
    }
  }

  async function stop() {
    running = false;
    generation += 1;
    seekIndex = null;
    stopClip();
    onCaption?.(null, null);

    if (currentMesh) {
      const m = currentMesh;
      currentMesh = null;
      shelveMesh(m);
    }

    showSphere();
    setSpinEnabled?.(true);

    if (savedCam && camera) {
      camera.position.copy(savedCam.position);
      camera.lookAt(savedCam.target);
      if (controls) {
        controls.target.copy(savedCam.target);
        controls.update();
        controls.enabled = true;
      }
    } else if (controls) {
      controls.enabled = true;
    }
    savedCam = null;
    onProgress?.(-1);
  }

  return {
    get active() {
      return running;
    },
    get currentMesh() {
      return currentMesh;
    },
    layoutCaption,
    setClipVolume,
    seekToTrackIndex,
    async start() {
      if (running) return;
      running = true;
      const gen = ++generation;
      try {
        await runLoop(gen);
      } finally {
        if (gen === generation && running) running = false;
      }
    },
    stop,
  };
}

/** Playlist cronologica: foto, video e audio. */
export function buildChronoPlaylist(sphere, data) {
  const seen = new Set();
  const unique = [];

  const push = (a) => {
    if (!a) return;
    const k = assetKey(a);
    if (!k || seen.has(k)) return;
    seen.add(k);
    unique.push(a);
  };

  for (const m of sphere?.allMeshes || []) push(m.userData?.asset);

  if (data?.zones) {
    for (const id of ZONE_ORDER) {
      for (const a of data.zones[id]?.audio || []) push(a);
    }
  }

  unique.sort((a, b) => String(a.time).localeCompare(String(b.time)));
  return unique;
}
