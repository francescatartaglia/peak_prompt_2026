/**
 * Custom CRT cursor: pixel crest square → 45° diamond on hot targets
 * (DOM clickables + sphere media hover).
 */

import * as THREE from "three";

const HOT =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="slider"], [role="link"], [data-cursor="hot"]';

export function createCrtCursor({
  getCamera,
  getMeshes,
  isMediaHotEnabled,
} = {}) {
  if (typeof window === "undefined") return { dispose() {}, reset() {}, setHot() {} };
  if (!window.matchMedia("(pointer: fine)").matches) {
    return { dispose() {}, reset() {}, setHot() {} };
  }

  const root = document.documentElement;
  root.classList.add("has-crt-cursor");

  const el = document.createElement("div");
  el.id = "crt-cursor";
  el.className = "crt-cursor";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML =
    '<img class="crt-cursor__sq" src="assets/cursor-sq.svg" alt="" draggable="false" width="16" height="16" />';
  document.body.appendChild(el);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let visible = false;

  function setPos(x, y) {
    el.style.transform = `translate(${x}px, ${y}px)`;
  }

  function setHot(hot) {
    el.classList.toggle("is-hot", !!hot);
  }

  function reset() {
    setHot(false);
  }

  function hitDomHot(x, y) {
    const t = document.elementFromPoint(x, y);
    return !!(t && t.closest && t.closest(HOT));
  }

  function hitMediaHot(x, y) {
    if (!isMediaHotEnabled?.()) return false;
    const camera = getCamera?.();
    const meshes = (getMeshes?.() || []).filter((m) => m?.visible && !m.userData?.slideshowLock);
    if (!camera || !meshes.length) return false;
    pointer.x = (x / window.innerWidth) * 2 - 1;
    pointer.y = -(y / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(meshes, false).length > 0;
  }

  function hitHot(x, y) {
    return hitDomHot(x, y) || hitMediaHot(x, y);
  }

  function onMove(e) {
    if (!visible) {
      visible = true;
      el.classList.add("is-on");
    }
    setPos(e.clientX, e.clientY);
    setHot(hitHot(e.clientX, e.clientY));
  }

  function onDown(e) {
    setPos(e.clientX, e.clientY);
    setHot(hitHot(e.clientX, e.clientY));
  }

  function onLeave() {
    visible = false;
    el.classList.remove("is-on", "is-hot");
  }

  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onDown, { passive: true });
  document.addEventListener("mouseleave", onLeave);

  return {
    setHot,
    reset,
    dispose() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.removeEventListener("mouseleave", onLeave);
      root.classList.remove("has-crt-cursor");
      el.remove();
    },
  };
}
