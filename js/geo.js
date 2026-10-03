/**
 * Project WGS84 track into a local Three.js-friendly frame.
 * X = east (m), Y = elevation (m, scaled), Z = south-ish (m) for readable hike silhouette.
 */
const DEG2RAD = Math.PI / 180;
const EARTH_M = 6371000;

export function createProjector(points) {
  const originLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const originLon = points.reduce((s, p) => s + p.lon, 0) / points.length;
  const cosLat = Math.cos(originLat * DEG2RAD);
  const elevScale = 1.35; // exaggerate relief for readability

  function project(lat, lon, ele) {
    const x = (lon - originLon) * DEG2RAD * EARTH_M * cosLat;
    const z = -((lat - originLat) * DEG2RAD * EARTH_M);
    const y = ele * elevScale;
    return { x, y, z };
  }

  const projected = points.map((p) => {
    const pos = project(p.lat, p.lon, p.ele);
    return { ...p, ...pos };
  });

  // Normalize so path is centered
  const cx = projected.reduce((s, p) => s + p.x, 0) / projected.length;
  const cy = projected.reduce((s, p) => s + p.y, 0) / projected.length;
  const cz = projected.reduce((s, p) => s + p.z, 0) / projected.length;

  const local = projected.map((p) => ({
    ...p,
    x: p.x - cx,
    y: p.y - cy,
    z: p.z - cz,
  }));

  // Horizontal span for camera framing
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of local) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }

  return {
    points: local,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ },
    projectPoint(lat, lon, ele) {
      const pos = project(lat, lon, ele);
      return { x: pos.x - cx, y: pos.y - cy, z: pos.z - cz };
    },
  };
}

export function nearestPoint(points, progress) {
  let best = points[0];
  let bestD = Infinity;
  for (const p of points) {
    const d = Math.abs(p.progress - progress);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

export function interpolatePoint(points, progress) {
  if (progress <= 0) return points[0];
  if (progress >= 1) return points[points.length - 1];
  let i = 0;
  while (i < points.length - 1 && points[i + 1].progress < progress) i += 1;
  const a = points[i];
  const b = points[Math.min(i + 1, points.length - 1)];
  const span = Math.max(b.progress - a.progress, 1e-6);
  const t = (progress - a.progress) / span;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    ele: a.ele + (b.ele - a.ele) * t,
    progress,
    time: new Date(a.time.getTime() + (b.time - a.time) * t),
  };
}
