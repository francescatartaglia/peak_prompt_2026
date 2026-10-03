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

const SEG_W = 14;
const SEG_H = 10;

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

/** Flat plane bent onto a sphere so panels follow curvature. */
export function createCurvedGeometry(width, height, radius, wSeg = SEG_W, hSeg = SEG_H) {
  const geo = new THREE.PlaneGeometry(width, height, wSeg, hSeg);
  geo.userData.flat = new Float32Array(geo.attributes.position.array);
  geo.userData.width = width;
  geo.userData.height = height;
  bendGeometry(geo, radius);
  return geo;
}

export function bendGeometry(geo, radius) {
  const flat = geo.userData.flat;
  if (!flat) return;
  const pos = geo.attributes.position;
  const R = Math.max(radius, 2);
  for (let i = 0; i < pos.count; i += 1) {
    const x = flat[i * 3];
    const y = flat[i * 3 + 1];
    const theta = x / R;
    const phi = y / R;
    const cx = Math.sin(theta) * Math.cos(phi) * R;
    const cy = Math.sin(phi) * R;
    const cz = Math.cos(theta) * Math.cos(phi) * R;
    // Local origin at patch center; bulge follows sphere (outward = −Z after lookAt center)
    pos.setXYZ(i, cx, cy, cz - R);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
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
  mesh.userData.mediaScale = 1;
  mesh.visible = false;

  return mesh;
}

export async function createImmersiveSphere(data, { maxPerZone = 64, onProgress } = {}) {
  const group = new THREE.Group();
  group.name = "immersive-sphere";

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

function layoutMeshes(meshes, radius) {
  const samples = sphereSamples(Math.max(meshes.length, 1), radius);
  meshes.forEach((mesh, i) => {
    const pos = samples[i];
    mesh.position.copy(pos);
    mesh.lookAt(0, 0, 0);
    bendGeometry(mesh.geometry, radius);
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
    mesh.scale.setScalar(s);
  }
}

export function setActiveZoneMedia(sphere, zoneId) {
  const active = sphere.byZone[zoneId] || [];
  for (const mesh of sphere.allMeshes) {
    const on = active.includes(mesh);
    mesh.visible = on;
    const vh = mesh.userData.videoHandle;
    if (vh) {
      if (on) vh.play();
      else vh.pause();
    }
  }
  sphere.activeMeshes = active;
  layoutMeshes(active, sphere.radius);
  applyCoverageScale(sphere);
  return active;
}

export function applyDensity(sphere, { radius, coverage }) {
  sphere.radius = radius;
  sphere.coverage = coverage;
  layoutMeshes(sphere.activeMeshes, radius);
  applyCoverageScale(sphere);
}

export function applyShaderGrade(sphere, saturation, contrast) {
  sphere.saturation = saturation;
  sphere.contrast = contrast;
  for (const mesh of sphere.activeMeshes) {
    setShaderGrade(mesh.material, saturation, contrast);
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
  for (const mesh of sphere.activeMeshes) {
    const base = mesh.userData.mediaScale || 1;
    mesh.scale.setScalar(base * (1 - contraction * sphere.pulseDepth));
  }
  return contraction;
}

export function resumeActiveVideos(sphere) {
  for (const mesh of sphere?.activeMeshes || []) {
    mesh.userData.videoHandle?.play();
  }
}
