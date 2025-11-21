#!/usr/bin/env python3
"""
Concept2 Logbook API - Download Workout History

This script downloads all workout results as TCX files from the Concept2 Logbook API.

Prerequisites:
    Set the following environment variables:
    - C2_CLIENT_ID
    - C2_CLIENT_SECRET
    - C2_REFRESH_TOKEN

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
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

# API Constants
API_BASE = 'https://log.concept2.com/api'
TOKEN_URL = f'{API_BASE}/oauth/access_token'
RESULTS_URL = f'{API_BASE}/users/me/results'

# Configuration
REQUEST_DELAY = 0.5  # Delay between API requests in seconds


class Concept2API:
    """Client for Concept2 Logbook API"""

    def __init__(self, client_id: str, client_secret: str, refresh_token: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self.refresh_token = refresh_token
        self.access_token: Optional[str] = None
        self.token_expires_at: Optional[datetime] = None

    def refresh_access_token(self) -> str:
        """Use refresh token to get a new access token"""
        data = {
            'client_id': self.client_id,
            'client_secret': self.client_secret,
            'refresh_token': self.refresh_token,
            'grant_type': 'refresh_token'
        }

        print("Refreshing access token...")
        response = requests.post(TOKEN_URL, data=data)
        response.raise_for_status()

        token_data = response.json()
        self.access_token = token_data['access_token']

        return self.access_token

    def get_headers(self) -> Dict[str, str]:
        """Get authentication headers for API requests"""
        if not self.access_token:
            self.refresh_access_token()

        return {
            'Authorization': f'Bearer {self.access_token}',
            'Accept': 'application/json'
        }

    def get_all_results(self) -> List[Dict]:
        """Fetch all pages of workout results"""
        all_results = []
        page = 1
        per_page = 100

        while True:
            print(f"Fetching page {page}...")
            params = {
                'page': page,
                'per_page': per_page
            }

            response = requests.get(
                RESULTS_URL,
                headers=self.get_headers(),
                params=params
            )
            response.raise_for_status()

            data = response.json()
            results = data.get('data', [])

            if not results:
                print(f"No more results. Total pages fetched: {page - 1}")
                break

            all_results.extend(results)
            print(f"  Found {len(results)} results on this page")

            # Check if we've reached the last page
            if len(results) < per_page:
                print(f"Reached last page. Total pages: {page}")
                break

            page += 1
            time.sleep(REQUEST_DELAY)

        print(f"\nTotal results found: {len(all_results)}")
        return all_results

    def download_tcx(self, result_id: int) -> bytes:
        """Download TCX file for a specific result"""
        tcx_url = f'{RESULTS_URL}/{result_id}/export/tcx'

        response = requests.get(
            tcx_url,
            headers=self.get_headers()
        )
        response.raise_for_status()

        return response.content


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


def main():
    """Main download workflow"""
    print("=== Concept2 Workout History Downloader ===\n")

    # Get environment variables
    client_id = os.environ.get('C2_CLIENT_ID')
    client_secret = os.environ.get('C2_CLIENT_SECRET')
    refresh_token = os.environ.get('C2_REFRESH_TOKEN')

    if not all([client_id, client_secret, refresh_token]):
        print("Error: Missing required environment variables")
        print("Please set:")
        print("  - C2_CLIENT_ID")
        print("  - C2_CLIENT_SECRET")
        print("  - C2_REFRESH_TOKEN")
        sys.exit(1)

    # Initialize API client
    api = Concept2API(client_id, client_secret, refresh_token)

    # Ensure data directory exists
    data_dir = Path(__file__).parent.parent / 'data'
    data_dir.mkdir(exist_ok=True)

    print("Fetching workout history...\n")

    try:
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
