/**
 * CT FOV micro-scales: H (bottom) + V (right).
 * Visible only at max dezoom; sized to the sphere’s screen diameter.
 */

import * as THREE from "three";

/** Full span in mm — typical cardiac CT display FOV */
const FOV_MM = 320;
const MAJOR_MM = 80;
const MID_MM = 40;
const MINOR_MM = 10;

const FADE_EPS = 0.992;

/** Gap from HUD footer copy to the bottom of the viewport (px). */
function measureHudBottomInset() {
  const foot = document.querySelector(".hud-foot");
  if (!foot) return 14; // ≈ 0.85rem fallback
  return Math.max(0, Math.round(window.innerHeight - foot.getBoundingClientRect().bottom));
}

/**
 * @param {HTMLElement} root
 * @param {{
 *   getCamera: () => THREE.PerspectiveCamera | null,
 *   getControls: () => import("three/addons/controls/OrbitControls.js").OrbitControls | null,
 *   getRadius: () => number,
 *   isVisibleAllowed: () => boolean,
 *   getMaxDezoomDist: () => number,
 * }} opts
 */
export function createCtScales(root, opts) {
  const {
    getCamera,
    getControls,
    getRadius,
    isVisibleAllowed,
    getMaxDezoomDist,
  } = opts;

  const wrap = document.createElement("div");
  wrap.id = "ct-scales";
  wrap.className = "ct-scales";
  wrap.setAttribute("aria-hidden", "true");

  const hEl = buildScale("h");
  const vEl = buildScale("v");
  wrap.append(hEl.root, vEl.root);
  root.appendChild(wrap);

  const _origin = new THREE.Vector3(0, 0, 0);
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _fwd = new THREE.Vector3();
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _silMid = new THREE.Vector3();

  let shown = false;

  function setShown(next) {
    if (shown === next) return;
    shown = next;
    wrap.classList.toggle("is-visible", next);
    wrap.setAttribute("aria-hidden", next ? "false" : "true");
  }

  function project(v, camera, w, h) {
    _c.copy(v).project(camera);
    return {
      x: (_c.x * 0.5 + 0.5) * w,
      y: (-_c.y * 0.5 + 0.5) * h,
    };
  }

  /** True on-screen diameter of the sphere silhouette (px). */
  function sphereScreenDiameter(camera, R, w, h) {
    const d = Math.max(R * 1.001, camera.position.distanceTo(_origin));
    camera.getWorldDirection(_fwd);
    _right.crossVectors(_fwd, camera.up).normalize();
    if (_right.lengthSq() < 1e-8) _right.set(1, 0, 0);
    _up.crossVectors(_right, _fwd).normalize();

    // Silhouette circle: plane closer to camera, radius R·sin(θ) with cos(θ)=R/d
    const along = (d * d - R * R) / d;
    const silR = (R / d) * Math.sqrt(Math.max(0, d * d - R * R));
    _silMid.copy(camera.position).addScaledVector(_fwd, along);

    _a.copy(_silMid).addScaledVector(_right, -silR);
    _b.copy(_silMid).addScaledVector(_right, silR);
    const pL = project(_a, camera, w, h);
    const pR = project(_b, camera, w, h);
    const diamW = Math.hypot(pR.x - pL.x, pR.y - pL.y);

    _a.copy(_silMid).addScaledVector(_up, -silR);
    _b.copy(_silMid).addScaledVector(_up, silR);
    const pB = project(_a, camera, w, h);
    const pT = project(_b, camera, w, h);
    const diamH = Math.hypot(pT.x - pB.x, pT.y - pB.y);

    // Circle on screen → same length for H and V
    return Math.max(48, Math.round((diamW + diamH) * 0.5));
  }

  function tick() {
    const camera = getCamera?.();
    const controls = getControls?.();
    const allowed = !!isVisibleAllowed?.();
    if (!camera || !controls || !allowed) {
      setShown(false);
      return;
    }

    const maxD = Math.max(1, getMaxDezoomDist?.() || controls.maxDistance || 1);
    const dist = camera.position.distanceTo(controls.target);
    const atMax = dist >= maxD * FADE_EPS;
    setShown(atMax);
    if (!atMax) return;

    const R = Math.max(1, getRadius?.() || 56);
    const w = window.innerWidth;
    const h = window.innerHeight;

    const diam = sphereScreenDiameter(camera, R, w, h);
    const mid = project(_origin, camera, w, h);

    // Match inset of HUD footer text → screen bottom edge
    const edge = measureHudBottomInset();
    wrap.style.setProperty("--ct-scale-edge", `${edge}px`);

    hEl.root.style.width = `${diam}px`;
    hEl.root.style.left = `${Math.round(mid.x - diam * 0.5)}px`;

    vEl.root.style.height = `${diam}px`;
    vEl.root.style.top = `${Math.round(mid.y - diam * 0.5)}px`;
  }

  function destroy() {
    wrap.remove();
  }

  return { tick, destroy, el: wrap };
}

/** @param {"h"|"v"} axis */
function buildScale(axis) {
  const root = document.createElement("div");
  root.className = `ct-scale ct-scale--${axis}`;

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "ct-scale__svg");
  svg.setAttribute("aria-hidden", "true");

  const isH = axis === "h";
  // ViewBox: H → 320×28, V → 28×320 (ticks toward scene)
  const vbW = isH ? FOV_MM : 28;
  const vbH = isH ? 28 : FOV_MM;
  svg.setAttribute("viewBox", `0 0 ${vbW} ${vbH}`);
  svg.setAttribute("preserveAspectRatio", "none");

  const g = document.createElementNS(svgNS, "g");
  g.setAttribute("fill", "none");
  g.setAttribute("stroke", "currentColor");
  g.setAttribute("stroke-width", "1");
  g.setAttribute("stroke-linecap", "square");
  g.setAttribute("vector-effect", "non-scaling-stroke");

  // Baseline sits on the outer edge; ticks point toward the sphere
  const base = document.createElementNS(svgNS, "line");
  if (isH) {
    base.setAttribute("x1", "0");
    base.setAttribute("y1", "26");
    base.setAttribute("x2", String(FOV_MM));
    base.setAttribute("y2", "26");
  } else {
    base.setAttribute("x1", "26");
    base.setAttribute("y1", "0");
    base.setAttribute("x2", "26");
    base.setAttribute("y2", String(FOV_MM));
  }
  g.appendChild(base);

  for (let mm = 0; mm <= FOV_MM; mm += MINOR_MM) {
    const isMajor = mm % MAJOR_MM === 0;
    const isMid = !isMajor && mm % MID_MM === 0;
    const len = isMajor ? 14 : isMid ? 9 : 5;

    const tick = document.createElementNS(svgNS, "line");
    if (isH) {
      tick.setAttribute("x1", String(mm));
      tick.setAttribute("x2", String(mm));
      tick.setAttribute("y1", String(26));
      tick.setAttribute("y2", String(26 - len));
    } else {
      // 0 mm at bottom → increasing upward; ticks point left (toward sphere)
      const y = FOV_MM - mm;
      tick.setAttribute("y1", String(y));
      tick.setAttribute("y2", String(y));
      tick.setAttribute("x1", "26");
      tick.setAttribute("x2", String(26 - len));
    }
    g.appendChild(tick);
  }

  svg.appendChild(g);
  root.appendChild(svg);

  // Labels at major ticks + unit
  const labels = document.createElement("div");
  labels.className = "ct-scale__labels";
  for (let mm = 0; mm <= FOV_MM; mm += MAJOR_MM) {
    const span = document.createElement("span");
    span.className = "ct-scale__num";
    if (mm === 0) span.classList.add("is-min");
    if (mm === FOV_MM) span.classList.add("is-max");
    // V: unit sits left of 0
    span.textContent = !isH && mm === 0 ? "MM 0" : String(mm);
    // H: 0→left; V: 0→bottom
    const t = isH ? mm / FOV_MM : 1 - mm / FOV_MM;
    span.style.setProperty("--t", String(t));
    labels.appendChild(span);
  }
  if (isH) {
    const unit = document.createElement("span");
    unit.className = "ct-scale__unit";
    unit.textContent = "MM";
    root.append(labels, unit);
  } else {
    root.append(labels);
  }

  return { root, svg };
}
