"""Export an activity index and on-demand chart data for the static dashboard."""

from __future__ import annotations

import datetime as dt
import json
import math
import shutil
import tempfile
import xml.etree.ElementTree as ET
from collections import deque
from pathlib import Path

from activity_stats import activity_date, activity_id, tcx_distance

PACE_WINDOW_SECONDS = 10


def number(value: str | None) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) and result >= 0 else None


def timestamp(value: str | None) -> dt.datetime | None:
    try:
        parsed = dt.datetime.fromisoformat((value or "").strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)


def lap_points(lap: ET.Element, start: float, end: float, resting: bool) -> list[list]:
    samples = []
    for trackpoint in lap.findall("{*}Track/{*}Trackpoint"):
        when = timestamp(trackpoint.findtext("{*}Time"))
        if when is None:
            continue
        samples.append((
            when,
            number(trackpoint.findtext("{*}DistanceMeters")),
            number(trackpoint.findtext("{*}Cadence")),
            number(trackpoint.findtext("{*}Extensions/{*}TPX/{*}Watts")),
            number(trackpoint.findtext("{*}HeartRateBpm/{*}Value")),
        ))
    if not samples:
        return []

    samples.sort(key=lambda sample: sample[0])
    origin = timestamp(lap.get("StartTime")) or samples[0][0]
    points = []
    distances: deque[tuple[float, float]] = deque()
    for when, distance, cadence, watts, heart_rate in samples:
        elapsed = (when - origin).total_seconds()
        if elapsed < 0 or start + elapsed > end + 0.5:
            continue
        pace = None
        if distance is not None and not resting:
            if distances and distance < distances[-1][1]:
                distances.clear()
            while len(distances) > 1 and distances[1][0] <= elapsed - PACE_WINDOW_SECONDS:
                distances.popleft()
            if distances:
                previous_time, previous_distance = distances[0]
                if PACE_WINDOW_SECONDS <= elapsed - previous_time <= 3 * PACE_WINDOW_SECONDS and distance > previous_distance:
                    pace = round(500 * (elapsed - previous_time) / (distance - previous_distance), 1)
            distances.append((elapsed, distance))
        points.append([round(min(start + elapsed, end), 1), pace, cadence, watts, heart_rate])
    return points


def activity_payload(path: Path, result_id: int) -> tuple[dict, dict]:
    content = path.read_bytes()
    distance = tcx_distance(content)
    root = ET.fromstring(content)
    activities = root.findall("{*}Activities/{*}Activity")
    started_at = timestamp(activities[0].findtext("{*}Id"))
    date = activity_date(path.name) or (started_at.date().isoformat() if started_at else None)
    if date is None:
        raise ValueError("Undated file has no activity timestamp")

    segments = []
    elapsed = work_distance = rest_seconds = 0.0
    timing_complete = True
    for activity in activities:
        for lap in activity.findall("{*}Lap"):
            seconds = number(lap.findtext("{*}TotalTimeSeconds"))
            meters = number(lap.findtext("{*}DistanceMeters"))
            if meters is None:
                raise ValueError("Lap distance is invalid")
            timing_complete = timing_complete and seconds is not None
            resting = lap.findtext("{*}Intensity", "").strip().lower() == "resting"
            segment = {
                "start": round(elapsed, 1), "seconds": seconds, "distance": meters,
                "resting": resting,
                "points": lap_points(lap, elapsed, elapsed + seconds, resting) if timing_complete else [],
            }
            segments.append(segment)
            elapsed += seconds or 0
            if resting:
                rest_seconds += seconds or 0
            else:
                work_distance += meters

    if not timing_complete:
        for segment in segments:
            segment["points"] = []

    summary = {
        "id": str(result_id), "date": date, "startedAt": started_at.isoformat() if started_at else None,
        "distance": distance, "duration": round(elapsed, 1) if timing_complete else None, "restSeconds": round(rest_seconds, 1),
        "workDistance": round(work_distance, 1),
    }
    return summary, {**summary, "segments": segments}


def write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, separators=(",", ":"), allow_nan=False), encoding="utf-8")


def export_activities(data: Path, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".activities-", dir=output.parent.parent) as temp:
        staging = Path(temp) / "activities"
        details = staging / "details"
        details.mkdir(parents=True)
        summaries = {}
        for path in sorted(data.glob("*/*.tcx")):
            result_id = activity_id(path.name)
            if result_id is None:
                continue
            if result_id in summaries:
                raise ValueError(f"Duplicate result ID: {result_id}")
            try:
                summary, detail = activity_payload(path, result_id)
            except ValueError as error:
                raise ValueError(f"{path.name}: {error}") from error
            summaries[result_id] = summary
            write_json(details / f"{result_id}.json", detail)

        ordered = sorted(summaries.values(), key=lambda row: (row["date"], row["startedAt"] or "", int(row["id"])), reverse=True)
        write_json(staging / "index.json", ordered)
        if output.exists():
            shutil.rmtree(output)
        staging.rename(output)
    print(f"Exported {len(summaries)} activities")


if __name__ == "__main__":
    repo = Path(__file__).resolve().parent.parent
    export_activities(repo / "data", repo / "web" / "public" / "activities")
