#!/usr/bin/env python3
"""Merge Wikiloc GPX + Apple Health HR + media timestamps → data/hike_viz.json."""

from __future__ import annotations

import csv
import json
import math
import xml.etree.ElementTree as ET
from bisect import bisect_left
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
GPX_PATH = ROOT / "assets" / "peak_prompt.gpx"
HR_CSV = ROOT / "data" / "hiking_2026-10-02_heart_rate.csv"
MEDIA_JSON = ROOT / "data" / "timeline.json"
OUT = ROOT / "data" / "hike_viz.json"

# Zone rules (4 zones; former 4+5 merged into Zone 4)
# Zone 1: < 136
# Zone 2: 137–150
# Zone 3: 151–164
# Zone 4: 165+
# bpm == 136 treated as Zone 1


def parse_iso(value: str) -> datetime:
    value = value.replace("Z", "+00:00")
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def zone_for_bpm(bpm: Optional[float]) -> Optional[int]:
    if bpm is None:
        return None
    if bpm <= 136:
        return 1
    if bpm <= 150:
        return 2
    if bpm <= 164:
        return 3
    return 4


ZONE_META = {
    1: {
        "id": 1,
        "label": "Zone 1",
        "range": "< 136 bpm",
        "color": "#3b82f6",
        "tint": "#4aa3ff",
    },
    2: {
        "id": 2,
        "label": "Zone 2",
        "range": "137–150 bpm",
        "color": "#a3e635",
        "tint": "#c8e86a",
    },
    3: {
        "id": 3,
        "label": "Zone 3",
        "range": "151–164 bpm",
        "color": "#f97316",
        "tint": "#ff9a4d",
    },
    4: {
        "id": 4,
        "label": "Zone 4",
        "range": "165+ bpm",
        "color": "#e11d48",
        "tint": "#ff2d55",
    },
}


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def load_gpx(path: Path) -> List[dict]:
    ns = {"g": "http://www.topografix.com/GPX/1/1"}
    root = ET.parse(path).getroot()
    name = (
        root.findtext("g:metadata/g:name", default="", namespaces=ns)
        or root.findtext("g:trk/g:name", default="Hike", namespaces=ns)
    )
    points = []
    for pt in root.findall(".//g:trkpt", ns):
        t = pt.findtext("g:time", default=None, namespaces=ns)
        if not t:
            continue
        ele = pt.findtext("g:ele", default=None, namespaces=ns)
        points.append(
            {
                "lat": float(pt.attrib["lat"]),
                "lon": float(pt.attrib["lon"]),
                "ele": float(ele) if ele else None,
                "time": parse_iso(t),
            }
        )
    return name.replace("Wikiloc - ", ""), points


def load_hr(path: Path) -> List[Tuple[datetime, float]]:
    rows = []
    with path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            rows.append((parse_iso(row["time_utc"]), float(row["bpm"])))
    rows.sort(key=lambda x: x[0])
    return rows


def nearest_hr(hr: List[Tuple[datetime, float]], t: datetime) -> Tuple[Optional[float], Optional[float]]:
    """Return (bpm, delta_seconds) for nearest HR sample."""
    if not hr:
        return None, None
    times = [h[0] for h in hr]
    i = bisect_left(times, t)
    candidates = []
    if i < len(hr):
        candidates.append(hr[i])
    if i > 0:
        candidates.append(hr[i - 1])
    best = min(candidates, key=lambda c: abs((c[0] - t).total_seconds()))
    return best[1], abs((best[0] - t).total_seconds())


def interpolate_hr(hr: List[Tuple[datetime, float]], t: datetime) -> Optional[float]:
    if not hr:
        return None
    times = [h[0] for h in hr]
    i = bisect_left(times, t)
    if i <= 0:
        return hr[0][1]
    if i >= len(hr):
        return hr[-1][1]
    t0, v0 = hr[i - 1]
    t1, v1 = hr[i]
    span = (t1 - t0).total_seconds()
    if span <= 0:
        return v0
    u = (t - t0).total_seconds() / span
    return v0 + (v1 - v0) * u


def build_track(points: List[dict], hr: List[Tuple[datetime, float]]) -> List[dict]:
    track = []
    dist = 0.0
    t0 = points[0]["time"]
    for i, p in enumerate(points):
        if i > 0:
            prev = points[i - 1]
            dist += haversine_m(prev["lat"], prev["lon"], p["lat"], p["lon"])
        bpm = interpolate_hr(hr, p["time"])
        nearest_bpm, delta = nearest_hr(hr, p["time"])
        zone = zone_for_bpm(bpm)
        track.append(
            {
                "index": i,
                "lat": p["lat"],
                "lon": p["lon"],
                "ele": p["ele"],
                "time": p["time"].isoformat().replace("+00:00", "Z"),
                "progress": (p["time"] - t0).total_seconds() / max((points[-1]["time"] - t0).total_seconds(), 1),
                "distance_m": round(dist, 2),
                "bpm": round(bpm, 1) if bpm is not None else None,
                "bpm_nearest": round(nearest_bpm, 1) if nearest_bpm is not None else None,
                "hr_delta_s": round(delta, 1) if delta is not None else None,
                "zone": zone,
            }
        )
    return track


def zone_time_stats(track: List[dict]) -> dict:
    """Estimate seconds spent in each zone from consecutive track segments."""
    totals = {1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0}
    for i in range(1, len(track)):
        a, b = track[i - 1], track[i]
        dt = (
            parse_iso(b["time"]) - parse_iso(a["time"])
        ).total_seconds()
        z = a["zone"] or b["zone"]
        if z:
            totals[z] += max(dt, 0)
    return {
        str(z): {
            **ZONE_META[z],
            "seconds": round(totals[z], 1),
            "minutes": round(totals[z] / 60, 1),
            "percent": round(100 * totals[z] / max(sum(totals.values()), 1), 1),
        }
        for z in range(1, 5)
    }


def media_zone_stats(media: List[dict]) -> dict:
    """Per-zone media counts and average BPM (for immersive pulse/audio)."""
    out = {}
    for z in range(1, 5):
        items = [m for m in media if m.get("zone") == z]
        bpms = [m["bpm"] for m in items if m.get("bpm") is not None]
        out[str(z)] = {
            **ZONE_META[z],
            "mediaCount": len(items),
            "avgBpm": round(sum(bpms) / len(bpms), 1) if bpms else None,
            "minBpm": round(min(bpms), 1) if bpms else None,
            "maxBpm": round(max(bpms), 1) if bpms else None,
            "byKind": {
                "image": sum(1 for m in items if m["kind"] == "image"),
                "video": sum(1 for m in items if m["kind"] == "video"),
                "audio": sum(1 for m in items if m["kind"] == "audio"),
            },
        }
    return out


def load_media(path: Path, track: List[dict]) -> List[dict]:
    if not path.exists():
        return []
    catalog = json.loads(path.read_text(encoding="utf-8"))
    assets = catalog.get("assets", [])
    # index by progress/time via nearest track point
    track_times = [parse_iso(p["time"]) for p in track]

    out = []
    for asset in assets:
        t = parse_iso(asset["time"])
        i = bisect_left(track_times, t)
        candidates = []
        if i < len(track):
            candidates.append(i)
        if i > 0:
            candidates.append(i - 1)
        best_i = min(candidates, key=lambda idx: abs((track_times[idx] - t).total_seconds()))
        pt = track[best_i]
        delta = abs((track_times[best_i] - t).total_seconds())
        file_path = ROOT / asset["path"]
        file_bytes = file_path.stat().st_size if file_path.is_file() else None
        out.append(
            {
                "id": asset["id"],
                "path": asset["path"],
                "kind": asset["kind"],
                "source": asset.get("source"),
                "time": asset["time"] if asset["time"].endswith("Z") or "+" in asset["time"] else parse_iso(asset["time"]).isoformat().replace("+00:00", "Z"),
                "duration": asset.get("duration"),
                "bytes": file_bytes,
                "onTrack": bool(asset.get("onTrack")),
                "trackIndex": best_i,
                "lat": pt["lat"],
                "lon": pt["lon"],
                "ele": pt["ele"],
                "bpm": pt["bpm"],
                "zone": pt["zone"],
                "delta_s": round(delta, 1),
                "distance_m": pt["distance_m"],
            }
        )
    out.sort(key=lambda a: a["time"])
    return out


def main() -> None:
    name, points = load_gpx(GPX_PATH)
    hr = load_hr(HR_CSV)
    track = build_track(points, hr)
    media = load_media(MEDIA_JSON, track)

    t0 = parse_iso(track[0]["time"])
    t1 = parse_iso(track[-1]["time"])
    duration_s = (t1 - t0).total_seconds()
    elevs = [p["ele"] for p in track if p["ele"] is not None]
    bpms = [p["bpm"] for p in track if p["bpm"] is not None]

    # elevation gain (positive diffs only)
    gain = 0.0
    for i in range(1, len(track)):
        if track[i]["ele"] is None or track[i - 1]["ele"] is None:
            continue
        d = track[i]["ele"] - track[i - 1]["ele"]
        if d > 0:
            gain += d

    payload = {
        "title": name or "Rifugio Lagazuoi",
        "gpx": str(GPX_PATH.relative_to(ROOT)),
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "zones": ZONE_META,
        "stats": {
            "start": track[0]["time"],
            "end": track[-1]["time"],
            "duration_seconds": round(duration_s, 1),
            "duration_minutes": round(duration_s / 60, 1),
            "distance_km": round(track[-1]["distance_m"] / 1000, 3),
            "elevation_min_m": round(min(elevs), 1) if elevs else None,
            "elevation_max_m": round(max(elevs), 1) if elevs else None,
            "elevation_gain_m": round(gain, 1),
            "hr_avg": round(sum(bpms) / len(bpms), 1) if bpms else None,
            "hr_min": round(min(bpms), 1) if bpms else None,
            "hr_max": round(max(bpms), 1) if bpms else None,
            "track_points": len(track),
            "media_count": len(media),
            "hr_samples": len(hr),
        },
        "zoneStats": zone_time_stats(track),
        "mediaZoneStats": media_zone_stats(media),
        "track": track,
        "media": media,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload), encoding="utf-8")
    print(f"Wrote {OUT}")
    print(
        f"track={len(track)} media={len(media)} "
        f"dist={payload['stats']['distance_km']}km "
        f"gain={payload['stats']['elevation_gain_m']}m "
        f"HR {payload['stats']['hr_min']}-{payload['stats']['hr_max']} "
        f"avg {payload['stats']['hr_avg']}"
    )
    for z, info in payload["zoneStats"].items():
        mz = payload["mediaZoneStats"][z]
        print(
            f"  Zone {z}: {info['minutes']} min ({info['percent']}%) · "
            f"{mz['mediaCount']} media · avg BPM {mz['avgBpm']}"
        )


if __name__ == "__main__":
    main()
