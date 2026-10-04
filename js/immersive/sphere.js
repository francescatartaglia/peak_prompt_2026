/**
 * Curved media sphere — density packing, lightweight textures, BPM pulse.
 */

import * as THREE from "three";
import {
  createMediaMaterial,
  setShaderGrade,
  setShaderOpacity,
  tickMediaShaderTime,
} from "./mediaShader.js";
import {
  loadOptimizedImageTexture,
  createOptimizedVideo,
} from "./textures.js";
import { contractionEnvelope } from "./heartbeat.js";

const SEG_W = 24;
const SEG_H = 16;
/**
 * Stacking senza staccare le foto dalla parete:
 * solo renderOrder + polygonOffset (niente offset radiale).
 */

/** Fibonacci sphere: copertura quasi uniforme sulla sfera unitaria. */
function fibonacciSphere(count) {
  const n = Math.max(count, 1);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const y = n === 1 ? 0 : 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    out.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r));
  }
  return out;
}

/**
 * Farthest-point sampling: sottoinsieme omogeneo da candidati densi
 * (aspetto casuale ma senza buchi evidenti).
 */
function farthestPointSample(candidates, k) {
  const n = candidates.length;
  const count = Math.min(Math.max(k, 1), n);
  const selected = [];
  const minDist = new Float64Array(n).fill(Infinity);

  // Start semi-casuale ma stabile per sessione
  let start = Math.floor(Math.random() * n);
  selected.push(candidates[start].clone());

  for (let s = 1; s < count; s += 1) {
    const last = selected[s - 1];
    let bestI = 0;
    let bestD = -1;
    for (let i = 0; i < n; i += 1) {
      const d = candidates[i].distanceToSquared(last);
      if (d < minDist[i]) minDist[i] = d;
      if (minDist[i] > bestD) {
        bestD = minDist[i];
        bestI = i;
      }
    }
    selected.push(candidates[bestI].clone());
  }
  return selected;
}

/** Piccola agitazione organica, poi repulsione per richiudere i buchi. */
function jitterDirs(dirs, amount = 0.14) {
  for (const d of dirs) {
    d.x += (Math.random() - 0.5) * amount;
    d.y += (Math.random() - 0.5) * amount;
    d.z += (Math.random() - 0.5) * amount;
    d.normalize();
  }
  return dirs;
}

function relaxOnSphere(dirs, iterations = 12) {
  const n = dirs.length;
  if (n < 3) return dirs;
  const forces = Array.from({ length: n }, () => new THREE.Vector3());
  const away = new THREE.Vector3();
  const minAng = Math.sqrt((4 * Math.PI) / n) * 0.98;

  for (let it = 0; it < iterations; it += 1) {
    for (let i = 0; i < n; i += 1) forces[i].set(0, 0, 0);
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const dot = Math.min(0.9999, Math.max(-0.9999, dirs[i].dot(dirs[j])));
        const ang = Math.acos(dot);
        if (ang >= minAng || ang < 1e-6) continue;
        const push = (minAng - ang) / minAng;
        away.copy(dirs[i]).addScaledVector(dirs[j], -dot).normalize();
        forces[i].addScaledVector(away, push);
        forces[j].addScaledVector(away, -push);
      }
    }
    const t = 0.38 * (1 - it / iterations);
    for (let i = 0; i < n; i += 1) {
      dirs[i].addScaledVector(forces[i], t).normalize();
    }
  }
  return dirs;
}

/** Campioni casuali ma omogenei sulle pareti della sfera. */
export function sphereSamples(count, radius) {
  const n = Math.max(count, 1);
  const candidateN = Math.max(260, n * 56);
  const candidates = fibonacciSphere(candidateN);
  const picked = farthestPointSample(candidates, n);
  jitterDirs(picked, 0.16);
  relaxOnSphere(picked, n <= 16 ? 18 : 12);
  return picked.map((p) => p.multiplyScalar(radius));
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

/** Ripristina il piano 2D (niente curvatura sfera) — per slideshow autoplay. */
export function flattenGeometry(geo) {
  const flat = geo?.userData?.flat;
  if (!flat || !geo?.attributes?.position) return;
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    pos.setXYZ(i, flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

const _radial = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _basis = new THREE.Matrix4();

/**
 * +Z verso l’esterno, +Y allineata al “su” del mondo (foto dritte, senza twist).
 */
function orientOutward(mesh, direction) {
  _radial.copy(direction).normalize();
  _up.copy(_worldUp).addScaledVector(_radial, -_worldUp.dot(_radial));
  if (_up.lengthSq() < 1e-8) {
    _up.set(0, 0, 1).addScaledVector(_radial, -_radial.z);
  }
  _up.normalize();
  _right.crossVectors(_up, _radial).normalize();
  _up.crossVectors(_radial, _right).normalize();
  _basis.makeBasis(_right, _up, _radial);
  mesh.quaternion.setFromRotationMatrix(_basis);
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

  // Niente placeholder: media assenti non compaiono come riquadri staccati
  if (!packed) return null;

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
      if (!mesh) return;
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
    radius: 56,
    coverage: 0.36,
    saturation: 0.38,
    contrast: 1.12,
    brightness: 1.42,
    pulseDepth: 0.12,
    groupPulse: 0.045,
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
 * Nuvola irregolare a grappoli: zone dense e zone più vuote
 * (niente distribuzione omogenea).
 */
function createDotWireframe(count) {
  const rng = mulberry32(0xa11ce);
  const unit = new Float32Array(count * 3);

  // Pochi semi → ammassi grossi, con densità molto variabile
  const seedCount = Math.max(14, Math.floor(count * 0.035));
  const seeds = [];
  const seedWeight = [];
  for (let i = 0; i < seedCount; i += 1) {
    seeds.push(randomOnSphere(rng));
    // Pesi sperequati: alcuni cluster enormi, altri piccoli
    seedWeight.push(rng() ** 2.4 + 0.05);
  }
  let weightSum = seedWeight.reduce((a, b) => a + b, 0);

  function pickSeed() {
    let r = rng() * weightSum;
    for (let i = 0; i < seedCount; i += 1) {
      r -= seedWeight[i];
      if (r <= 0) return seeds[i];
    }
    return seeds[seedCount - 1];
  }

  const tmp = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    let p;
    const roll = rng();
    if (roll < 0.12) {
      // Pochi punti sparsi isolati
      p = randomOnSphere(rng);
    } else if (roll < 0.4) {
      // Alone largo intorno a un cluster
      const seed = pickSeed();
      const scatter = 0.25 + rng() * 0.85;
      tmp.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(scatter);
      p = seed.clone().add(tmp).normalize();
    } else if (roll < 0.78) {
      // Nucleo medio del cluster
      const seed = pickSeed();
      const scatter = 0.06 + rng() * 0.22;
      tmp.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(scatter);
      p = seed.clone().add(tmp).normalize();
    } else {
      // Nucleo strettissimo (grappoli densi)
      const seed = pickSeed();
      const scatter = 0.012 + rng() * 0.06;
      tmp.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(scatter);
      p = seed.clone().add(tmp).normalize();
    }

    // Rumore locale asymmetrico
    p.x += (rng() - 0.5) * 0.1;
    p.y += (rng() - 0.5) * 0.08;
    p.z += (rng() - 0.5) * 0.1;
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
 * Puntini su tutta la sfera (anche vicino/sotto le foto — niente alone vuoto).
 * Salva la maschera `alive` per il pulse a scosse del battito.
 */
function updateWireframe(sphere) {
  const dots = sphere?.dotWire;
  if (!dots) return;

  const unit = dots.geometry.userData.unit;
  const posAttr = dots.geometry.attributes.position;
  const R = Math.max(sphere.radius, 0.01);
  let alive = dots.geometry.userData.alive;
  if (!alive || alive.length !== posAttr.count) {
    alive = new Uint8Array(posAttr.count);
    dots.geometry.userData.alive = alive;
  }

  for (let i = 0; i < posAttr.count; i += 1) {
    alive[i] = 1;
    posAttr.setXYZ(i, unit[i * 3] * R, unit[i * 3 + 1] * R, unit[i * 3 + 2] * R);
  }

  posAttr.needsUpdate = true;
  dots.geometry.computeBoundingSphere();
  const baseSize = Math.max(0.1, Math.min(0.22, R * 0.006));
  dots.userData.baseSize = baseSize;
  dots.material.size = baseSize;
  dots.material.opacity = 0.78;
}

/** Hash 0..1 stabile per scosse sfalsate sul wireframe. */
function hash01(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Scosse del battito sul wireframe puntinato:
 * snap radiale + jitter tangenziale sfalsato per punto.
 */
function applyWireframePulse(sphere, contraction, timeSec) {
  const dots = sphere?.dotWire;
  if (!dots) return;

  const unit = dots.geometry.userData.unit;
  const alive = dots.geometry.userData.alive;
  const posAttr = dots.geometry.attributes.position;
  if (!unit || !alive || !posAttr) return;

  const R = Math.max(sphere.radius, 0.01);
  const c = Math.min(1, Math.max(0, contraction));
  const t = timeSec;

  for (let i = 0; i < posAttr.count; i += 1) {
    if (!alive[i]) {
      posAttr.setXYZ(i, NaN, NaN, NaN);
      continue;
    }
    const ux = unit[i * 3];
    const uy = unit[i * 3 + 1];
    const uz = unit[i * 3 + 2];
    const h = hash01(i);
    // Doppio picco “lub-dub” locale + rumore a scossa
    const shock =
      c *
      (0.5 +
        0.5 * Math.sin(h * 36.0 + t * 26.0) *
          Math.sin(h * 11.0 + t * 54.0 + c * 9.0));
    const radial = 1 - shock * (0.02 + h * 0.03);
    // Tangente grezza per lo shake
    const tx = -uz;
    const tz = ux;
    const tLen = Math.hypot(tx, tz) || 1;
    const shake = shock * (0.012 + h * 0.018) * Math.sin(h * 80.0 + t * 48.0);
    const sx = (tx / tLen) * shake * R;
    const sz = (tz / tLen) * shake * R;
    const sy = shock * 0.008 * Math.sin(h * 50.0 + t * 37.0) * R;

    posAttr.setXYZ(i, ux * R * radial + sx, uy * R * radial + sy, uz * R * radial + sz);
  }

  posAttr.needsUpdate = true;
  const base = dots.userData.baseSize || 0.16;
  dots.material.size = base * (1 + c * (0.65 + 0.35 * Math.sin(t * 42)));
  dots.material.opacity = 0.52 + c * 0.45;
}

/** Assegna chi sta sopra (foto sempre sulla stessa parete). */
function applyStackDepth(mesh, layer) {
  mesh.userData.stackLayer = layer;
  mesh.renderOrder = 100 + layer;
  const mat = mesh.material;
  if (!mat) return;
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -(1 + layer * 2);
  mat.polygonOffsetUnits = -(1 + layer);
  mat.depthTest = true;
  mat.depthWrite = true;
}

function layoutMeshes(meshes, radius) {
  const samples = sphereSamples(Math.max(meshes.length, 1), radius);
  meshes.forEach((mesh, i) => {
    const pos = samples[i];
    mesh.userData.unitDir.copy(pos).normalize();
    applyStackDepth(mesh, i);
    // Sempre sulla parete (stesso raggio per tutte)
    mesh.position.copy(mesh.userData.unitDir).multiplyScalar(radius);
    orientOutward(mesh, mesh.userData.unitDir);
    mesh.userData.homePosition.copy(mesh.position);
    mesh.userData.homeQuaternion.copy(mesh.quaternion);
  });
}

function applyCoverageScale(sphere) {
  const n = sphere.activeMeshes.length;
  const cell = cellSize(sphere.radius, n);
  const cov = sphere.coverage;
  const R = sphere.radius;
  sphere.activeMeshes.forEach((mesh, i) => {
    if (mesh.userData?.slideshowLock) return;
    const layer = mesh.userData.stackLayer ?? i;
    const base = Math.sqrt(mesh.userData.baseW * mesh.userData.baseH);
    let s = (cell * cov) / Math.max(base, 0.001);
    // Vicine → stretch (non blur): allarga le foto fino a sovrapporsi
    if (cov > 0.92) {
      const over = Math.min(cov - 0.92, 0.4);
      s *= 1 + over * 0.42;
    }
    mesh.userData.mediaScale = s;
    // Curvatura = raggio sfera → adesive alle pareti
    bendGeometry(mesh.geometry, R, s);
    mesh.scale.setScalar(1);
    applyStackDepth(mesh, layer);
  });
}

export function setActiveZoneMedia(sphere, zoneId) {
  const active = sphere.byZone[zoneId] || [];
  for (const mesh of sphere.allMeshes) {
    if (mesh.userData?.slideshowLock) continue;
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
  // Non rilayoutare mesh in slideshow (sono fuori dalla sfera)
  const layoutList = active.filter((m) => !m.userData?.slideshowLock);
  layoutMeshes(layoutList, sphere.radius);
  applyCoverageScale(sphere);
  return active;
}

export function applyDensity(sphere, { radius, coverage, relayout = false } = {}) {
  sphere.radius = radius;
  sphere.coverage = coverage;
  // Relayout solo se richiesto: altrimenti le foto restano al posto
  // (evita il “salto” casuale durante le transizioni zona).
  if (relayout) layoutMeshes(sphere.activeMeshes, radius);
  applyCoverageScale(sphere);
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
  // Niente scale sul group (evita scatti dopo lo zoom): solo i pannelli pulsan
  sphere.group.scale.setScalar(1);
  const depth = (sphere.pulseDepth ?? 0.14) * 0.85;
  const pulse = 1 - contraction * depth;
  for (const mesh of sphere.activeMeshes) {
    if (mesh.userData?.slideshowLock) {
      tickMediaShaderTime(mesh.material, transportTime);
      continue;
    }
    mesh.scale.setScalar(pulse);
    tickMediaShaderTime(mesh.material, transportTime);
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
