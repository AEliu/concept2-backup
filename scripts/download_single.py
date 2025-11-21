#!/usr/bin/env python3
"""
Download a single Concept2 activity by result_id

Usage:
    python download_single.py <result_id>

Prerequisites:
    Set environment variable:
    - C2_ACCESS_TOKEN (your Concept2 Logbook API Access Token)
"""

import os
import sys
import requests
import time
from datetime import datetime
from pathlib import Path

# 导入简化的认证客户端
from simple_auth import create_simple_api_client


def get_workout_date(result: dict) -> str:
    """Extract date from result in YYYY-MM-DD format"""
    date_str = result.get('date')
    if date_str:
        return date_str.split(' ')[0] if ' ' in date_str else date_str
    return None


def get_workout_year(result: dict) -> str:
    """Extract year from result"""
    date_str = get_workout_date(result)
    if date_str and len(date_str) >= 4:
        return date_str[:4]
    return None


def get_tcx_filename(result: dict) -> str:
    """Generate TCX filename from result data"""
    result_id = result['id']
    date_str = get_workout_date(result)

    if date_str:
        date_formatted = date_str.replace('-', '_')
        return f"{date_formatted}_{result_id}.tcx"
    else:
        return f"{result_id}.tcx"


def save_tcx_file(data_dir: Path, result: dict, tcx_content: bytes) -> Path:
    """Save TCX file to appropriate directory"""
    year = get_workout_year(result)
    if not year:
        year = 'unknown_year'

    # Create year directory if it doesn't exist
    year_dir = data_dir / year
    year_dir.mkdir(parents=True, exist_ok=True)

    # Generate filename
    filename = get_tcx_filename(result)
    file_path = year_dir / filename

    # Save file
    with open(file_path, 'wb') as f:
        f.write(tcx_content)

    return file_path


def main():
    """Download a single activity"""
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Starting Concept2 activity download")

    if len(sys.argv) < 2:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Error: Usage: python download_single.py <result_id>")
        sys.exit(1)

    try:
        result_id = int(sys.argv[1])
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Target result_id: {result_id}")
    except ValueError:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Error: result_id must be a number, got '{sys.argv[1]}'")
        sys.exit(1)

    print(f"\n=== Downloading Activity {result_id} ===\n")

    try:
        # 使用简化的认证客户端
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 初始化API客户端...")
        api = create_simple_api_client()
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ✅ API客户端初始化成功")

        # 验证凭据
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 验证API凭据...")
        if not api.auth.validate_credentials():
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ❌ API凭据验证失败")
            sys.exit(1)
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ✅ API凭据验证成功")

        # Ensure data directory exists
        data_dir = Path(__file__).parent.parent / 'data'
        data_dir.mkdir(exist_ok=True)
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Data directory: {data_dir}")

        # Get metadata first
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Fetching metadata for result {result_id}...")
        result = api.get_result_metadata(result_id)

        if not result:
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Error: Could not fetch metadata for result_id {result_id}")
            sys.exit(1)

        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Successfully fetched metadata")

        # Check if file already exists
        year = get_workout_year(result) or 'unknown_year'
        year_dir = data_dir / year
        filename = get_tcx_filename(result)
        file_path = year_dir / filename

        if file_path.exists():
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] File already exists: {file_path.relative_to(data_dir.parent)}")
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Skipping download.")
            sys.exit(0)

        # Download TCX file
        workout_date = get_workout_date(result) or 'unknown date'
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Downloading activity from {workout_date}...")
        tcx_content = api.download_tcx(result_id)
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Downloaded {len(tcx_content)} bytes")

        # Save file
        saved_path = save_tcx_file(data_dir, result, tcx_content)
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Saved to: {saved_path.relative_to(data_dir.parent)}")
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Download completed successfully")

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


if __name__ == '__main__':
    main()