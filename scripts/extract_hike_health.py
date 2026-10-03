#!/usr/bin/env python3
"""Extract 2026-10-02 hiking workout, GPS route, and heart-rate samples from Apple Health export."""

from __future__ import annotations

import csv
import json
import re
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import mean
from typing import Iterator, List, Optional

ROOT = Path(__file__).resolve().parents[1]
EXPORT_DIR = ROOT / "assets" / "apple_health_export"
EXPORT_XML = EXPORT_DIR / "dati esportati.xml"
ROUTES_DIR = EXPORT_DIR / "workout-routes"
OUT_JSON = ROOT / "data" / "hiking_2026-10-02_stats.json"
OUT_CSV = ROOT / "data" / "hiking_2026-10-02_heart_rate.csv"
OUT_ROUTE_CSV = ROOT / "data" / "hiking_2026-10-02_route.csv"

TARGET_DATE = "2026-10-02"
# Prefer the Apple Watch hiking session (has HR statistics + denser route).
PREFERRED_SOURCE_SUBSTR = "Apple"


@dataclass
class WorkoutInfo:
    activity_type: str
    source_name: str
    start: datetime
    end: datetime
    duration_min: float
    route_file: Optional[str]
    statistics: dict
    metadata: dict


def parse_apple_date(value: str) -> datetime:
    """Parse Apple Health timestamps like '2026-10-02 14:02:05 +0200'."""
    return datetime.strptime(value, "%Y-%m-%d %H:%M:%S %z")


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def local_iso(dt: datetime) -> str:
    return dt.isoformat()


def _attr(tag_line: str, name: str) -> Optional[str]:
    m = re.search(rf'{name}="([^"]*)"', tag_line)
    return m.group(1) if m else None


def find_hiking_workouts(xml_path: Path) -> List[WorkoutInfo]:
    """Line-scan Workout blocks (faster than full DOM on ~800MB export)."""
    workouts: List[WorkoutInfo] = []
    in_workout = False
    collect = False
    buf: List[str] = []

    with xml_path.open("r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if not in_workout and "<Workout " in line:
                in_workout = True
                buf = [line]
                activity = _attr(line, "workoutActivityType")
                start_s = _attr(line, "startDate")
                collect = (
                    activity == "HKWorkoutActivityTypeHiking"
                    and start_s is not None
                    and start_s.startswith(TARGET_DATE)
                )
                if "/>" in line or "</Workout>" in line:
                    if collect:
                        workouts.append(_workout_from_lines(buf))
                    in_workout = False
                    collect = False
                    buf = []
                continue

            if not in_workout:
                continue

            if collect:
                buf.append(line)

            if "</Workout>" in line:
                if collect:
                    workouts.append(_workout_from_lines(buf))
                in_workout = False
                collect = False
                buf = []

    return workouts


def _workout_from_lines(lines: List[str]) -> WorkoutInfo:
    head = lines[0]
    stats: dict = {}
    meta: dict = {}
    route_file = None
    for line in lines[1:]:
        if "<MetadataEntry " in line:
            key = _attr(line, "key")
            val = _attr(line, "value")
            if key:
                meta[key] = val or ""
        elif "<WorkoutStatistics " in line:
            stype = _attr(line, "type") or ""
            stats[stype] = {
                "startDate": _attr(line, "startDate"),
                "endDate": _attr(line, "endDate"),
                "average": _float_or_none(_attr(line, "average")),
                "minimum": _float_or_none(_attr(line, "minimum")),
                "maximum": _float_or_none(_attr(line, "maximum")),
                "sum": _float_or_none(_attr(line, "sum")),
                "unit": _attr(line, "unit"),
            }
        elif "<FileReference " in line:
            route_file = _attr(line, "path")

    start = parse_apple_date(_attr(head, "startDate") or "")
    end = parse_apple_date(_attr(head, "endDate") or "")
    return WorkoutInfo(
        activity_type=_attr(head, "workoutActivityType") or "",
        source_name=(_attr(head, "sourceName") or "").replace("\xa0", " "),
        start=start,
        end=end,
        duration_min=float(_attr(head, "duration") or 0),
        route_file=route_file,
        statistics=stats,
        metadata=meta,
    )


def _float_or_none(value: Optional[str]) -> Optional[float]:
    if value is None or value == "":
        return None
    return float(value)


def choose_primary(workouts: List[WorkoutInfo]) -> WorkoutInfo:
    if not workouts:
        raise SystemExit(f"No hiking workouts found on {TARGET_DATE}")
    # Prefer Apple Watch session when present.
    for w in workouts:
        if PREFERRED_SOURCE_SUBSTR.lower() in w.source_name.lower():
            return w
    return workouts[0]


def extract_heart_rate(xml_path: Path, start: datetime, end: datetime) -> List[dict]:
    """Stream HR records whose startDate falls inside [start, end]."""
    samples: List[dict] = []
    # Fast path: regex over lines that mention HeartRate + target date.
    # Apple export writes each Record opening tag on one line.
    date_token = TARGET_DATE
    hr_type = "HKQuantityTypeIdentifierHeartRate"
    attr_re = re.compile(
        r'type="(?P<type>[^"]+)"[^>]*'
        r'sourceName="(?P<source>[^"]*)"[^>]*'
        r'unit="(?P<unit>[^"]*)"[^>]*'
        r'creationDate="(?P<creation>[^"]*)"[^>]*'
        r'startDate="(?P<start>[^"]*)"[^>]*'
        r'endDate="(?P<end>[^"]*)"[^>]*'
        r'value="(?P<value>[^"]*)"'
    )

    with xml_path.open("r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if hr_type not in line or date_token not in line:
                continue
            if 'type="HKQuantityTypeIdentifierHeartRate"' not in line:
                continue
            m = attr_re.search(line)
            if not m:
                continue
            sample_start = parse_apple_date(m.group("start"))
            if sample_start < start or sample_start > end:
                continue
            samples.append(
                {
                    "time": iso(sample_start),
                    "time_local": local_iso(sample_start),
                    "bpm": float(m.group("value")),
                    "unit": m.group("unit"),
                    "source": m.group("source").replace("\xa0", " "),
                    "end": iso(parse_apple_date(m.group("end"))),
                }
            )

    samples.sort(key=lambda s: s["time"])
    return samples


def parse_route_gpx(route_path: Path) -> List[dict]:
    ns = {"g": "http://www.topografix.com/GPX/1/1"}
    root = ET.parse(route_path).getroot()
    points = []
    for pt in root.findall(".//g:trkpt", ns):
        t = pt.find("g:time", ns)
        ele = pt.find("g:ele", ns)
        points.append(
            {
                "time": t.text if t is not None else None,
                "lat": float(pt.attrib["lat"]),
                "lon": float(pt.attrib["lon"]),
                "ele_m": float(ele.text) if ele is not None and ele.text else None,
            }
        )
    return points


def hr_summary(samples: List[dict]) -> dict:
    if not samples:
        return {"count": 0, "average_bpm": None, "min_bpm": None, "max_bpm": None}
    values = [s["bpm"] for s in samples]
    return {
        "count": len(values),
        "average_bpm": round(mean(values), 2),
        "min_bpm": min(values),
        "max_bpm": max(values),
    }


def minute_buckets(samples: List[dict], start: datetime, end: datetime) -> List[dict]:
    """One row per minute with avg/min/max HR for a compact time-series table."""
    if not samples:
        return []
    buckets = {}
    for s in samples:
        dt = datetime.fromisoformat(s["time_local"])
        key = dt.replace(second=0, microsecond=0)
        buckets.setdefault(key, []).append(s["bpm"])

    rows = []
    cursor = start.replace(second=0, microsecond=0)
    end_min = end.replace(second=0, microsecond=0)
    while cursor <= end_min:
        vals = buckets.get(cursor)
        if vals:
            rows.append(
                {
                    "minute_local": local_iso(cursor),
                    "minute_utc": iso(cursor.astimezone(timezone.utc)),
                    "samples": len(vals),
                    "avg_bpm": round(mean(vals), 1),
                    "min_bpm": min(vals),
                    "max_bpm": max(vals),
                }
            )
        cursor += timedelta(minutes=1)
    return rows


def resolve_route_path(route_file: Optional[str]) -> Optional[Path]:
    if not route_file:
        return None
    name = Path(route_file).name
    candidate = ROUTES_DIR / name
    return candidate if candidate.exists() else None


def main() -> None:
    if not EXPORT_XML.exists():
        raise SystemExit(f"Export XML not found: {EXPORT_XML}")

    print(f"Parsing workouts from {EXPORT_XML} …")
    workouts = find_hiking_workouts(EXPORT_XML)
    print(f"Found {len(workouts)} hiking workout(s) on {TARGET_DATE}")
    for w in workouts:
        print(
            f"  - {w.source_name}: {local_iso(w.start)} → {local_iso(w.end)} "
            f"({w.duration_min:.1f} min) route={w.route_file}"
        )

    primary = choose_primary(workouts)
    print(f"\nPrimary workout: {primary.source_name}")
    print(f"Extracting heart rate between {local_iso(primary.start)} and {local_iso(primary.end)} …")
    hr_samples = extract_heart_rate(EXPORT_XML, primary.start, primary.end)
    summary = hr_summary(hr_samples)
    print(f"Heart-rate samples: {summary['count']}")

    route_path = resolve_route_path(primary.route_file)
    route_points = parse_route_gpx(route_path) if route_path else []
    print(f"Route points: {len(route_points)} ({route_path})")

    duration = primary.end - primary.start
    hours, rem = divmod(int(duration.total_seconds()), 3600)
    minutes, seconds = divmod(rem, 60)

    # Workout-embedded HR stats (Apple summary) as reference
    workout_hr = primary.statistics.get("HKQuantityTypeIdentifierHeartRate", {})

    payload = {
        "date": TARGET_DATE,
        "export_xml": str(EXPORT_XML.relative_to(ROOT)),
        "primary_workout": {
            "activity_type": primary.activity_type,
            "source_name": primary.source_name.replace("\xa0", " "),
            "start_local": local_iso(primary.start),
            "end_local": local_iso(primary.end),
            "start_utc": iso(primary.start),
            "end_utc": iso(primary.end),
            "duration_minutes": round(primary.duration_min, 2),
            "duration_hms": f"{hours:d}h {minutes:02d}m {seconds:02d}s",
            "route_file": primary.route_file,
            "route_path": str(route_path.relative_to(ROOT)) if route_path else None,
            "metadata": primary.metadata,
            "statistics": primary.statistics,
        },
        "other_hiking_workouts_same_day": [
            {
                "source_name": w.source_name.replace("\xa0", " "),
                "start_local": local_iso(w.start),
                "end_local": local_iso(w.end),
                "duration_minutes": round(w.duration_min, 2),
                "route_file": w.route_file,
            }
            for w in workouts
            if w is not primary
        ],
        "heart_rate": {
            "from_samples": summary,
            "from_workout_statistics": {
                "average_bpm": workout_hr.get("average"),
                "min_bpm": workout_hr.get("minimum"),
                "max_bpm": workout_hr.get("maximum"),
                "unit": workout_hr.get("unit"),
            },
            "samples": hr_samples,
            "per_minute": minute_buckets(hr_samples, primary.start, primary.end),
        },
        "route": {
            "point_count": len(route_points),
            "start": route_points[0] if route_points else None,
            "end": route_points[-1] if route_points else None,
            "points": route_points,
        },
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    with OUT_CSV.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(
            fh, fieldnames=["time_utc", "time_local", "bpm", "unit", "source"]
        )
        writer.writeheader()
        for s in hr_samples:
            writer.writerow(
                {
                    "time_utc": s["time"],
                    "time_local": s["time_local"],
                    "bpm": s["bpm"],
                    "unit": s["unit"],
                    "source": s["source"],
                }
            )

    with OUT_ROUTE_CSV.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["time", "lat", "lon", "ele_m"])
        writer.writeheader()
        for p in route_points:
            writer.writerow(p)

    print("\n=== SUMMARY ===")
    print(f"Start (local): {local_iso(primary.start)}")
    print(f"End (local):   {local_iso(primary.end)}")
    print(f"Duration:      {hours}h {minutes:02d}m {seconds:02d}s ({primary.duration_min:.1f} min)")
    print(
        f"Heart rate:    avg {summary['average_bpm']} · "
        f"min {summary['min_bpm']} · max {summary['max_bpm']} bpm "
        f"({summary['count']} samples)"
    )
    if workout_hr:
        print(
            f"Workout stats: avg {workout_hr.get('average')} · "
            f"min {workout_hr.get('minimum')} · max {workout_hr.get('maximum')} bpm"
        )
    print(f"Route:         {route_path} ({len(route_points)} points)")
    print(f"Wrote {OUT_JSON}")
    print(f"Wrote {OUT_CSV}")
    print(f"Wrote {OUT_ROUTE_CSV}")


if __name__ == "__main__":
    main()
