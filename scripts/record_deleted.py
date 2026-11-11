#!/usr/bin/env python3
"""Record a deleted Logbook result while retaining its historical backup."""

import json
import re
import sys
from pathlib import Path

from activity_stats import write_atomically


MAX_SAFE_RESULT_ID = 2**53 - 1


def record_deletion(data_dir: Path, result_id: int) -> tuple[Path, bool]:
    """Write an ID-only tombstone; return whether a new marker was created."""
    if type(result_id) is not int or not 0 < result_id <= MAX_SAFE_RESULT_ID:
        raise ValueError("Result ID must be a positive safe integer")

    markers_dir = data_dir / "deletions"
    marker = markers_dir / f"{result_id}.json"
    if markers_dir.is_symlink() or marker.is_symlink():
        raise ValueError("Deletion marker path must not be a symlink")
    if not marker.resolve().is_relative_to(data_dir.resolve()):
        raise ValueError("Deletion marker path leaves the data directory")

    content = (
        json.dumps(
            {"event_type": "result-deleted", "result_id": result_id},
            sort_keys=True,
            separators=(",", ":"),
        )
        + "\n"
    ).encode("utf-8")
    if marker.exists():
        if not marker.is_file() or marker.read_bytes() != content:
            raise ValueError("Existing deletion marker does not match")
        return marker, False

    write_atomically(marker, content)
    return marker, True


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1 or not re.fullmatch(r"[1-9][0-9]*", args[0], re.ASCII):
        print("Usage: record_deleted.py <positive_result_id>", file=sys.stderr)
        return 1
    try:
        marker, created = record_deletion(
            Path(__file__).resolve().parent.parent / "data", int(args[0])
        )
    except ValueError as exc:
        print(f"Unable to record deletion: {exc}", file=sys.stderr)
        return 1
    print(f"{'Recorded' if created else 'Already recorded'} deletion for {marker.stem}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
