#!/usr/bin/env python3
"""
Concept2 Logbook API - Download Workout History

This script downloads all workout results as TCX files from the Concept2 Logbook API.

Prerequisites:
    Set the following environment variable:
    - C2_ACCESS_TOKEN (your Concept2 Logbook API Access Token)

Usage:
    pdm run python download_history.py

The script will:
    1. Use the refresh token to get an access token
    2. Fetch all pages of workout results
    3. Download missing TCX files to data/{Year}/{Date}_{ID}.tcx
"""

import os
import sys
import requests
import time
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional

# 导入简化的认证客户端
from simple_auth import create_simple_api_client

# Configuration
REQUEST_DELAY = 0.5  # Delay between API requests in seconds


def get_workout_date(result: Dict) -> Optional[str]:
    """Extract date from result in YYYY-MM-DD format"""
    date_str = result.get('date')
    if date_str:
        # Format is typically "YYYY-MM-DD"
        return date_str.split(' ')[0] if ' ' in date_str else date_str
    return None


def get_workout_year(result: Dict) -> Optional[str]:
    """Extract year from result"""
    date_str = get_workout_date(result)
    if date_str and len(date_str) >= 4:
        return date_str[:4]
    return None


def get_tcx_filename(result: Dict) -> str:
    """Generate TCX filename from result data"""
    result_id = result['id']
    date_str = get_workout_date(result)

    if date_str:
        # Replace dashes with underscores for filename
        date_formatted = date_str.replace('-', '_')
        return f"{date_formatted}_{result_id}.tcx"
    else:
        return f"{result_id}.tcx"


def save_tcx_file(data_dir: Path, result: Dict, tcx_content: bytes) -> Path:
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


def tcx_file_exists(data_dir: Path, result: Dict) -> bool:
    """Check if TCX file already exists"""
    year = get_workout_year(result)
    if not year:
        return False

    year_dir = data_dir / year
    if not year_dir.exists():
        return False

    filename = get_tcx_filename(result)
    file_path = year_dir / filename

    return file_path.exists()


def check_and_create_api_client():
    """创建API客户端 - 使用简化的Access Token认证"""
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 正在初始化API客户端...")

    try:
        # 使用简化的认证客户端
        api = create_simple_api_client()

        # 验证凭据
        if api.auth.validate_credentials():
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ✅ Access Token验证成功")
            return api
        else:
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ❌ Access Token验证失败")
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

def main():
    """Main download workflow"""
    print("=== Concept2 Workout History Downloader ===\n")

    # 智能检查并创建API客户端
    api = check_and_create_api_client()
    if not api:
        sys.exit(1)

    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ✅ API客户端初始化成功")

    # Ensure data directory exists
    data_dir = Path(__file__).parent.parent / 'data'
    data_dir.mkdir(exist_ok=True)

    # Get all results
    results = api.get_all_results()

    if not results:
        print("No workout results found.")
        sys.exit(0)

    # Process results
    print("\nProcessing results...")
    downloaded = 0
    skipped = 0
    errors = 0

    for idx, result in enumerate(results, 1):
        result_id = result['id']
        workout_date = get_workout_date(result) or 'unknown date'

        # Check if file already exists
        if tcx_file_exists(data_dir, result):
            print(f"[{idx}/{len(results)}] Skipping ID {result_id} ({workout_date}) - already exists")
            skipped += 1
            continue

        # Download TCX file
        print(f"[{idx}/{len(results)}] Downloading ID {result_id} ({workout_date})...", end=' ', flush=True)

        try:
            tcx_content = api.download_tcx(result_id)
            file_path = save_tcx_file(data_dir, result, tcx_content)
            print(f"saved to {file_path.relative_to(data_dir.parent)}")
            downloaded += 1

            # Be polite to the API
            time.sleep(REQUEST_DELAY)

        except Exception as e:
            print(f"ERROR: {e}")
            errors += 1

    # Summary
    print("\n" + "="*60)
    print("Download Complete!")
    print("="*60)
    print(f"Total results: {len(results)}")
    print(f"Downloaded: {downloaded}")
    print(f"Skipped (already exists): {skipped}")
    print(f"Errors: {errors}")
    print(f"\nFiles saved to: {data_dir}")

    print(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] 下载完成！")

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


if __name__ == '__main__':
    main()