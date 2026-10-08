/**
 * Autoplay: fermo-immagine — zoom, sfera nascosta, una media al centro
 * (foto/video/audio), slideshow cronologico, sync zona + battito.
 */

import * as THREE from "three";
import { mediaHoverLines } from "./mediaHover.js";
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
  if (!mat) return;
  const o = Math.min(1, Math.max(0, opacity));
  if (mat.uniforms?.uOpacity) {
    mat.uniforms.uOpacity.value = o;
    const fade = o < 0.999;
    mat.transparent = fade;
    mat.depthWrite = (!fade || o > 0.85) && o > 0.05;
    return;
  }
  mat.transparent = o < 0.999;
  mat.opacity = o;
  mat.depthWrite = o > 0.85;
}

function encodeMediaPath(path) {
  return String(path || "")
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

const LIVE_BARS = 96;

/**
 * Waveform live tipo memo vocale, centrata nello stesso riquadro
 * di una foto/video orizzontale (padding interno, sfondo trasparente).
 */
function drawLiveWaveform(canvas, history) {
  if (!canvas || !history?.length) return;
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d", { alpha: true });
  ctx.clearRect(0, 0, w, h);

  // Area utile centrata nel frame foto (margini laterali/verticali)
  const padX = w * 0.08;
  const padY = h * 0.22;
  const areaW = w - padX * 2;
  const areaH = h - padY * 2;
  const mid = h * 0.5;
  const n = history.length;
  const gap = 2;
  const slot = areaW / n;
  const barW = Math.max(1.5, slot - gap);
  const maxH = areaH * 0.48;

  for (let i = 0; i < n; i += 1) {
    const amp = Math.max(0.03, history[i]);
    const bh = amp * maxH;
    const x = padX + i * slot + gap * 0.5;
    const age = i / (n - 1);
    const a = 0.45 + age * 0.55;
    ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    ctx.fillRect(x, mid - bh, barW, bh * 2);
  }
}

function sampleAnalyserAmp(analyser, timeData) {
  analyser.getByteTimeDomainData(timeData);
  let sum = 0;
  for (let i = 0; i < timeData.length; i += 1) {
    const v = (timeData[i] - 128) / 128;
    sum += v * v;
  }
  // Gain percettivo per voci / ambienti deboli
  return Math.min(1, Math.sqrt(sum / timeData.length) * 3.8);
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

function createAudioCard(asset) {
  // Stesso footprint di una foto/video orizzontale tipica (aspect ~1.4)
  const baseH = 2.2;
  const baseW = baseH * 1.4;

  const canvas = document.createElement("canvas");
  canvas.width = 896;
  canvas.height = 640;
  const ctx = canvas.getContext("2d", { alpha: true });
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.premultiplyAlpha = true;
  tex.needsUpdate = true;

  const geo = new THREE.PlaneGeometry(baseW, baseH, 1, 1);
  geo.userData.width = baseW;
  geo.userData.height = baseH;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
    alphaTest: 0.02,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.asset = asset;
  mesh.userData.baseW = baseW;
  mesh.userData.baseH = baseH;
  mesh.userData.mediaScale = 1;
  mesh.userData.isAudioCard = true;
  mesh.userData.canvas = canvas;
  mesh.userData.texture = tex;
  mesh.userData.liveHistory = new Float32Array(LIVE_BARS).fill(0.04);
  mesh.userData.homePosition = new THREE.Vector3(0, 0, 0);
  mesh.userData.homeQuaternion = new THREE.Quaternion();
  mesh.userData.slideshowParent = null;
  mesh.renderOrder = 40;
  mesh.visible = false;
  drawLiveWaveform(canvas, mesh.userData.liveHistory);
  tex.needsUpdate = true;
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
  let activeGain = null;
  let activeAudioCtx = null;
  /** Indice playlist richiesto dallo scrub della mappa (null = nessuno). */
  let seekIndex = null;
  /** Cursore continuo sul GPX: il pallino non torna indietro tra media vicini. */
  let pathCursor = 0;
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
    const at =
      asset && Number.isFinite(Number(asset.trackIndex))
        ? Number(asset.trackIndex)
        : idx;
    pathCursor = at;
    onProgress?.(at);
  }

  function trackIndexOf(asset, fallback = 0) {
    const t = Number(asset?.trackIndex);
    return Number.isFinite(t) ? t : fallback;
  }

  /** Max trackIndex in playlist (per chiudere il path prima del wrap). */
  function maxTrackIndex(list) {
    let m = 0;
    for (const a of list || []) {
      const t = Number(a?.trackIndex);
      if (Number.isFinite(t) && t > m) m = t;
    }
    return m;
  }

  /**
   * Avanza il pallino in modo continuo da from→to lungo il GPX
   * durante la durata della slide (in relazione al media mostrato).
   */
  async function travelProgress(fromIdx, toIdx, durationMs, gen) {
    const a = Number(fromIdx);
    let b = Number(toIdx);
    if (!Number.isFinite(a)) return !interrupted(gen);
    if (!Number.isFinite(b)) b = a;
    // Sempre avanti lungo il percorso; se to ≤ from, piccolo avanzamento
    if (b <= a) b = a + 0.9;
    const dur = Math.max(200, durationMs);
    const t0 = performance.now();
    onProgress?.(a);
    while (!interrupted(gen)) {
      const u = Math.min(1, (performance.now() - t0) / dur);
      // Ease leggero in/out per fluidità, senza fermarsi
      const e = u * u * (3 - 2 * u);
      onProgress?.(a + (b - a) * e);
      if (u >= 1) break;
      await sleep(33, () => interrupted(gen));
    }
    if (!interrupted(gen)) {
      onProgress?.(b);
      pathCursor = b;
    }
    return !interrupted(gen);
  }

  function travelRangeFor(list, index) {
    const asset = list[index];
    const next = list[(index + 1) % list.length];
    const pathEnd = maxTrackIndex(list);
    const rawFrom = trackIndexOf(asset, 0);
    // Nuovo giro (pathCursor azzerato): riparti dal track del primo media
    const from =
      index === 0 && pathCursor < 1
        ? Math.max(0, rawFrom)
        : Math.max(pathCursor, rawFrom);
    let to = trackIndexOf(next, from);
    // Ultimo item: completa fino alla fine del GPX
    if (index >= list.length - 1) {
      to = Math.max(from, pathEnd);
    } else if (to + 5 < from) {
      to = Math.max(from, pathEnd);
    }
    if (to <= from) {
      // Più media sullo stesso punto GPX: avanza comunque un pezzo di path
      const remainItems = Math.max(1, list.length - index);
      const remainPath = Math.max(0.6, pathEnd - from);
      to = from + remainPath / remainItems;
    }
    return { from, to };
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
    const g = clipGainFromSlider(vol);
    if (activeGain) {
      try {
        activeGain.gain.value = g;
      } catch {
        /* ignore */
      }
    }
    if (activeClip) {
      try {
        activeClip.volume = 1;
      } catch {
        /* ignore */
      }
    }
  }

  function stopClip() {
    if (activeClip) {
      try {
        activeClip.pause();
        activeClip.removeAttribute("src");
        activeClip.load?.();
      } catch {
        /* ignore */
      }
    }
    activeClip = null;
    activeGain = null;
    if (activeAudioCtx) {
      const ctx = activeAudioCtx;
      activeAudioCtx = null;
      try {
        ctx.close();
      } catch {
        /* ignore */
      }
    }
  }

  /** Piano 2D piatto: usa baseH (non la scala curva della sfera). */
  function framePose(mesh) {
    camera.updateMatrixWorld(true);
    camera.getWorldDirection(_fwd);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);

    const dist = 5.35;
    _pos.copy(camera.position).addScaledVector(_fwd, dist).addScaledVector(_up, 0.06);

    const baseH = mesh?.userData?.baseH || 2.2;
    // Stessa scala a schermo di foto/video
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

  async function parkCamera(gen, duration = 1.45) {
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
        duration,
        ease: "power3.inOut",
        onUpdate: () => {
          if (aborting(gen)) return;
          camera.position.lerpVectors(from, to, proxy.t);
          camera.lookAt(0, 0, 0);
        },
        onComplete: resolve,
      });
    });
  }

  /** Fade-out morbido delle media sulla sfera prima dello slideshow. */
  async function fadeActiveSphere(fromOp, toOp, duration, gen) {
    const sphere = getSphere();
    const meshes = (sphere?.activeMeshes || []).filter((m) => m && m.visible);
    if (!meshes.length) return;
    for (const m of meshes) setOpacity(m, fromOp);

    if (typeof gsap === "undefined") {
      for (const m of meshes) setOpacity(m, toOp);
      return;
    }

    const proxy = { o: fromOp };
    await new Promise((resolve) => {
      gsap.to(proxy, {
        o: toOp,
        duration,
        ease: "power2.inOut",
        onUpdate: () => {
          if (aborting(gen)) return;
          for (const m of meshes) setOpacity(m, proxy.o);
        },
        onComplete: resolve,
      });
    });
  }

  async function enterAutoplay(gen) {
    // Camera + dissolvenza sfera in parallelo
    await Promise.all([
      parkCamera(gen, 1.5),
      fadeActiveSphere(1, 0, 1.35, gen),
    ]);
    if (aborting(gen)) return;
    hideSphere();
    // Opacità piene per quando si torna dalla slideshow
    const sphere = getSphere();
    for (const m of sphere?.allMeshes || []) setOpacity(m, 1);
  }

  function ensureAudioCard(asset) {
    const key = assetKey(asset);
    let mesh = audioCards.get(key);
    if (!mesh) {
      mesh = createAudioCard(asset);
      audioCards.set(key, mesh);
    }
    // Reset history per ogni nuova slide
    mesh.userData.liveHistory = new Float32Array(LIVE_BARS).fill(0.04);
    drawLiveWaveform(mesh.userData.canvas, mesh.userData.liveHistory);
    if (mesh.userData.texture) mesh.userData.texture.needsUpdate = true;
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

  async function playAudioSlide(asset, gen, mesh, travel = null) {
    stopClip();

    const AC = window.AudioContext || window.webkitAudioContext;
    const el = new Audio(encodeMediaPath(asset.path));
    el.preload = "auto";
    el.crossOrigin = "anonymous";
    el.volume = 1;
    activeClip = el;

    let analyser = null;
    let timeData = null;
    const history =
      mesh.userData.liveHistory || new Float32Array(LIVE_BARS).fill(0.04);
    mesh.userData.liveHistory = history;

    if (AC) {
      try {
        const ac = new AC();
        activeAudioCtx = ac;
        if (ac.state === "suspended") await ac.resume();
        const src = ac.createMediaElementSource(el);
        analyser = ac.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.55;
        const gain = ac.createGain();
        activeGain = gain;
        gain.gain.value = clipGainFromSlider(getSoundVolume?.() ?? 0.5);
        src.connect(analyser);
        analyser.connect(gain);
        gain.connect(ac.destination);
        timeData = new Uint8Array(analyser.fftSize);
      } catch (err) {
        console.warn("[autoplay] live analyser failed", err);
        activeGain = null;
        el.volume = clipGainFromSlider(getSoundVolume?.() ?? 0.5);
      }
    } else {
      el.volume = clipGainFromSlider(getSoundVolume?.() ?? 0.5);
    }

    let durationSec = Number(asset.duration);
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      durationSec = await probeAudioDuration(encodeMediaPath(asset.path));
    }

    try {
      await el.play();
    } catch {
      /* autoplay policy / missing file */
    }

    const dwell = Math.min(24000, Math.max(2200, durationSec * 1000 + 350));
    const t0 = performance.now();
    let ok = true;
    let lastPush = 0;
    const fromIdx = Number(travel?.from);
    const toIdx = Number(travel?.to);

    while (performance.now() - t0 < dwell) {
      if (interrupted(gen)) {
        ok = false;
        break;
      }

      const now = performance.now();
      // Pallino: viaggio continuo lungo il path durante l’audio
      if (Number.isFinite(fromIdx) && Number.isFinite(toIdx) && toIdx > fromIdx) {
        const u = Math.min(1, (now - t0) / dwell);
        const e = u * u * (3 - 2 * u);
        onProgress?.(fromIdx + (toIdx - fromIdx) * e);
      }
      // ~28 sample/sec: scorrimento tipo memo
      if (now - lastPush >= 36) {
        lastPush = now;
        let amp = 0.04;
        if (analyser && timeData) {
          amp = sampleAnalyserAmp(analyser, timeData);
        } else {
          // Fallback debole senza analyser
          amp = 0.08 + Math.random() * 0.12;
        }
        // Lieve smoothing sull’ultima barra
        const prev = history[history.length - 1] || 0.04;
        const smoothed = prev * 0.35 + amp * 0.65;
        history.copyWithin(0, 1);
        history[history.length - 1] = smoothed;
        drawLiveWaveform(mesh.userData.canvas, history);
        if (mesh.userData.texture) mesh.userData.texture.needsUpdate = true;
      }

      await sleep(16, () => interrupted(gen));
      if (interrupted(gen)) {
        ok = false;
        break;
      }
      if (el.ended) break;
    }

    if (ok && Number.isFinite(fromIdx) && Number.isFinite(toIdx)) {
      pathCursor = Math.max(pathCursor, toIdx);
      onProgress?.(toIdx);
    }
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

  async function showItem(asset, gen, { first = false, list = null, index = 0 } = {}) {
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
    const travel = list?.length
      ? travelRangeFor(list, index)
      : {
          from: trackIndexOf(asset, 0),
          to: trackIndexOf(asset, 0) + 0.9,
        };
    onProgress?.(travel.from);
    hideSphere();

    await sleep(32, () => interrupted(gen));
    if (interrupted(gen)) return;

    const mesh = resolveMesh(asset);
    if (!mesh) {
      onCaption?.(mediaHoverLines(asset), null);
      hideSphere();
      const missDwell = IMAGE_DWELL_MS * 0.55;
      await travelProgress(travel.from, travel.to, missDwell, gen);
      return;
    }

    hideSphere();
    currentMesh = mesh;
    await presentMesh(mesh, gen);
    if (interrupted(gen)) return;

    onCaption?.(mediaHoverLines(asset), mesh);

    if (asset.kind === "audio") {
      await playAudioSlide(asset, gen, mesh, travel);
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
    await travelProgress(travel.from, travel.to, first ? dwell + 350 : dwell, gen);
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
    pathCursor = 0;

    await enterAutoplay(gen);
    if (aborting(gen)) return;

    let i = 0;
    let first = true;
    while (!aborting(gen)) {
      if (seekIndex != null) {
        i = seekIndex;
        seekIndex = null;
        first = false;
      }
      await showItem(list[i], gen, { first, list, index: i });
      first = false;
      if (aborting(gen)) break;
      if (seekIndex != null) continue;
      const prev = i;
      i = (i + 1) % list.length;
      // Fine playlist: pallino scompare in fondo e ricompare all’inizio (no ritorno indietro)
      if (i === 0 && prev === list.length - 1) {
        pathCursor = 0;
        onProgress?.(-1);
        await sleep(380, () => interrupted(gen));
        if (interrupted(gen)) continue;
      }
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
    pathCursor = 0;
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
