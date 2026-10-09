/**
 * Fit framed media + caption into the free viewport (desktop: right of HUD).
 * Default: caption to the right, top-aligned with media.
 * Below + left-aligned only when the free band is too narrow (dida would
 * nearly touch the edge). Mobile: always below, stack optically centered.
 */

import * as THREE from "three";

const _v = new THREE.Vector3();

function isMobileViewport() {
  return document.body.classList.contains("is-mobile");
}

/** Safe rectangle for media/caption (CSS px). */
export function getMediaSafeRect() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const mobile = isMobileViewport();
  const pad = mobile ? 14 : 20;
  let left = pad;
  let right = w - pad;
  let top = pad;
  let bottom = h - pad;

  if (mobile) {
    const gap = 12;
    const sound = document.querySelector(".hud-control--sound");
    const heart = document.querySelector(".hud-control--heart");
    const autoplay = document.querySelector(".hud-control--autoplay");
    const zone = document.querySelector(".hud-control--zone");
    // Prefer live control boxes so media stays in the free center band
    if (sound) {
      const r = sound.getBoundingClientRect();
      if (r.width > 1) left = Math.max(left, Math.round(r.right + gap));
    } else {
      left = Math.max(left, 72);
    }
    if (heart) {
      const r = heart.getBoundingClientRect();
      if (r.width > 1) right = Math.min(right, Math.round(r.left - gap));
    } else {
      right = Math.min(right, w - 72);
    }
    if (autoplay) {
      const r = autoplay.getBoundingClientRect();
      if (r.height > 1) top = Math.max(top, Math.round(r.bottom + gap));
    } else {
      top = Math.max(top, 56);
    }
    if (zone) {
      const r = zone.getBoundingClientRect();
      if (r.height > 1) bottom = Math.min(bottom, Math.round(r.top - gap));
    } else {
      bottom = Math.min(bottom, h - 96);
    }
  } else {
    const hud = document.querySelector(".hud");
    if (hud) {
      const cs = getComputedStyle(hud);
      if (cs.display !== "none" && cs.visibility !== "hidden") {
        const r = hud.getBoundingClientRect();
        if (r.width > 1) left = Math.max(left, Math.round(r.right + 12));
      }
    }
  }

  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(64, right - left),
    height: Math.max(64, bottom - top),
  };
}

/**
 * Scale + preferred caption layout so the full image (and dida) fit on screen.
 * @returns {{ scale: number, layout: 'side'|'below', captionLiftPx: number }}
 */
export function computeMediaFit(mesh, camera, { frameDist = 5.35, maxDesiredH = 2.15 } = {}) {
  if (!mesh || !camera) {
    return { scale: 1, layout: "side", captionLiftPx: 0 };
  }
  const baseW = mesh.userData?.baseW || mesh.geometry?.userData?.width || 2.2;
  const baseH = mesh.userData?.baseH || mesh.geometry?.userData?.height || 2.2;
  const safe = getMediaSafeRect();
  const gap = 16;
  /** Minimum clear width needed beside media for a readable side caption */
  const minSideCaption = 118;
  const captionCol = Math.min(200, Math.max(minSideCaption, safe.width * 0.28));
  const captionBlock = 92;
  const mobile = isMobileViewport();

  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const halfH = Math.tan(vFov * 0.5) * frameDist;
  const halfW = halfH * Math.max(camera.aspect, 0.2);
  const W = window.innerWidth;
  const H = window.innerHeight;

  function scaleFor(maxPxW, maxPxH) {
    const sH = ((maxPxH / H) * 2 * halfH) / Math.max(baseH, 0.05);
    const sW = ((maxPxW / W) * 2 * halfW) / Math.max(baseW, 0.05);
    return Math.min(sH, sW);
  }

  const aestheticCap = maxDesiredH / Math.max(baseH, 0.05);

  let layout = "side";
  let scale;
  let captionLiftPx = 0;

  if (mobile) {
    layout = "below";
    scale = scaleFor(safe.width, safe.height - gap - captionBlock);
    scale = THREE.MathUtils.clamp(Math.min(scale, aestheticCap) * 0.92, 0.12, aestheticCap);
    captionLiftPx = (gap + captionBlock) * 0.5;
  } else {
    // Natural media size first (aesthetic), then see if dida fits beside
    scale = scaleFor(safe.width, safe.height);
    scale = THREE.MathUtils.clamp(Math.min(scale, aestheticCap) * 0.92, 0.12, aestheticCap);

    const mediaPxW = ((baseW * scale) / (2 * halfW)) * W;
    const roomRight = safe.width - mediaPxW - gap;
    // Below only when free band is so narrow the dida would nearly touch the edge
    if (roomRight < minSideCaption) {
      layout = "below";
      scale = scaleFor(safe.width, safe.height - gap - captionBlock);
      scale = THREE.MathUtils.clamp(Math.min(scale, aestheticCap) * 0.92, 0.12, aestheticCap);
      captionLiftPx = (gap + captionBlock) * 0.5;
    } else {
      layout = "side";
      // Optional: if media+caption would overflow, shrink slightly to keep side
      const sideCap = scaleFor(safe.width - gap - captionCol, safe.height);
      if (sideCap < scale && mediaPxW + gap + minSideCaption > safe.width) {
        scale = THREE.MathUtils.clamp(sideCap * 0.92, 0.12, aestheticCap);
      }
    }
  }

  return { scale, layout, captionLiftPx };
}

/**
 * Screen AABB of a flat media mesh (CSS px).
 * @returns {{ minX: number, maxX: number, minY: number, maxY: number } | null}
 */
export function projectMediaBounds(mesh, camera) {
  if (!mesh || !camera) return null;
  camera.updateMatrixWorld(true);
  mesh.updateMatrixWorld(true);

  const w0 = mesh.geometry?.userData?.width || mesh.userData?.baseW || 2.2;
  const h0 = mesh.geometry?.userData?.height || mesh.userData?.baseH || 2.2;
  const hw = w0 * 0.5;
  const hh = h0 * 0.5;
  const locals = [
    [-hw, hh, 0],
    [hw, hh, 0],
    [-hw, -hh, 0],
    [hw, -hh, 0],
  ];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const W = window.innerWidth;
  const H = window.innerHeight;

  for (const [lx, ly, lz] of locals) {
    _v.set(lx, ly, lz).applyMatrix4(mesh.matrixWorld).project(camera);
    if (_v.z < -1 || _v.z > 1) continue;
    const sx = (_v.x * 0.5 + 0.5) * W;
    const sy = (-_v.y * 0.5 + 0.5) * H;
    minX = Math.min(minX, sx);
    maxX = Math.max(maxX, sx);
    minY = Math.min(minY, sy);
    maxY = Math.max(maxY, sy);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  return { minX, maxX, minY, maxY };
}

/**
 * Caption to the right (top-aligned) when there is room; otherwise below,
 * left-aligned to the image’s left edge.
 * @returns {{ left: number, top: number, mode: 'side'|'below' } | null}
 */
export function layoutMediaCaption(mesh, camera, captionEl) {
  const bounds = projectMediaBounds(mesh, camera);
  if (!bounds) return null;
  const { minX, maxX, minY, maxY } = bounds;
  const safe = getMediaSafeRect();
  const gap = 14;
  const cw = Math.max(captionEl?.offsetWidth || 0, 120);
  const ch = Math.max(captionEl?.offsetHeight || 0, 56);
  const mobile = isMobileViewport();
  const minSideCaption = 118;

  if (!mobile) {
    const spaceRight = safe.right - maxX - gap;
    // Side when dida won't nearly touch the free-band edge
    if (spaceRight >= minSideCaption) {
      return {
        left: maxX + gap,
        top: Math.max(safe.top, minY - 2),
        mode: "side",
      };
    }
  }

  // Below — left edge flush with image left
  let top = maxY + gap;
  if (top + ch > safe.bottom) {
    top = Math.max(safe.top, safe.bottom - ch);
  }

  return {
    left: Math.max(safe.left, Math.min(minX, safe.right - cw)),
    top,
    mode: "below",
  };
}

/**
 * World-space upward nudge so media + below-caption stack centers optically.
 */
export function captionStackLiftWorld(camera, frameDist, captionLiftPx) {
  if (!camera || !(captionLiftPx > 0)) return 0;
  const H = Math.max(1, window.innerHeight);
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const halfH = Math.tan(vFov * 0.5) * frameDist;
  return (captionLiftPx / H) * 2 * halfH;
}

const _axis = new THREE.Vector3();

/**
 * World-space lateral nudge so media sits on the free-band horizontal center
 * when caption is below (optical axis alone can sit off true free-band mid).
 */
export function mediaFreeBandCenterShiftWorld(camera, frameDist, layout) {
  if (!camera || layout !== "below") return 0;
  const safe = getMediaSafeRect();
  const targetX = (safe.left + safe.right) * 0.5;

  camera.getWorldDirection(_axis);
  _v.copy(camera.position).addScaledVector(_axis, frameDist).project(camera);
  const W = Math.max(1, window.innerWidth);
  const screenX = (_v.x * 0.5 + 0.5) * W;
  const shiftPx = targetX - screenX;
  if (Math.abs(shiftPx) < 0.5) return 0;

  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const halfH = Math.tan(vFov * 0.5) * frameDist;
  const halfW = halfH * Math.max(camera.aspect, 0.2);
  return (shiftPx / W) * 2 * halfW;
}
