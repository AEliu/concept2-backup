"""Normalize Concept2 data used by the public activity detail."""

import hashlib
import json
from pathlib import Path


PACE_METERS = {"rower": 500, "dynamic": 500, "slides": 500, "skierg": 500, "bike": 1000}


def whole_number(value, *, minimum=0):
    return type(value) is int and minimum <= value <= 2**53 - 1


def split_rows(workout):
    if not isinstance(workout, dict):
        return None, []
    kind = "intervals" if workout.get("intervals") else "splits"
    rows = workout.get(kind)
    if not isinstance(rows, list) or not rows:
        return None, []

    segments = []
    for row in rows:
        if not (
            isinstance(row, dict)
            and whole_number(row.get("time"), minimum=1)
            and whole_number(row.get("distance"))
        ):
            return kind, []
        segments.append({"seconds": row["time"] / 10, "distance": row["distance"], "resting": False})
        if kind == "intervals":
            rest_time = row.get("rest_time")
            if not whole_number(rest_time):
                return kind, []
            if rest_time:
                rest_distance = row.get("rest_distance")
                segments.append({
                    "seconds": rest_time / 10,
                    "distance": rest_distance if whole_number(rest_distance) else None,
                    "resting": True,
                })
    return kind, segments


def stroke_groups(strokes):
    if not isinstance(strokes, dict):
        return []
    rows = strokes.get("data")
    if not isinstance(rows, list) or not rows:
        return []

    groups = [{}]
    previous = 0
    for row in rows:
        if not isinstance(row, dict) or not whole_number(tenths := row.get("t")):
            return []
        if tenths < previous:
            groups.append({})
        previous = tenths
        groups[-1][tenths] = row.get("p")
    return groups


def official_pace(result, kind, segments):
    groups = stroke_groups(result.get("strokes"))
    if not groups:
        return None
    if kind == "intervals":
        timeline = segments
    else:
        workout_type = result.get("workout_type")
        if (isinstance(workout_type, str) and "interval" in workout_type.lower()) or result.get("rest_time"):
            return None
        duration = result.get("time")
        if not whole_number(duration, minimum=1):
            return None
        timeline = [{"seconds": duration / 10, "resting": False}]

    if len(groups) != sum(not segment["resting"] for segment in timeline):
        return None
    group_iter = iter(groups)
    start = 0
    trace = []
    for segment in timeline:
        seconds = segment["seconds"]
        resting = segment["resting"]
        points = []
        if not resting:
            group = next(group_iter)
            if max(group) / 10 > seconds + 0.5:
                return None
            points = [
                [round(start + min(tenths / 10, seconds), 1), pace / 10]
                for tenths, pace in group.items()
                if whole_number(pace, minimum=1)
            ]
            if len(points) < 2:
                return None
        trace.append({"start": round(start, 1), "seconds": seconds, "resting": resting, "points": points})
        start += seconds
    return {"duration": round(start, 1), "segments": trace}


def normalize_official(result):
    """Keep displayed splits and pace only. Each part is independently optional."""
    machine = result.get("type")
    pace_meters = PACE_METERS.get(machine) if isinstance(machine, str) else None
    kind, segments = split_rows(result.get("workout"))
    pace = official_pace(result, kind, segments) if pace_meters else None
    detail = {}
    if segments:
        detail["segments"] = segments
    if pace:
        detail["pace"] = pace
    if detail and pace_meters:
        detail["paceMeters"] = pace_meters
    return detail


def load_official_cache(path: Path | None) -> dict:
    if path is None:
        return {}
    try:
        data = json.loads(path.read_bytes())
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        print("Concept2 official data cache is unreadable. Using TCX where needed.")
        return {}
    return data if isinstance(data, dict) else {}


def matches_tcx(entry, filename: str, content: bytes) -> bool:
    return (
        isinstance(entry, dict)
        and entry.get("filename") == filename
        and entry.get("sha256") == hashlib.sha256(content).hexdigest()
    )
