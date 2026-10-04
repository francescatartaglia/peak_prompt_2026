/**
 * Load hike media (photos + videos) + audio ambient per zona.
 */

import { ZONE_ORDER, zoneConfig } from "./zones.js";

export async function loadHikeData(url = "data/hike_viz.json") {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Missing data/hike_viz.json — run: python3 scripts/process_hike_viz.py");
  }
  const raw = await res.json();
  const zones = {};

  for (const id of ZONE_ORDER) {
    const key = String(id);
    const meta = raw.zones?.[key] || {};
    const stats = raw.mediaZoneStats?.[key] || {};
    const cfg = zoneConfig(id);
    const media = (raw.media || [])
      .filter((m) => Number(m.zone) === id)
      .filter((m) => m.kind === "image" || m.kind === "video")
      .map((m) => ({
        ...m,
        zone: id,
        bpm: Number(m.bpm),
        kind: m.kind,
      }))
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));

    const audio = (raw.media || [])
      .filter((m) => Number(m.zone) === id && m.kind === "audio")
      .map((m) => ({
        ...m,
        zone: id,
        bpm: Number(m.bpm),
        kind: "audio",
      }))
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));

    const bpms = media.map((m) => m.bpm).filter((v) => Number.isFinite(v));
    const avgBpm =
      stats.avgBpm ??
      (bpms.length ? bpms.reduce((s, v) => s + v, 0) / bpms.length : cfg.fallbackBpm);

    zones[id] = {
      id,
      label: meta.label || cfg.label,
      range: meta.range || cfg.range,
      color: meta.color || cfg.accent,
      avgBpm: Number(avgBpm) || cfg.fallbackBpm,
      media,
      audio,
      config: cfg,
    };
  }

  return {
    title: raw.title || "Rifugio Lagazuoi",
    gpx: raw.gpx || "assets/peak_prompt.gpx",
    track: Array.isArray(raw.track) ? raw.track : [],
    stats: raw.stats || null,
    zones,
  };
}

export function zoneList(data) {
  return ZONE_ORDER.map((id) => data.zones[id]);
}
