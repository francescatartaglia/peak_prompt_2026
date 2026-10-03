/**
 * Slider volume verticale laterale (custom: drag affidabile).
 */

export function createVolumeSlider(
  root,
  { value = 0.55, onChange, label = "vol", ariaLabel = "Volume" } = {}
) {
  let vol = Math.min(1, Math.max(0, Number(value) || 0));

  root.innerHTML = `
    <div class="vol-bar" role="group" aria-label="${ariaLabel}">
      <div class="vol-track" data-vol-track>
        <div class="vol-fill" data-vol-fill></div>
        <button
          type="button"
          class="vol-thumb"
          data-vol-thumb
          role="slider"
          aria-label="${ariaLabel}"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="${Math.round(vol * 100)}"
          aria-orientation="vertical"
        ></button>
      </div>
      <span class="vol-label" aria-hidden="true">${label}</span>
    </div>
  `;

  const track = root.querySelector("[data-vol-track]");
  const fill = root.querySelector("[data-vol-fill]");
  const thumb = root.querySelector("[data-vol-thumb]");
  let dragging = false;

  function paint() {
    const pct = Math.round(vol * 1000) / 10; // 0.1% precision, no float junk
    root.style.setProperty("--vol", `${pct}%`);
    fill.style.height = `${pct}%`;
    thumb.style.bottom = `calc(${pct}% - 6px)`;
    thumb.setAttribute("aria-valuenow", String(Math.round(vol * 100)));
  }

  function setVolume(next, { silent = false } = {}) {
    vol = Math.min(1, Math.max(0, Number(next) || 0));
    paint();
    if (!silent) onChange?.(vol);
  }

  function volumeFromClientY(clientY) {
    const rect = track.getBoundingClientRect();
    if (rect.height <= 0) return vol;
    // Alto = volume alto
    const t = 1 - (clientY - rect.top) / rect.height;
    return Math.min(1, Math.max(0, t));
  }

  function onPointerDown(e) {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    thumb.setPointerCapture?.(e.pointerId);
    setVolume(volumeFromClientY(e.clientY));
  }

  function onPointerMove(e) {
    if (!dragging) return;
    e.preventDefault();
    setVolume(volumeFromClientY(e.clientY));
  }

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    try {
      thumb.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  track.addEventListener("pointerdown", onPointerDown);
  track.addEventListener("pointermove", onPointerMove);
  track.addEventListener("pointerup", onPointerUp);
  track.addEventListener("pointercancel", onPointerUp);
  // Evita che OrbitControls / page scroll rubino il gesto
  track.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });

  thumb.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault();
      setVolume(vol + step);
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault();
      setVolume(vol - step);
    } else if (e.key === "Home") {
      e.preventDefault();
      setVolume(1);
    } else if (e.key === "End") {
      e.preventDefault();
      setVolume(0);
    }
  });

  paint();

  return {
    getVolume: () => vol,
    setVolume,
  };
}
