/**
 * Hover readout for sphere media — white mono metadata on the live background.
 */

import * as THREE from "three";
import { morphTextInPlace } from "./textMorph.js";

function basename(path) {
  const s = String(path || "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i >= 0 ? s.slice(i + 1) : s;
}

/** DSC… copy.JPG → DSC….JPG */
export function displayMediaName(asset) {
  const raw = String(asset?.id || basename(asset?.path) || "UNKNOWN");
  return raw.replace(/^(DSC\d+)\s+copy(\.[^.]+)$/i, "$1$2");
}

export function mediaFormat(asset) {
  const name = displayMediaName(asset);
  const dot = name.lastIndexOf(".");
  if (dot < 0) return asset?.kind === "video" ? "MP4" : "JPG";
  return name.slice(dot + 1).toUpperCase();
}

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatMediaTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).replace("T", " ").replace(/\.\d+Z?$/, "");
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function mediaHoverLines(asset) {
  return [
    displayMediaName(asset),
    mediaFormat(asset),
    formatBytes(asset?.bytes),
    formatMediaTime(asset?.time),
  ];
}

/**
 * @param {HTMLElement} root
 * @param {{ camera: THREE.Camera, domElement: HTMLElement, getMeshes: () => THREE.Object3D[], isEnabled?: () => boolean }} opts
 */
export function createMediaHover(root, { camera, domElement, getMeshes, isEnabled } = {}) {
  const el = document.createElement("div");
  el.className = "media-hover";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
    <div data-line="name"></div>
    <div data-line="format"></div>
    <div data-line="size"></div>
    <div data-line="time"></div>
  `;
  root.appendChild(el);

  const lines = {
    name: el.querySelector('[data-line="name"]'),
    format: el.querySelector('[data-line="format"]'),
    size: el.querySelector('[data-line="size"]'),
    time: el.querySelector('[data-line="time"]'),
  };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovering = null;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let hasPointer = false;
  let lastAssetKey = "";

  function hide() {
    hovering = null;
    lastAssetKey = "";
    el.classList.remove("is-on");
  }

  function place(x, y) {
    const pad = 16;
    const w = el.offsetWidth || 180;
    const h = el.offsetHeight || 90;
    let left = x + 18;
    let top = y + 18;
    if (left + w + pad > window.innerWidth) left = x - w - 14;
    if (top + h + pad > window.innerHeight) top = y - h - 14;
    left = Math.max(pad, left);
    top = Math.max(pad, top);
    el.style.transform = `translate(${left}px, ${top}px)`;
  }

  function show(asset, x, y) {
    const key = asset?.id || asset?.path || "";
    const vals = mediaHoverLines(asset);
    const nodes = [lines.name, lines.format, lines.size, lines.time];

    if (key !== lastAssetKey) {
      lastAssetKey = key;
      nodes.forEach((node, i) => {
        const text = vals[i] ?? "";
        node.textContent = "";
        node.style.minWidth = `${Math.max(text.length, 1)}ch`;
        // Stesso morph leggero del gate, senza audio
        morphTextInPlace(node, text, {
          click: false,
          slowLock: 42,
          fastLock: 30,
          scrambleMs: 18,
          startDelay: 36 + i * 48,
        });
      });
    }

    el.classList.add("is-on");
    place(x, y);
  }

  function pick(clientX, clientY) {
    if (!camera || (isEnabled && !isEnabled()) || dragging) {
      hide();
      return;
    }
    const meshes = (getMeshes?.() || []).filter((m) => m?.visible);
    if (!meshes.length) {
      hide();
      return;
    }

    pointer.x = (clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(meshes, false);
    const mesh = hits[0]?.object;
    const asset = mesh?.userData?.asset;
    if (!asset) {
      hide();
      return;
    }
    hovering = mesh;
    show(asset, clientX, clientY);
  }

  function onMove(e) {
    hasPointer = true;
    lastX = e.clientX;
    lastY = e.clientY;
    pick(e.clientX, e.clientY);
  }

  function onDown() {
    dragging = true;
    hide();
  }

  function onUp(e) {
    dragging = false;
    pick(e.clientX ?? lastX, e.clientY ?? lastY);
  }

  function onLeave() {
    hasPointer = false;
    hide();
  }

  domElement.addEventListener("pointermove", onMove);
  domElement.addEventListener("pointerdown", onDown);
  window.addEventListener("pointerup", onUp);
  domElement.addEventListener("pointerleave", onLeave);

  return {
    hide,
    /** Ri-raycast a cursore fermo (sfera in rotazione). */
    tick() {
      if (!hasPointer) return;
      if (isEnabled && !isEnabled()) return;
      pick(lastX, lastY);
    },
    get hovering() {
      return hovering;
    },
    dispose() {
      domElement.removeEventListener("pointermove", onMove);
      domElement.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      domElement.removeEventListener("pointerleave", onLeave);
      el.remove();
    },
  };
}
