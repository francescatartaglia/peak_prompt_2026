/**
 * Quattro zone HR — densità, grade flat→ricco, sfondi colorati dinamici.
 * Raggio sfera fisso: cambia solo la dimensione delle immagini (coverage).
 */

/** Raggio costante in tutte le zone — spazio ampio centro ↔ pareti. */
export const SPHERE_RADIUS = 56;

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
    radius: SPHERE_RADIUS,
    // Più piccole: aria tra le foto
    coverage: 0.34,
    saturation: 1,
    contrast: 1,
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
    radius: SPHERE_RADIUS,
    // Un gradino sopra la zona 1
    coverage: 0.48,
    saturation: 1,
    contrast: 1,
    brightness: 1.28,
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
    radius: SPHERE_RADIUS,
    // Ancora più grandi, senza riempire tutto
    coverage: 0.62,
    saturation: 1,
    contrast: 1,
    brightness: 1.28,
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
    radius: SPHERE_RADIUS,
    // Le più grandi: un filo sopra la vecchia zona 2 (~0.68)
    coverage: 0.78,
    saturation: 1,
    contrast: 1,
    brightness: 1.28,
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
