#!/usr/bin/env python3
"""
Download a single Concept2 activity by result_id

Usage:
    python download_single.py <result_id>

Prerequisites:
    Set environment variable:
    - C2_ACCESS_TOKEN (your Concept2 Logbook API Access Token)
"""

import sys
import requests
from datetime import datetime
from pathlib import Path

from activity_stats import (
    activity_date,
    activity_id,
    pending_stage_path,
    recover_pending_updates,
    refresh_dates,
    tcx_distance,
    tcx_path,
    write_pending_update,
    write_atomically,
)

# 导入简化的认证客户端
from simple_auth import create_simple_api_client


def get_workout_date(result: dict) -> str:
    """Extract date from result in YYYY-MM-DD format"""
    date_str = result.get("date")
    if date_str:
        return date_str.split(" ")[0] if " " in date_str else date_str
    return None


def save_tcx_file(data_dir: Path, result: dict, tcx_content: bytes) -> Path:
    """Save TCX file to appropriate directory"""
    tcx_distance(tcx_content)
    file_path = tcx_path(data_dir, result)
    write_atomically(file_path, tcx_content)

    return file_path


def update_tcx_file(data_dir: Path, result: dict, tcx_content: bytes) -> Path:
    """Replace every stored path for this result and reconcile affected dates."""
    result_id = result["id"]
    target = tcx_path(data_dir, result)
    new_date = activity_date(target.name)
    if (
        new_date is None
        or get_workout_date(result) != new_date
        or str(result_id) != target.stem.rsplit("_", 1)[-1]
    ):
        raise ValueError("Updated result has an invalid ID or date")
    tcx_distance(tcx_content)  # Do not replace a good backup with an invalid export.

    previous = [
        path for path in data_dir.rglob("*.tcx") if activity_id(path.name) == result_id
    ]
    previous_content = {path: path.read_bytes() for path in previous}
    stats_file = data_dir / "stats.json"
    previous_stats = stats_file.read_bytes() if stats_file.exists() else None
    affected_dates = {new_date} | {
        date for path in previous if (date := activity_date(path.name)) is not None
    }
    journal = write_pending_update(data_dir, result_id, target, affected_dates)
    stage = pending_stage_path(data_dir, result_id)

    try:
        write_atomically(stage, tcx_content)
        write_atomically(target, tcx_content)
        for path in previous:
            if path != target:
                path.unlink()
        refresh_dates(data_dir, affected_dates)
    except Exception:
        # A failed rollback leaves the journal for recovery on the next run.
        for path, content in previous_content.items():
            write_atomically(path, content)
        if target not in previous_content:
            target.unlink(missing_ok=True)
        if previous_stats is None:
            stats_file.unlink(missing_ok=True)
        else:
            write_atomically(stats_file, previous_stats)
        stage.unlink(missing_ok=True)
        journal.unlink()
        raise
    stage.unlink()
    journal.unlink()
    return target


def download_activity(
    api, data_dir: Path, result_id: int, update: bool = False
) -> tuple[Path, bool]:
    """Download one result; added events keep their existing skip-on-exists behavior."""
    if update:
        recover_pending_updates(data_dir)
    result = api.get_result_metadata(result_id)
    if not result:
        raise ValueError(f"Could not fetch metadata for result_id {result_id}")
    if result.get("id") != result_id:
        raise ValueError(f"Metadata result ID does not match {result_id}")

    target = tcx_path(data_dir, result)
    repairing = False
    if not update and target.exists():
        try:
            tcx_distance(target.read_bytes())
        except ValueError:
            # A truncated or invalid file is not a completed backup.
            repairing = True
        else:
            return target, False

    tcx_content = api.download_tcx(result_id)
    if update or (repairing and activity_date(target.name) is not None):
        if repairing and not update:
            recover_pending_updates(data_dir)
        return update_tcx_file(data_dir, result, tcx_content), True
    return save_tcx_file(data_dir, result, tcx_content), True


def main():
    """Download a single activity"""
    print(
        f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Starting Concept2 activity download"
    )

    if len(sys.argv) not in (2, 3) or (
        len(sys.argv) == 3 and sys.argv[2] != "--update"
    ):
        print(
            f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Error: Usage: python download_single.py <result_id> [--update]"
        )
        sys.exit(1)
    update = len(sys.argv) == 3

    try:
        result_id = int(sys.argv[1])
        print(
            f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Target result_id: {result_id}"
        )
    except ValueError:
        print(
            f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Error: result_id must be a number, got '{sys.argv[1]}'"
        )
        sys.exit(1)

    print(f"\n=== Downloading Activity {result_id} ===\n")

    try:
        # 使用简化的认证客户端
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 初始化API客户端...")
        api = create_simple_api_client()
        print(
            f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ✅ API客户端初始化成功"
        )

        # 验证凭据
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 验证API凭据...")
        if not api.auth.validate_credentials():
            print(
                f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ❌ API凭据验证失败"
            )
            sys.exit(1)
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ✅ API凭据验证成功")

        # Ensure data directory exists
        data_dir = Path(__file__).parent.parent / "data"
        data_dir.mkdir(exist_ok=True)
        print(
            f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Data directory: {data_dir}"
        )

        saved_path, downloaded = download_activity(
            api, data_dir, result_id, update=update
        )
        if not downloaded:
            print(
                f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] File already exists: {saved_path.relative_to(data_dir.parent)}"
            )
            print(
                f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Skipping download."
            )
            sys.exit(0)
        print(
            f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Saved to: {saved_path.relative_to(data_dir.parent)}"
        )
        print(
            f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Download completed successfully"
        )

    except requests.exceptions.HTTPError as e:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] API Error: {e}")
        if e.response.status_code == 401:
            print("Authentication failed. Check your credentials.")
        elif e.response.status_code == 403:
            print("Access forbidden. Check your API permissions.")
        elif e.response.status_code == 404:
            print(f"Activity {result_id} not found.")
        sys.exit(1)
    except Exception as e:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Unexpected error: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
