/**
 * Slider volume verticale laterale (riutilizzabile).
 */

export function createVolumeSlider(
  root,
  { value = 0.55, onChange, label = "vol", ariaLabel = "Volume" } = {}
) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);

  root.innerHTML = `
    <div class="vol-bar" role="group" aria-label="${ariaLabel}">
      <input
        type="range"
        class="vol-range"
        min="0"
        max="100"
        step="1"
        value="${pct}"
        aria-label="${ariaLabel}"
        orient="vertical"
      />
      <span class="vol-label" aria-hidden="true">${label}</span>
    </div>
  `;

  const input = root.querySelector(".vol-range");
  let vol = pct / 100;

  function paint() {
    root.style.setProperty("--vol", `${vol * 100}%`);
  }

  function setVolume(next, { silent = false } = {}) {
    vol = Math.min(1, Math.max(0, Number(next) || 0));
    input.value = String(Math.round(vol * 100));
    paint();
    if (!silent) onChange?.(vol);
  }

  input.addEventListener("input", () => setVolume(Number(input.value) / 100));
  paint();

  return {
    getVolume: () => vol,
    setVolume,
  };
}
