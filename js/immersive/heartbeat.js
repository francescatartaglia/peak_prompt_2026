/**
 * Shared systole / diastole timing for visuals + procedural audio.
 */

/** Dub lands this fraction of a beat after the lub (systole). */
export const DUB_RATIO = 0.28;

/** Peak inward shrink (1 → 1 - depth). */
export const SYSTOLE_DEPTH = 0.26;

export function clampBpm(bpm) {
  return Math.max(40, Math.min(220, Number(bpm) || 120));
}

export function secondsPerBeat(bpm) {
  return 60 / clampBpm(bpm);
}

/**
 * Asymmetric peak: fast attack (systole), slower release (diastole).
 * `phase` is 0..1 within the beat cycle.
 */
function sharpPeak(phase, center, width) {
  let d = phase - center;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  const sigma = d < 0 ? width * 0.4 : width * 1.45;
  return Math.exp(-((d / sigma) ** 2));
}

/**
 * Contraction envelope at absolute transport time `timeSec`.
 * Returns scale ≤ 1 (shrink on beat) and contraction 0..1.
 */
export function contractionEnvelope(timeSec, bpm) {
  const spb = secondsPerBeat(bpm);
  const t = Math.max(0, timeSec);
  const phase = (((t % spb) + spb) % spb) / spb;

  const lub = sharpPeak(phase, 0, 0.06);
  const dub = sharpPeak(phase, DUB_RATIO, 0.05) * 0.55;
  const contraction = Math.min(1, Math.max(lub, dub));

  return {
    scale: 1 - contraction * SYSTOLE_DEPTH,
    contraction,
    phase,
    spb,
  };
}
