/**
 * Load hike_viz.json and group media by the 4 HR zones.
 */

export const ZONE_ORDER = [1, 2, 3, 4];

export async function loadHikeData(url = "data/hike_viz.json") {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Missing data/hike_viz.json — run: python3 scripts/process_hike_viz.py");
  }
  const raw = await res.json();
  return normalize(raw);
}

function normalize(raw) {
  const zones = {};
  for (const id of ZONE_ORDER) {
    const key = String(id);
    const meta = raw.zones?.[key] || raw.zones?.[id] || {};
    const mediaStats = raw.mediaZoneStats?.[key] || {};
    const media = (raw.media || [])
      .filter((m) => Number(m.zone) === id)
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));

    const bpms = media.map((m) => m.bpm).filter((v) => v != null);
    const avgBpm =
      mediaStats.avgBpm ??
      (bpms.length ? bpms.reduce((s, v) => s + v, 0) / bpms.length : fallbackBpm(id));

    zones[id] = {
      id,
      label: meta.label || `Zone ${id}`,
      range: meta.range || "",
      color: meta.color || "#ffffff",
      tint: meta.tint || meta.color || "#ffffff",
      avgBpm: Number(avgBpm) || fallbackBpm(id),
      media,
      timeMinutes: raw.zoneStats?.[key]?.minutes ?? null,
      timePercent: raw.zoneStats?.[key]?.percent ?? null,
    };
  }

  return {
    title: raw.title || "Rifugio Lagazuoi",
    stats: raw.stats || {},
    zones,
  };
}

function fallbackBpm(zoneId) {
  return { 1: 120, 2: 143, 3: 158, 4: 172 }[zoneId] || 120;
}

export function zoneList(data) {
  return ZONE_ORDER.map((id) => data.zones[id]);
}
