/**
 * Toroidal media arrangements per HR zone.
 */

import * as THREE from "three";

export const TORUS = {
  major: 18, // R
  minor: 7.5, // r
};

/** Even-ish (u,v) samples on a torus surface. */
export function torusSamples(count) {
  const samples = [];
  const n = Math.max(count, 1);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i += 1) {
    // Spread across major ring with golden angle; vary tube angle
    const u = ((i * golden) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const v = ((i * 2.399) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    // Slight jitter for organic feel without clustering
    const uu = u + ((i % 7) - 3) * 0.01;
    const vv = v + ((i % 5) - 2) * 0.02;
    samples.push({ u: uu, v: vv });
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

/** Outward tube normal (from tube centerline through surface point). */
export function torusNormal(u, v, R = TORUS.major, r = TORUS.minor) {
  const center = new THREE.Vector3(R * Math.cos(u), 0, R * Math.sin(u));
  return torusPosition(u, v, R, r).sub(center).normalize();
}

function hexColor(hex) {
  return new THREE.Color(hex);
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
  ctx.font = "700 72px Inter, Helvetica Neue, sans-serif";
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

async function createMediaPlane(asset, sample, tintHex, loader) {
  let texture = null;
  if (asset.kind === "image") texture = await loadTexture(asset.path, loader);
  else if (asset.kind === "video") texture = await loadVideoPoster(asset.path);
  if (!texture) texture = makePlaceholderTexture(asset.kind, tintHex);

  const aspect = texture.image
    ? (texture.image.videoWidth || texture.image.width || 1) /
      (texture.image.videoHeight || texture.image.height || 1)
    : 1.25;
  const h = 2.6;
  const w = h * Math.min(Math.max(aspect, 0.7), 1.75);

  const geo = new THREE.PlaneGeometry(w, h);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.96,
    // Chromatic tint on media only
    color: hexColor(tintHex).lerp(new THREE.Color("#ffffff"), 0.28),
  });
  const mesh = new THREE.Mesh(geo, mat);

  const pos = torusPosition(sample.u, sample.v);
  const normal = torusNormal(sample.u, sample.v);
  mesh.position.copy(pos);
  // Face outward from the tube
  mesh.lookAt(pos.clone().add(normal));

  // Soft rim (also tinted)
  const rim = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 0.12, h + 0.12),
    new THREE.MeshBasicMaterial({
      color: tintHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    })
  );
  rim.position.z = -0.03;
  mesh.add(rim);

  mesh.userData.asset = asset;
  mesh.userData.homePosition = pos.clone();
  mesh.userData.homeQuaternion = mesh.quaternion.clone();
  mesh.userData.homeScale = 1;
  mesh.userData.pulseScale = 1;
  return mesh;
}

/**
 * Build one toroidal zone group.
 */
export async function createZoneTorus(zone, { maxMedia = 100 } = {}) {
  const group = new THREE.Group();
  group.name = `zone-torus-${zone.id}`;
  group.visible = false;

  // Invisible helper torus (optional subtle guide — very light wire)
  const guide = new THREE.Mesh(
    new THREE.TorusGeometry(TORUS.major, TORUS.minor, 24, 96),
    new THREE.MeshBasicMaterial({
      color: "#e7e2da",
      wireframe: true,
      transparent: true,
      opacity: 0.18,
    })
  );
  guide.rotation.x = Math.PI / 2;
  group.add(guide);

  const media = zone.media.slice(0, maxMedia);
  const samples = torusSamples(Math.max(media.length, 1));
  const loader = new THREE.TextureLoader();
  const mediaMeshes = [];

  const batchSize = 8;
  for (let i = 0; i < media.length; i += batchSize) {
    const slice = media.slice(i, i + batchSize);
    // eslint-disable-next-line no-await-in-loop
    const planes = await Promise.all(
      slice.map((asset, j) => createMediaPlane(asset, samples[i + j], zone.tint, loader))
    );
    planes.forEach((plane) => {
      group.add(plane);
      mediaMeshes.push(plane);
    });
  }

  return {
    id: zone.id,
    zone,
    group,
    mediaMeshes,
    avgBpm: zone.avgBpm,
    guide,
  };
}

/**
 * Heartbeat pulse on media scales (skips a focused mesh).
 */
export function applyPulse(zoneTorus, elapsedSec, focusedMesh = null) {
  if (!zoneTorus) return 0;
  const bpm = zoneTorus.avgBpm || 120;
  const t = elapsedSec * (bpm / 60);
  const lub = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2)), 8);
  const dub = Math.pow(Math.max(0, Math.sin((t - 0.28) * Math.PI * 2)), 10);
  const beat = Math.max(lub, dub * 0.75);

  for (const mesh of zoneTorus.mediaMeshes) {
    if (mesh === focusedMesh) continue;
    const pulse = 1 + beat * 0.07;
    mesh.userData.pulseScale = pulse;
    mesh.scale.setScalar(mesh.userData.homeScale * pulse);
  }
  if (zoneTorus.guide?.material) {
    zoneTorus.guide.material.opacity = 0.12 + beat * 0.1;
  }
  return beat;
}

/** Slow spin of the whole torus arrangement. */
export function applySpin(zoneTorus, delta, focused = false) {
  if (!zoneTorus || focused) return;
  zoneTorus.group.rotation.y += delta * 0.12;
}
