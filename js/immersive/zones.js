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
    saturation: 0.28, // molto piatto
    contrast: 0.72,
    pulseDepth: 0.06,
    groupPulse: 0.03,
    audio: { gain: 0.22, bass: 0.32, drive: 0.05 },
  },
  2: {
    id: 2,
    label: "Zone 2",
    range: "137–150 bpm",
    fallbackBpm: 143,
    // Verde — chiaro / saturo / scuro
    bgA: "#d4f06a",
    bgB: "#3d9a28",
    bgC: "#f0ffb0",
    accent: "#4aaa2a",
    radius: 22,
    coverage: 0.85,
    saturation: 0.85,
    contrast: 1.05,
    pulseDepth: 0.1,
    groupPulse: 0.055,
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
    pulseDepth: 0.15,
    groupPulse: 0.1,
    audio: { gain: 0.62, bass: 0.75, drive: 0.38 },
  },
  4: {
    id: 4,
    label: "Zone 4",
    range: "165+ bpm",
    fallbackBpm: 172,
    // Rosso — shade diverse, più scuro
    bgA: "#c42828",
    bgB: "#3a060c",
    bgC: "#8a1018",
    accent: "#b01820",
    radius: 8.4,
    coverage: 1.65, // zero gap, parete continua
    saturation: 2.25, // iper saturo
    contrast: 1.9,
    pulseDepth: 0.2,
    groupPulse: 0.14,
    audio: { gain: 0.92, bass: 0.95, drive: 0.8 },
  },
};

export const ZONE_ORDER = [1, 2, 3, 4];

export function zoneConfig(id) {
  return ZONES[id] || ZONES[1];
}
