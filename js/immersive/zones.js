/**
 * Quattro zone HR — palette liquid-patch + grade radiography.
 * Raggio sfera fisso: cambia solo coverage / pulse / fluid.
 */

export const SPHERE_RADIUS = 56;

export const ZONES = {
  1: {
    id: 1,
    label: "Zone 1",
    range: "< 136 bpm",
    rangeLabel: "Zone 1: < 136 bpm",
    fallbackBpm: 118,
    // Azzurro più chiaro + nero
    bgA: "#5a96bc",
    bgB: "#020508",
    bgC: "#9ecce8",
    accent: "#5aa8d4",
    radius: SPHERE_RADIUS,
    coverage: 0.42,
    saturation: 0.38,
    contrast: 1.12,
    brightness: 1.42,
    pulseDepth: 0.12,
    groupPulse: 0.045,
    fluidSpeed: 0.85,
    audio: { gain: 0.22, bass: 0.32, drive: 0.05 },
  },
  2: {
    id: 2,
    label: "Zone 2",
    range: "137 - 150 bpm",
    rangeLabel: "Zone 2: 137 - 150 bpm",
    fallbackBpm: 143,
    // Verde più chiaro + nero
    bgA: "#5a8a40",
    bgB: "#020604",
    bgC: "#a0c878",
    accent: "#6a9a48",
    radius: SPHERE_RADIUS,
    coverage: 0.56,
    saturation: 0.42,
    contrast: 1.38,
    brightness: 1.22,
    pulseDepth: 0.16,
    groupPulse: 0.07,
    fluidSpeed: 1.25,
    audio: { gain: 0.4, bass: 0.55, drive: 0.16 },
  },
  3: {
    id: 3,
    label: "Zone 3",
    range: "151 - 164 bpm",
    rangeLabel: "Zone 3: 151 - 164 bpm",
    fallbackBpm: 158,
    // Arancio più chiaro + nero
    bgA: "#d07030",
    bgB: "#060201",
    bgC: "#f0b070",
    accent: "#e87830",
    radius: SPHERE_RADIUS,
    coverage: 0.7,
    saturation: 0.46,
    contrast: 1.68,
    brightness: 1.0,
    pulseDepth: 0.2,
    groupPulse: 0.1,
    fluidSpeed: 1.7,
    audio: { gain: 0.62, bass: 0.75, drive: 0.38 },
  },
  4: {
    id: 4,
    label: "Zone 4",
    range: "165+ bpm",
    rangeLabel: "Zone 4: 165+ bpm",
    fallbackBpm: 172,
    // Rosso più chiaro + nero
    bgA: "#c02838",
    bgB: "#020001",
    bgC: "#e86870",
    accent: "#e01830",
    radius: SPHERE_RADIUS,
    coverage: 0.86,
    saturation: 0.5,
    contrast: 2.05,
    brightness: 0.82,
    pulseDepth: 0.26,
    groupPulse: 0.14,
    fluidSpeed: 2.4,
    audio: { gain: 0.92, bass: 0.95, drive: 0.8 },
  },
};

export const ZONE_ORDER = [1, 2, 3, 4];

export function zoneConfig(id) {
  return ZONES[id] || ZONES[1];
}

/** Continui intervalli BPM (nessun buco a 136). */
export function zoneFromBpm(bpm) {
  const v = Number(bpm);
  if (!Number.isFinite(v)) return 1;
  if (v < 137) return 1; // Zone 1: < 136 (+ 136 di bordo)
  if (v <= 150) return 2; // Zone 2: 137 - 150
  if (v <= 164) return 3; // Zone 3: 151 - 164
  return 4; // Zone 4: 165+
}
