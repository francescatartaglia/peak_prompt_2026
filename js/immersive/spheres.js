/**
 * Build one inward-facing spherical environment per HR zone,
 * with media planes distributed on the inner surface.
 */

import * as THREE from "three";

const SPHERE_RADIUS = 42;
const MEDIA_RADIUS = 38;

/** Fibonacci sphere → uniform unit directions. */
export function fibonacciDirections(count) {
  const dirs = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / Math.max(count - 1, 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    dirs.push(new THREE.Vector3(x, y, z).normalize());
  }
  return dirs;
}

function hexColor(hex) {
  return new THREE.Color(hex);
}

/**
 * Soft chromatic tint as a full-screen-ish inner shell + fog-like emissive wash.
 */
function createTintShell(tintHex) {
  const color = hexColor(tintHex);
  const geo = new THREE.SphereGeometry(SPHERE_RADIUS, 64, 48);
  const mat = new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "tintShell";
  return mesh;
}

function createStarField(tintHex) {
  const color = hexColor(tintHex);
  const count = 600;
  const dirs = fibonacciDirections(count);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const dir = dirs[i];
    const r = SPHERE_RADIUS * 0.96;
    positions[i * 3] = dir.x * r;
    positions[i * 3 + 1] = dir.y * r;
    positions[i * 3 + 2] = dir.z * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color,
    size: 0.35,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  return new THREE.Points(geo, mat);
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
  ctx.fillStyle = "#111518";
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = tintHex;
  ctx.lineWidth = 8;
  ctx.strokeRect(16, 16, 224, 224);
  ctx.fillStyle = tintHex;
  ctx.font = "bold 72px Sora, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(kind === "audio" ? "♪" : kind === "video" ? "▶" : "◇", 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

async function createMediaPlane(asset, direction, tintHex, loader) {
  let texture = null;
  if (asset.kind === "image") {
    texture = await loadTexture(asset.path, loader);
  } else if (asset.kind === "video") {
    // Prefer a lightweight poster via video element frame when possible
    texture = await loadVideoPoster(asset.path);
  }
  if (!texture) texture = makePlaceholderTexture(asset.kind, tintHex);

  const aspect = texture.image
    ? (texture.image.videoWidth || texture.image.width || 1) /
      (texture.image.videoHeight || texture.image.height || 1)
    : 1.2;
  const h = 4.2;
  const w = h * Math.min(Math.max(aspect, 0.7), 1.7);

  const geo = new THREE.PlaneGeometry(w, h);
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.92,
    color: hexColor(tintHex).lerp(new THREE.Color("#ffffff"), 0.35),
  });
  const mesh = new THREE.Mesh(geo, mat);

  // Place on inner surface, facing the center
  mesh.position.copy(direction.clone().multiplyScalar(MEDIA_RADIUS));
  mesh.lookAt(0, 0, 0);
  mesh.rotateY(Math.PI); // face inward toward camera at origin

  // Slight frame rim
  const rim = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 0.25, h + 0.25),
    new THREE.MeshBasicMaterial({
      color: tintHex,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    })
  );
  rim.position.z = -0.05;
  mesh.add(rim);

  mesh.userData.asset = asset;
  mesh.userData.baseScale = 1;
  return mesh;
}

function loadVideoPoster(url) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.crossOrigin = "anonymous";
    const fail = () => resolve(null);
    video.addEventListener("error", fail, { once: true });
    video.addEventListener(
      "loadeddata",
      () => {
        try {
          video.currentTime = Math.min(0.2, (video.duration || 1) * 0.05);
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
        // Freeze by not playing — VideoTexture still works as a frame
        resolve(tex);
      },
      { once: true }
    );
    // Timeout fallback
    setTimeout(fail, 2500);
  });
}

/**
 * Create a zone group: tint shell + media planes.
 * Returns { group, mediaMeshes, avgBpm, zone }
 */
export async function createZoneSphere(zone, { maxMedia = 80 } = {}) {
  const group = new THREE.Group();
  group.name = `zone-${zone.id}`;
  group.visible = false;

  group.add(createTintShell(zone.tint));
  group.add(createStarField(zone.tint));

  // Soft inner gradient sphere
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(SPHERE_RADIUS * 0.15, 32, 24),
    new THREE.MeshBasicMaterial({
      color: zone.tint,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
    })
  );
  group.add(core);

  const media = zone.media.slice(0, maxMedia);
  const dirs = fibonacciDirections(Math.max(media.length, 1));
  const loader = new THREE.TextureLoader();
  const mediaMeshes = [];

  // Load in small batches to keep UI responsive
  const batchSize = 8;
  for (let i = 0; i < media.length; i += batchSize) {
    const slice = media.slice(i, i + batchSize);
    const planes = await Promise.all(
      slice.map((asset, j) => createMediaPlane(asset, dirs[i + j], zone.tint, loader))
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
    shell: group.getObjectByName("tintShell"),
  };
}

/**
 * Apply heartbeat pulse: scale shell + media around base size.
 * phase is seconds; bpm drives frequency.
 */
export function applyPulse(zoneSphere, elapsedSec) {
  if (!zoneSphere) return 1;
  const bpm = zoneSphere.avgBpm || 120;
  const beatsPerSec = bpm / 60;
  // Double-bump envelope approximating lub-dub
  const t = elapsedSec * beatsPerSec;
  const lub = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2)), 8);
  const dub = Math.pow(Math.max(0, Math.sin((t - 0.28) * Math.PI * 2)), 10);
  const beat = Math.max(lub, dub * 0.75);
  const scale = 1 + beat * 0.045;

  zoneSphere.group.scale.setScalar(scale);
  for (const mesh of zoneSphere.mediaMeshes) {
    const local = 1 + beat * 0.06;
    mesh.scale.setScalar(local);
  }
  if (zoneSphere.shell?.material) {
    zoneSphere.shell.material.opacity = 0.42 + beat * 0.28;
  }
  return beat;
}

export function pickMedia(zoneSphere, raycaster, camera, pointerNdc) {
  if (!zoneSphere) return null;
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObjects(zoneSphere.mediaMeshes, false);
  return hits[0]?.object?.userData?.asset || null;
}
