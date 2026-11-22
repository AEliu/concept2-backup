"""Refresh a bounded batch of official workout details for the next Pages build."""

import hashlib
import json
import os
from collections.abc import Callable
from pathlib import Path

import requests

from activity_stats import activity_id, write_atomically
from simple_auth import create_simple_api_client
from web_official_data import load_official_cache, matches_tcx, normalize_official


BATCH_SIZE = 60


def sync_official_data(
    data: Path,
    cache: Path,
    fetch: Callable[[int], dict | None] | None,
    *,
    refresh_id: str = "",
    limit: int = BATCH_SIZE,
) -> bool:
    previous = load_official_cache(cache)
    paths = {}
    for path in sorted(data.glob("*/*.tcx"), key=lambda candidate: candidate.name, reverse=True):
        result_id = activity_id(path.name)
        if result_id is not None and not (data / "deletions" / f"{result_id}.json").exists():
            paths[str(result_id)] = path
    entries = {key: entry for key, entry in previous.items() if key in paths and key != refresh_id}

    if fetch is not None:
        if refresh_id in paths:
            priority = paths.pop(refresh_id)
            paths = {refresh_id: priority, **paths}
        attempted = failures = 0
        for result_id, path in paths.items():
            if attempted >= limit:
                break
            content = path.read_bytes()
            if matches_tcx(entries.get(result_id), path.name, content):
                continue
            attempted += 1
            try:
                result = fetch(int(result_id))
            except requests.HTTPError as error:
                failures += 1
                if error.response is None or error.response.status_code in (401, 429, 503):
                    break
                continue
            except ValueError:
                failures += 1
                continue
            except requests.RequestException:
                failures += 1
                break
            entries[result_id] = {
                "filename": path.name,
                "sha256": hashlib.sha256(content).hexdigest(),
                "official": normalize_official(result) if result else {},
            }
        if failures:
            print(f"{failures} Concept2 official requests failed. Using TCX where needed.")
    if entries == previous and cache.exists():
        return False
    write_atomically(cache, json.dumps(entries, separators=(",", ":"), allow_nan=False).encode("utf-8"))
    return True


if __name__ == "__main__":
    repo = Path(__file__).resolve().parent.parent
    token = os.environ.get("C2_ACCESS_TOKEN")
    changed = sync_official_data(
        repo / "data",
        Path(os.environ["C2_OFFICIAL_CACHE"]),
        create_simple_api_client(token).get_result_with_strokes if token else None,
        refresh_id=os.environ.get("C2_OFFICIAL_REFRESH_ID", ""),
    )
    if output := os.environ.get("GITHUB_OUTPUT"):
        with Path(output).open("a", encoding="utf-8") as handle:
            handle.write(f"changed={str(changed).lower()}\n")
