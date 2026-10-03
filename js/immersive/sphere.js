/**
 * Curved media sphere — density packing, lightweight textures, BPM pulse.
 */

import * as THREE from "three";
import { createMediaMaterial, setShaderGrade, setShaderOpacity } from "./mediaShader.js";
import {
  loadOptimizedImageTexture,
  createOptimizedVideo,
  makePlaceholderTexture,
} from "./textures.js";
import { contractionEnvelope } from "./heartbeat.js";

const SEG_W = 24;
const SEG_H = 16;

export function sphereSamples(count, radius) {
  const samples = [];
  const n = Math.max(count, 1);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i += 1) {
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    samples.push(
      new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r).multiplyScalar(radius)
    );
  }
  return samples;
}

export function cellSize(radius, count) {
  const n = Math.max(count, 1);
  return radius * Math.sqrt((4 * Math.PI) / n);
}

/** Piano suddiviso, piegato sulla sfera (la scala dimensione è inclusa nella curva). */
export function createCurvedGeometry(width, height, radius, wSeg = SEG_W, hSeg = SEG_H) {
  const geo = new THREE.PlaneGeometry(width, height, wSeg, hSeg);
  geo.userData.flat = new Float32Array(geo.attributes.position.array);
  geo.userData.width = width;
  geo.userData.height = height;
  bendGeometry(geo, radius, 1);
  return geo;
}

/**
 * Proietta il piano sulla sfera (adesivo sulla superficie esterna).
 * Con +Z orientato verso l’esterno, i bordi vanno a z ≤ 0 (verso il centro):
 * curvatura convessa vista da fuori.
 */
export function bendGeometry(geo, radius, scale = 1) {
  const flat = geo.userData.flat;
  if (!flat) return;
  const w0 = geo.userData.width || 1;
  const h0 = geo.userData.height || 1;
  const pos = geo.attributes.position;
  const R = Math.max(radius, 2);
  const arcW = w0 * scale;
  const arcH = h0 * scale;

  for (let i = 0; i < pos.count; i += 1) {
    const u = flat[i * 3] / w0;
    const v = flat[i * 3 + 1] / h0;
    const theta = u * (arcW / R);
    const phi = v * (arcH / R);

    const cx = Math.sin(theta) * Math.cos(phi) * R;
    const cy = Math.sin(phi) * R;
    const cz = Math.cos(theta) * Math.cos(phi) * R;
    // z = cz - R ≤ 0 → bordi rientrano verso il centro (incollate sopra)
    pos.setXYZ(i, cx, cy, cz - R);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

const _radial = new THREE.Vector3();
const _outward = new THREE.Vector3(0, 0, 1);

/** Orienta il pannello con +Z verso l’esterno (sopra la sfera). */
function orientOutward(mesh, direction) {
  _radial.copy(direction).normalize();
  mesh.quaternion.setFromUnitVectors(_outward, _radial);
}

async function createMediaPanel(asset) {
  let packed = null;
  let videoHandle = null;

  if (asset.kind === "video") {
    videoHandle = await createOptimizedVideo(asset.path);
    if (videoHandle) packed = { texture: videoHandle.texture, aspect: videoHandle.aspect };
  } else {
    packed = await loadOptimizedImageTexture(asset.path);
  }

  if (!packed) packed = makePlaceholderTexture(asset.kind);

  const aspect = Math.min(Math.max(packed.aspect || 1.25, 0.65), 1.85);
  const baseH = 2.2;
  const baseW = baseH * aspect;
  const geo = createCurvedGeometry(baseW, baseH, 34);
  const mat = createMediaMaterial(packed.texture);
  const mesh = new THREE.Mesh(geo, mat);

  mesh.userData.asset = asset;
  mesh.userData.videoHandle = videoHandle;
  mesh.userData.baseW = baseW;
  mesh.userData.baseH = baseH;
  mesh.userData.homePosition = new THREE.Vector3();
  mesh.userData.homeQuaternion = new THREE.Quaternion();
  mesh.userData.unitDir = new THREE.Vector3(0, 1, 0);
  mesh.userData.mediaScale = 1;
  mesh.visible = false;

  return mesh;
}

export async function createImmersiveSphere(data, { maxPerZone = 64, onProgress } = {}) {
  const group = new THREE.Group();
  group.name = "immersive-sphere";

  // Wireframe denso: la densità locale segue le rientranze della bolla
  const dotWire = createDotWireframe(28000);
  group.add(dotWire);

  const byZone = { 1: [], 2: [], 3: [], 4: [] };
  const allMeshes = [];
  const jobs = [];

  for (const id of [1, 2, 3, 4]) {
    const list = (data.zones[id]?.media || []).slice(0, maxPerZone);
    for (const asset of list) jobs.push({ id, asset });
  }

  let done = 0;
  const batchSize = 6;
  for (let i = 0; i < jobs.length; i += batchSize) {
    const slice = jobs.slice(i, i + batchSize);
    // eslint-disable-next-line no-await-in-loop
    const panels = await Promise.all(slice.map((j) => createMediaPanel(j.asset)));
    panels.forEach((mesh, idx) => {
      const zoneId = slice[idx].id;
      group.add(mesh);
      byZone[zoneId].push(mesh);
      allMeshes.push(mesh);
    });
    done += slice.length;
    onProgress?.(done, jobs.length);
  }

  return {
    group,
    dotWire,
    byZone,
    allMeshes,
    activeMeshes: [],
    radius: 34,
    coverage: 0.36,
    saturation: 0.42,
    contrast: 0.82,
    pulseDepth: 0.06,
    groupPulse: 0.03,
  };
}

/** RNG deterministico (stesso pattern a ogni reload). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Punto uniforme random sulla sfera. */
function randomOnSphere(rng) {
  const u = rng() * 2 - 1;
  const theta = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - u * u));
  return new THREE.Vector3(r * Math.cos(theta), u, r * Math.sin(theta));
}

/**
 * Nuvola irregolare: mix di punti liberi + piccoli ammassi sparsi
 * (niente reticolo Fibonacci regolare).
 */
function createDotWireframe(count) {
  const rng = mulberry32(0xa11ce);
  const unit = new Float32Array(count * 3);

  const seedCount = Math.max(24, Math.floor(count * 0.1));
  const seeds = [];
  for (let i = 0; i < seedCount; i += 1) seeds.push(randomOnSphere(rng));

  const tmp = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    let p;
    const roll = rng();
    if (roll < 0.5) {
      p = randomOnSphere(rng);
    } else if (roll < 0.85) {
      const seed = seeds[Math.floor(rng() * seeds.length)];
      const scatter = 0.12 + rng() * 0.55;
      tmp.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(scatter);
      p = seed.clone().add(tmp).normalize();
    } else {
      const seed = seeds[Math.floor(rng() * seeds.length)];
      const scatter = 0.04 + rng() * 0.12;
      tmp.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(scatter);
      p = seed.clone().add(tmp).normalize();
    }

    p.x += (rng() - 0.5) * 0.06;
    p.y += (rng() - 0.5) * 0.06;
    p.z += (rng() - 0.5) * 0.06;
    p.normalize();

    unit[i * 3] = p.x;
    unit[i * 3 + 1] = p.y;
    unit[i * 3 + 2] = p.z;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(unit.slice(), 3));
  geo.userData.unit = unit;

  const mat = new THREE.PointsMaterial({
    color: 0xf2f2f2,
    size: 0.16,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    depthTest: true,
  });

  const points = new THREE.Points(geo, mat);
  points.name = "dot-wire";
  points.renderOrder = -1;
  return points;
}

/**
 * Puntini sulla sfera regolare; spenti sotto le foto.
 */
function updateWireframe(sphere) {
  const dots = sphere?.dotWire;
  if (!dots) return;

  const unit = dots.geometry.userData.unit;
  const posAttr = dots.geometry.attributes.position;
  const R = Math.max(sphere.radius, 0.01);
  const meshes = sphere.activeMeshes || [];

  const exclude = cellSize(R, Math.max(meshes.length, 1)) * 0.32;
  const excludeSq = exclude * exclude;

  for (let i = 0; i < posAttr.count; i += 1) {
    const x = unit[i * 3] * R;
    const y = unit[i * 3 + 1] * R;
    const z = unit[i * 3 + 2] * R;

    let underPhoto = false;
    for (let m = 0; m < meshes.length; m += 1) {
      const p = meshes[m].position;
      const dx = x - p.x;
      const dy = y - p.y;
      const dz = z - p.z;
      if (dx * dx + dy * dy + dz * dz < excludeSq) {
        underPhoto = true;
        break;
      }
    }

    if (underPhoto) {
      posAttr.setXYZ(i, NaN, NaN, NaN);
    } else {
      posAttr.setXYZ(i, x, y, z);
    }
  }

  posAttr.needsUpdate = true;
  dots.geometry.computeBoundingSphere();
  dots.material.size = Math.max(0.1, Math.min(0.22, R * 0.006));
  dots.material.opacity = 0.78;
}

function layoutMeshes(meshes, radius) {
  const samples = sphereSamples(Math.max(meshes.length, 1), radius);
  meshes.forEach((mesh, i) => {
    const pos = samples[i];
    mesh.userData.unitDir.copy(pos).normalize();
    mesh.position.copy(pos);
    orientOutward(mesh, mesh.userData.unitDir);
    mesh.userData.homePosition.copy(pos);
    mesh.userData.homeQuaternion.copy(mesh.quaternion);
  });
}

function applyCoverageScale(sphere) {
  const n = sphere.activeMeshes.length;
  const cell = cellSize(sphere.radius, n);
  for (const mesh of sphere.activeMeshes) {
    const base = Math.sqrt(mesh.userData.baseW * mesh.userData.baseH);
    const s = (cell * sphere.coverage) / Math.max(base, 0.001);
    mesh.userData.mediaScale = s;
    // Dimensione e curva insieme → le foto restano sulla sfera
    bendGeometry(mesh.geometry, sphere.radius, s);
    mesh.scale.setScalar(1);
  }
}

export function setActiveZoneMedia(sphere, zoneId) {
  const active = sphere.byZone[zoneId] || [];
  for (const mesh of sphere.allMeshes) {
    const on = active.includes(mesh);
    mesh.visible = on;
    const vh = mesh.userData.videoHandle;
    if (vh) {
      if (on) {
        if (vh.video) {
          vh.video.muted = true;
          vh.video.loop = true;
        }
        vh.play();
      } else {
        vh.pause();
      }
    }
  }
  sphere.activeMeshes = active;
  layoutMeshes(active, sphere.radius);
  applyCoverageScale(sphere);
  updateWireframe(sphere);
  return active;
}

export function applyDensity(sphere, { radius, coverage }) {
  sphere.radius = radius;
  sphere.coverage = coverage;
  layoutMeshes(sphere.activeMeshes, radius);
  applyCoverageScale(sphere);
  updateWireframe(sphere);
}

export function applyShaderGrade(sphere, saturation, contrast, brightness = 1) {
  sphere.saturation = saturation;
  sphere.contrast = contrast;
  sphere.brightness = brightness;
  for (const mesh of sphere.activeMeshes) {
    setShaderGrade(mesh.material, saturation, contrast, brightness);
  }
}

export function applyMediaOpacity(sphere, opacity) {
  for (const mesh of sphere.activeMeshes) {
    setShaderOpacity(mesh.material, opacity);
  }
}

export function applyHeartbeat(sphere, transportTime, bpm) {
  if (!sphere) return 0;
  const { contraction } = contractionEnvelope(transportTime, bpm);
  sphere.group.scale.setScalar(1 - contraction * (sphere.groupPulse ?? 0.04));
  // Pulse leggero sul mesh.scale (la curvatura resta corretta a scale≈1)
  const pulse = 1 - contraction * sphere.pulseDepth;
  for (const mesh of sphere.activeMeshes) {
    mesh.scale.setScalar(pulse);
  }
  return contraction;
}

export function resumeActiveVideos(sphere) {
  for (const mesh of sphere?.activeMeshes || []) {
    const vh = mesh.userData.videoHandle;
    if (!vh) continue;
    const v = vh.video;
    if (v) {
      v.muted = true;
      v.defaultMuted = true;
      v.volume = 0;
      v.loop = true;
    }
    vh.play();
  }
}

/** Riprende solo i video attivi che si sono fermati (chiamabile ogni frame). */
export function keepVideosPlaying(sphere) {
  for (const mesh of sphere?.activeMeshes || []) {
    const vh = mesh.userData.videoHandle;
    const v = vh?.video;
    if (!v) continue;
    if (v.paused || v.ended) vh.play();
  }
}
