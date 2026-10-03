/**
 * Quattro zone HR — densità, grade flat→ricco, sfondi colorati dinamici.
 */

export const ZONES = {
  1: {
    id: 1,
    label: "Zone 1",
    range: "< 136 bpm",
    fallbackBpm: 118,
    // Azzurro — chiaro / medio / scuro più contrastati
    bgA: "#b8e4ff",
    bgB: "#1e7ec4",
    bgC: "#e8f6ff",
    accent: "#2b8fd4",
    radius: 32,
    coverage: 0.42,
    saturation: 0.72,
    contrast: 0.92,
    brightness: 1.28,
    pulseDepth: 0.06,
    groupPulse: 0.03,
    // Dinamismo sfondo: calmo in zona 1, accelera fino alla 4
    fluidSpeed: 0.42,
    audio: { gain: 0.22, bass: 0.32, drive: 0.05 },
  },
  2: {
    id: 2,
    label: "Zone 2",
    range: "137–150 bpm",
    fallbackBpm: 143,
    // Verde bosco — ancora un filo più chiaro
    bgA: "#6fa856",
    bgB: "#245428",
    bgC: "#a4c96e",
    accent: "#4a8f3c",
    radius: 22,
    coverage: 0.85,
    saturation: 1.2,
    contrast: 1.18,
    brightness: 1,
    pulseDepth: 0.1,
    groupPulse: 0.055,
    fluidSpeed: 0.75,
    audio: { gain: 0.4, bass: 0.55, drive: 0.16 },
  },
  3: {
    id: 3,
    label: "Zone 3",
    range: "151–164 bpm",
    fallbackBpm: 158,
    // Arancio → rosso (mix caldo)
    bgA: "#ffb04a",
    bgB: "#e04828",
    bgC: "#ffd078",
    accent: "#e85a22",
    radius: 14,
    coverage: 1.2,
    saturation: 1.55,
    contrast: 1.42,
    brightness: 1,
    pulseDepth: 0.15,
    groupPulse: 0.1,
    fluidSpeed: 1.25,
    audio: { gain: 0.62, bass: 0.75, drive: 0.38 },
  },
  4: {
    id: 4,
    label: "Zone 4",
    range: "165+ bpm",
    fallbackBpm: 172,
    // Rosso — contrasto alto tra chiaro / nero / saturo
    bgA: "#ff5c4a",
    bgB: "#0a0002",
    bgC: "#c00818",
    accent: "#e01228",
    radius: 8.4,
    coverage: 1.65, // zero gap, parete continua
    saturation: 2.25, // iper saturo
    contrast: 1.9,
    brightness: 1,
    pulseDepth: 0.2,
    groupPulse: 0.14,
    fluidSpeed: 1.9,
    audio: { gain: 0.92, bass: 0.95, drive: 0.8 },
  },
};

export const ZONE_ORDER = [1, 2, 3, 4];

export function zoneConfig(id) {
  return ZONES[id] || ZONES[1];
}
