#!/usr/bin/env python3
"""
Concept2 Logbook API - Download Workout History

This script downloads all workout results as TCX files from the Concept2 Logbook API.

Prerequisites:
    Set the following environment variable:
    - C2_ACCESS_TOKEN (your Concept2 Logbook API Access Token)

Usage:
    uv run download_history.py [--date YYYY-MM-DD]

The script will:
    1. Use the token to authenticate
    2. Fetch all pages of workout results
    3. Download missing TCX files to data/{Year}/{Date}_{ID}.tcx
"""

import argparse
import re
import sys
import time
from datetime import date, datetime
from pathlib import Path
from typing import Dict, Optional
import requests

# 导入简化的认证客户端
# 确保 simple_auth.py 在同一目录下
from simple_auth import create_simple_api_client
from activity_stats import (
    activity_id,
    activity_date,
    recover_pending_updates,
    tcx_distance,
    tcx_path,
    write_atomically,
)
from download_single import update_tcx_file

# Configuration
REQUEST_DELAY = 0.5  # Delay between API requests in seconds


def validate_iso_date(value: str) -> str:
    """Accept only a canonical, real ISO calendar date."""
    if not isinstance(value, str) or not re.fullmatch(
        r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value
    ):
        raise ValueError("Expected a date in YYYY-MM-DD format")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("Expected a real calendar date in YYYY-MM-DD format") from exc
    if parsed.isoformat() != value:
        raise ValueError("Expected a date in YYYY-MM-DD format")
    return value


def get_workout_date(result: Dict) -> Optional[str]:
    """Extract date from result in YYYY-MM-DD format"""
    date_str = result.get("date")
    if date_str:
        # Format is typically "YYYY-MM-DD"
        return date_str.split(" ")[0] if " " in date_str else date_str
    return None


def results_for_date(results: list, workout_date: str) -> list:
    """Select a complete day's results without ignoring unknown metadata dates."""
    selected = []
    for result in results:
        if not isinstance(result, dict) or not isinstance(result.get("date"), str):
            raise ValueError("Result metadata has no valid date")
        result_date = get_workout_date(result)
        try:
            validate_iso_date(result_date)
        except ValueError as exc:
            raise ValueError("Result metadata has no valid date") from exc
        if result_date == workout_date:
            selected.append(result)
    return selected


def ensure_day_recovery_isolated(data_dir: Path, results: list) -> None:
    """Stop before a day run could reconcile files from another date."""
    if any(data_dir.glob(".pending-update-*.json")):
        raise ValueError("Pending activity update requires full recovery first")
    paths_by_id: dict[int, set[Path]] = {}
    for path in data_dir.rglob("*.tcx"):
        if (stored_id := activity_id(path.name)) is not None:
            paths_by_id.setdefault(stored_id, set()).add(path)
    for result in results:
        target = tcx_path(data_dir, result)
        if paths_by_id.get(result["id"], set()) - {target}:
            raise ValueError("Result already exists on another date; use full recovery")


def save_tcx_file(data_dir: Path, result: Dict, tcx_content: bytes) -> Path:
    """Save TCX file to appropriate directory"""
    tcx_distance(tcx_content)
    file_path = tcx_path(data_dir, result)
    write_atomically(file_path, tcx_content)

    return file_path


def tcx_file_exists(data_dir: Path, result: Dict) -> bool:
    """Check if TCX file already exists"""
    file_path = tcx_path(data_dir, result)
    if not file_path.exists():
        return False
    try:
        tcx_distance(file_path.read_bytes())
    except ValueError:
        return False
    return True


def download_results(api, data_dir: Path, results: list) -> tuple[int, int, list]:
    """Attempt every result and return downloaded, skipped, and failed IDs."""
    recover_pending_updates(data_dir)
    paths_by_id: dict[int, set[Path]] = {}
    for path in data_dir.rglob("*.tcx"):
        if (stored_id := activity_id(path.name)) is not None:
            paths_by_id.setdefault(stored_id, set()).add(path)
    downloaded = 0
    skipped = 0
    failed_ids = []

    for idx, result in enumerate(results, 1):
        result_id = (
            result.get("id", "<missing>") if isinstance(result, dict) else "<malformed>"
        )
        try:
            workout_date = get_workout_date(result) or "unknown date"
            target = tcx_path(data_dir, result)
            prior_paths = paths_by_id.get(result_id, set())
            if prior_paths == {target} and tcx_file_exists(data_dir, result):
                print(
                    f"[{idx}/{len(results)}] Skipping ID {result_id} ({workout_date}) - already exists"
                )
                skipped += 1
                continue

            print(
                f"[{idx}/{len(results)}] Downloading ID {result_id} ({workout_date})...",
                end=" ",
                flush=True,
            )
            tcx_content = api.download_tcx(result_id)
            if prior_paths and activity_date(target.name) is not None:
                file_path = update_tcx_file(data_dir, result, tcx_content)
            elif prior_paths and prior_paths != {target}:
                raise ValueError("Cannot reconcile result without a valid date")
            else:
                file_path = save_tcx_file(data_dir, result, tcx_content)
            paths_by_id[result_id] = {file_path}
            print(f"saved to {file_path.relative_to(data_dir.parent)}")
            downloaded += 1
            time.sleep(REQUEST_DELAY)
        except Exception as exc:
            print(f"ERROR: {exc}")
            failed_ids.append(result_id)

    return downloaded, skipped, failed_ids


def check_and_create_api_client():
    """创建API客户端 - 使用简化的Access Token认证"""
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 正在初始化API客户端...")

    try:
        # 使用简化的认证客户端
        api = create_simple_api_client()

        # 验证凭据
        if api.auth.validate_credentials():
            print(
                f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ✅ Access Token验证成功"
            )
            return api
        else:
            print(
                f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ❌ Access Token验证失败"
            )
            return None

    except ValueError as e:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ❌ {e}")
        print("\n🔑 请先设置Concept2 Access Token环境变量:")
        print("   export C2_ACCESS_TOKEN='your_concept2_access_token'")
        print("\n你可以在Concept2 Logbook账户设置中获取Access Token。")
        return None
    except Exception as e:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 初始化失败: {e}")
        return None


def main(api=None, data_dir: Path | None = None, workout_date: str | None = None):
    """Main download workflow"""
    if workout_date is not None:
        try:
            workout_date = validate_iso_date(workout_date)
        except ValueError as exc:
            print(f"Invalid date: {exc}", file=sys.stderr)
            sys.exit(2)

    print("=== Concept2 Workout History Downloader ===\n")

    # 1. 初始化客户端
    if api is None:
        api = check_and_create_api_client()
    if not api:
        sys.exit(1)

    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ✅ API客户端初始化成功")

    # Ensure data directory exists
    # scripts/../data -> root/data
    if data_dir is None:
        data_dir = Path(__file__).resolve().parent.parent / "data"
    data_dir.mkdir(exist_ok=True)

    try:
        # 2. 获取所有结果列表
        results = (
            api.get_all_results(strict_pagination=True)
            if workout_date is not None
            else api.get_all_results()
        )
        if workout_date is not None:
            if not isinstance(results, list):
                raise ValueError("Invalid Concept2 result list")
            results = results_for_date(results, workout_date)
            if not results:
                print(f"No workout results found for {workout_date}.")
                sys.exit(0)
            ensure_day_recovery_isolated(data_dir, results)

        if not results:
            print("No workout results found.")
            sys.exit(0)

        # 3. 处理结果并下载
        print("\nProcessing results...")
        downloaded, skipped, failed_ids = download_results(api, data_dir, results)

        # Summary
        print("\n" + "=" * 60)
        print("Download Incomplete!" if failed_ids else "Download Complete!")
        print("=" * 60)
        print(f"Total results: {len(results)}")
        print(f"Downloaded: {downloaded}")
        print(f"Skipped (already exists): {skipped}")
        print(f"Errors: {len(failed_ids)}")
        if failed_ids:
            print(f"Failed result IDs: {', '.join(map(str, failed_ids))}")
        print(f"\nFiles saved to: {data_dir}")

        outcome = "下载未完成，存在失败项目。" if failed_ids else "下载完成！"
        print(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {outcome}")
        if failed_ids:
            sys.exit(1)

    # 4. 错误处理 (Correctly indented inside main or wrapping the logic)
    except requests.exceptions.HTTPError as e:
        print(f"\nAPI Error: {e}")
        if e.response.status_code == 401:
            print("Authentication failed. Check your credentials.")
        elif e.response.status_code == 403:
            print("Access forbidden. Check your API permissions.")
        sys.exit(1)
    except Exception as e:
        print(f"\nUnexpected error: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Download Concept2 workout history")
    parser.add_argument(
        "--date", metavar="YYYY-MM-DD", help="Reconcile one calendar day"
    )
    args = parser.parse_args()
    main(workout_date=args.date)
