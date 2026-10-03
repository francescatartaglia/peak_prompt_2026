/**
 * Slider zone ultra-minimale (battito sempre attivo in background).
 */

import { ZONE_ORDER, zoneConfig } from "./zones.js";

export function createZoneSlider(root, { startZone = 1, onChange } = {}) {
  const marks = ZONE_ORDER.map(
    (id) =>
      `<button type="button" class="zone-mark" data-zone="${id}" style="--z:${zoneConfig(id).accent}" aria-label="Zona ${id}"></button>`
  ).join("");

  root.innerHTML = `
    <div class="zone-bar" role="group" aria-label="Zona battito">
      <div class="zone-slider">
        <div class="zone-fill" id="zone-fill"></div>
        <div class="zone-marks">${marks}</div>
        <input type="range" id="zone-range" min="1" max="4" step="1" value="${startZone}" aria-label="Zona heart rate" />
      </div>
    </div>
  `;

  const input = root.querySelector("#zone-range");
  const fill = root.querySelector("#zone-fill");
  let zone = startZone;

  function paint() {
    const t = ((zone - 1) / 3) * 100;
    fill.style.width = `${Math.max(t, 1.5)}%`;
    root.style.setProperty("--accent", zoneConfig(zone).accent);
    root.querySelectorAll(".zone-mark").forEach((btn) => {
      btn.classList.toggle("is-active", Number(btn.dataset.zone) === zone);
    });
  }

  function setZone(next, { silent = false } = {}) {
    zone = Math.min(4, Math.max(1, Math.round(next)));
    input.value = String(zone);
    paint();
    if (!silent) onChange?.(zone);
  }

  input.addEventListener("input", () => setZone(Number(input.value)));
  root.querySelectorAll(".zone-mark").forEach((btn) => {
    btn.addEventListener("click", () => setZone(Number(btn.dataset.zone)));
  });

  paint();

  return {
    getZone: () => zone,
    setZone,
  };
}
