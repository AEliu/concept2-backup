#!/usr/bin/env python3
"""
Concept2 Logbook API - Download Workout History

This script downloads all workout results as TCX files from the Concept2 Logbook API.

Prerequisites:
    Set the following environment variable:
    - C2_ACCESS_TOKEN (your Concept2 Logbook API Access Token)

Usage:
    uv run download_history.py

The script will:
    1. Use the token to authenticate
    2. Fetch all pages of workout results
    3. Download missing TCX files to data/{Year}/{Date}_{ID}.tcx
"""

import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional
import requests

# 导入简化的认证客户端
# 确保 simple_auth.py 在同一目录下
from simple_auth import create_simple_api_client
from activity_stats import (
    activity_date,
    recover_pending_updates,
    tcx_distance,
    tcx_path,
    write_atomically,
)
from download_single import update_tcx_file

# Configuration
REQUEST_DELAY = 0.5  # Delay between API requests in seconds


def get_workout_date(result: Dict) -> Optional[str]:
    """Extract date from result in YYYY-MM-DD format"""
    date_str = result.get("date")
    if date_str:
        # Format is typically "YYYY-MM-DD"
        return date_str.split(" ")[0] if " " in date_str else date_str
    return None


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
            valid_existing = tcx_file_exists(data_dir, result)
            if valid_existing:
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
            if target.exists() and activity_date(target.name) is not None:
                recover_pending_updates(data_dir)
                file_path = update_tcx_file(data_dir, result, tcx_content)
            else:
                file_path = save_tcx_file(data_dir, result, tcx_content)
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


def main(api=None, data_dir: Path | None = None):
    """Main download workflow"""
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
        results = api.get_all_results()

        if not results:
            print("No workout results found.")
            sys.exit(0)

        # 3. 处理结果并下载
        print("\nProcessing results...")
        downloaded, skipped, failed_ids = download_results(api, data_dir, results)

        # Summary
        print("\n" + "=" * 60)
        print("Download Complete!")
        print("=" * 60)
        print(f"Total results: {len(results)}")
        print(f"Downloaded: {downloaded}")
        print(f"Skipped (already exists): {skipped}")
        print(f"Errors: {len(failed_ids)}")
        if failed_ids:
            print(f"Failed result IDs: {', '.join(map(str, failed_ids))}")
        print(f"\nFiles saved to: {data_dir}")

        print(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 下载完成！")
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
    main()
