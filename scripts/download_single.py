#!/usr/bin/env python3
"""
Download a single Concept2 activity by result_id

Usage:
    python download_single.py <result_id>

Prerequisites:
    Set environment variables:
    - C2_CLIENT_ID
    - C2_CLIENT_SECRET
    - C2_REFRESH_TOKEN
"""

import os
import sys
import requests
import time
from datetime import datetime
from pathlib import Path

# API Constants
TOKEN_URL = 'https://log.concept2.com/oauth/access_token'
API_BASE = 'https://log.concept2.com/api'
RESULTS_URL = f'{API_BASE}/users/me/results'


class Concept2API:
    """Client for Concept2 Logbook API"""

    def __init__(self, client_id: str, client_secret: str, refresh_token: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self.refresh_token = refresh_token
        self.access_token = None

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

    def get_headers(self):
        """Get authentication headers for API requests"""
        if not self.access_token:
            self.refresh_access_token()

        return {
            'Authorization': f'Bearer {self.access_token}',
            'Accept': 'application/json'
        }

    def download_tcx(self, result_id: int) -> bytes:
        """Download TCX file for a specific result"""
        tcx_url = f'{RESULTS_URL}/{result_id}/export/tcx'

        response = requests.get(
            tcx_url,
            headers=self.get_headers()
        )
        response.raise_for_status()

        return response.content

    def get_result_metadata(self, result_id: int) -> dict:
        """Get metadata for a specific result"""
        result_url = f'{RESULTS_URL}/{result_id}'

        response = requests.get(
            result_url,
            headers=self.get_headers()
        )
        response.raise_for_status()

        # API response has "data" wrapper, extract the actual result data
        result_data = response.json()
        return result_data.get('data', {})


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

    # Get environment variables
    client_id = os.environ.get('C2_CLIENT_ID')
    client_secret = os.environ.get('C2_CLIENT_SECRET')
    refresh_token = os.environ.get('C2_REFRESH_TOKEN')

    if not all([client_id, client_secret, refresh_token]):
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Error: Missing required environment variables")
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
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Data directory: {data_dir}")

    try:
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
