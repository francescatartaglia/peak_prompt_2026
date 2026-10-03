/**
 * Single toroidal media cloud — show/hide + redistribute by BPM filter.
 */

import * as THREE from "three";

export const TORUS = {
  major: 18,
  minor: 7.5,
};

export function torusSamples(count) {
  const samples = [];
  const n = Math.max(count, 1);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i += 1) {
    const u = ((i * golden) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const v = ((i * 2.399) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    samples.push({
      u: u + ((i % 7) - 3) * 0.01,
      v: v + ((i % 5) - 2) * 0.02,
    });
  }
  return samples;
}

export function torusPosition(u, v, R = TORUS.major, r = TORUS.minor) {
  return new THREE.Vector3(
    (R + r * Math.cos(v)) * Math.cos(u),
    r * Math.sin(v),
    (R + r * Math.cos(v)) * Math.sin(u)
  );
}

export function torusNormal(u, v, R = TORUS.major, r = TORUS.minor) {
  const center = new THREE.Vector3(R * Math.cos(u), 0, R * Math.sin(u));
  return torusPosition(u, v, R, r).sub(center).normalize();
}

function loadTexture(url, loader) {
  return new Promise((resolve) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        resolve(tex);
      },
      undefined,
      () => resolve(null)
    );
  });
}

function makePlaceholderTexture(kind, tintHex) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f3f1ec";
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = tintHex;
  ctx.lineWidth = 10;
  ctx.strokeRect(18, 18, 220, 220);
  ctx.fillStyle = tintHex;
  ctx.font = "700 72px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(kind === "audio" ? "♪" : kind === "video" ? "▶" : "◇", 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function loadVideoPoster(url) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    const fail = () => resolve(null);
    video.addEventListener("error", fail, { once: true });
    video.addEventListener(
      "loadeddata",
      () => {
        try {
          video.currentTime = Math.min(0.25, (video.duration || 1) * 0.05);
        } catch {
          resolve(null);
        }
      },
      { once: true }
    );
    video.addEventListener(
      "seeked",
      () => {
        const tex = new THREE.VideoTexture(video);
        tex.colorSpace = THREE.SRGBColorSpace;
        resolve(tex);
      },
      { once: true }
    );
    setTimeout(fail, 2200);
  });
}

async function createMediaPlane(asset, tintHex, loader) {
  let texture = null;
  if (asset.kind === "image") texture = await loadTexture(asset.path, loader);
  else if (asset.kind === "video") texture = await loadVideoPoster(asset.path);
  if (!texture) texture = makePlaceholderTexture(asset.kind, tintHex);

  const aspect = texture.image
    ? (texture.image.videoWidth || texture.image.width || 1) /
      (texture.image.videoHeight || texture.image.height || 1)
    : 1.25;
  const h = 2.45;
  const w = h * Math.min(Math.max(aspect, 0.7), 1.75);

  const geo = new THREE.PlaneGeometry(w, h);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.96,
    color: new THREE.Color(tintHex).lerp(new THREE.Color("#ffffff"), 0.28),
  });
  const mesh = new THREE.Mesh(geo, mat);

  const rim = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 0.12, h + 0.12),
    new THREE.MeshBasicMaterial({
      color: tintHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    })
  );
  rim.position.z = -0.03;
  mesh.add(rim);

  mesh.visible = false;
  mesh.userData.asset = asset;
  mesh.userData.rim = rim;
  mesh.userData.homePosition = new THREE.Vector3();
  mesh.userData.homeQuaternion = new THREE.Quaternion();
  mesh.userData.homeScale = 1;
  mesh.userData.pulseScale = 1;
  return mesh;
}

/**
 * Build the full media pool once; visibility/layout updates later.
 */
export async function createMediaCloud(allMedia, { maxMedia = 160, onProgress } = {}) {
  const group = new THREE.Group();
  group.name = "media-cloud";

  const guide = new THREE.Mesh(
    new THREE.TorusGeometry(TORUS.major, TORUS.minor, 24, 96),
    new THREE.MeshBasicMaterial({
      color: "#e7e2da",
      wireframe: true,
      transparent: true,
      opacity: 0.14,
    })
  );
  guide.rotation.x = Math.PI / 2;
  group.add(guide);

  // Prefer evenly sampled subset when capping for GPU comfort
  const pool = subsample(allMedia, maxMedia);
  const loader = new THREE.TextureLoader();
  const mediaMeshes = [];
  const byId = new Map();

  const batchSize = 8;
  for (let i = 0; i < pool.length; i += batchSize) {
    const slice = pool.slice(i, i + batchSize);
    // eslint-disable-next-line no-await-in-loop
    const planes = await Promise.all(
      slice.map((asset) => createMediaPlane(asset, "#94a3b8", loader))
    );
    planes.forEach((plane) => {
      group.add(plane);
      mediaMeshes.push(plane);
      byId.set(assetKey(plane.userData.asset), plane);
    });
    onProgress?.(Math.min(i + batchSize, pool.length), pool.length);
  }

  return {
    group,
    guide,
    mediaMeshes,
    byId,
    pool,
    avgBpm: 120,
    visibleMeshes: [],
  };
}

function assetKey(asset) {
  return asset.id ?? asset.path ?? `${asset.time}-${asset.bpm}`;
}

function subsample(list, max) {
  if (list.length <= max) return list.slice();
  const out = [];
  const step = list.length / max;
  for (let i = 0; i < max; i += 1) {
    out.push(list[Math.floor(i * step)]);
  }
  return out;
}

/**
 * Show only media in `selected`, redistribute on torus, apply tint.
 */
export function applySelection(cloud, selected, tintHex) {
  const selectedKeys = new Set(selected.map(assetKey));
  const visible = [];

  for (const mesh of cloud.mediaMeshes) {
    const key = assetKey(mesh.userData.asset);
    const on = selectedKeys.has(key);
    mesh.visible = on;
    if (on) visible.push(mesh);
  }

  const samples = torusSamples(Math.max(visible.length, 1));
  visible.forEach((mesh, i) => {
    const { u, v } = samples[i];
    const pos = torusPosition(u, v);
    const normal = torusNormal(u, v);
    mesh.position.copy(pos);
    mesh.lookAt(pos.clone().add(normal));
    mesh.userData.homePosition.copy(pos);
    mesh.userData.homeQuaternion.copy(mesh.quaternion);
    mesh.scale.setScalar(1);

    const soft = new THREE.Color(tintHex).lerp(new THREE.Color("#ffffff"), 0.28);
    mesh.material.color.copy(soft);
    if (mesh.userData.rim?.material) {
      mesh.userData.rim.material.color.set(tintHex);
    }
  });

  cloud.visibleMeshes = visible;
  return visible;
}

export function applyPulse(cloud, elapsedSec, bpm, focusedMesh = null) {
  if (!cloud) return 0;
  const rate = Math.max(bpm || 120, 40);
  const t = elapsedSec * (rate / 60);
  const lub = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2)), 8);
  const dub = Math.pow(Math.max(0, Math.sin((t - 0.28) * Math.PI * 2)), 10);
  const beat = Math.max(lub, dub * 0.75);

  for (const mesh of cloud.visibleMeshes) {
    if (mesh === focusedMesh) continue;
    const pulse = 1 + beat * 0.075;
    mesh.userData.pulseScale = pulse;
    mesh.scale.setScalar(mesh.userData.homeScale * pulse);
  }
  if (cloud.guide?.material) {
    cloud.guide.material.opacity = 0.1 + beat * 0.1;
  }
  return beat;
}

export function applySpin(cloud, delta, focused = false) {
  if (!cloud || focused) return;
  cloud.group.rotation.y += delta * 0.12;
}
