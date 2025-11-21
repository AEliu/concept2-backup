"""
Simple Concept2 Logbook API Authentication using Access Token

This module provides simplified authentication using a Concept2 Logbook API Access Token
directly from environment variables (e.g., GitHub secrets).

Usage:
    Set the environment variable:
    - C2_ACCESS_TOKEN: Your Concept2 Logbook API Access Token

    Then use in your scripts:
    from simple_auth import create_simple_api_client
    api = create_simple_api_client()
"""

import os
import requests
from datetime import datetime
from typing import Optional, Dict

# API Constants
API_BASE = 'https://log.concept2.com/api'
RESULTS_URL = f'{API_BASE}/users/me/results'


class SimpleConcept2AuthClient:
    """Simple Concept2 Logbook API client using Access Token"""

    def __init__(self, access_token: str):
        self.access_token = access_token

    def get_headers(self) -> Dict[str, str]:
        """Get API request headers with Bearer token"""
        return {
            'Authorization': f'Bearer {self.access_token}',
            'Accept': 'application/json',
            'User-Agent': 'Concept2-Python-Client/1.0'
        }

    def validate_credentials(self) -> bool:
        """Validate the access token by making a test request to /users/me"""
        try:
            headers = self.get_headers()
            response = requests.get(f'{API_BASE}/users/me', headers=headers)

            if response.status_code == 200:
                print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ✅ Access token validation successful")
                return True
            elif response.status_code == 401:
                print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ❌ Invalid access token")
                return False
            else:
                print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ❌ API error: {response.status_code}")
                return False

        except Exception as e:
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Token validation failed: {e}")
            return False


class SimpleConcept2API:
    """Simple Concept2 Logbook API client"""

    def __init__(self, auth_client: SimpleConcept2AuthClient):
        self.auth = auth_client

    def download_tcx(self, result_id: int) -> bytes:
        """Download TCX file for a specific result"""
        tcx_url = f'{RESULTS_URL}/{result_id}/export/tcx'

        response = requests.get(
            tcx_url,
            headers=self.auth.get_headers()
        )
        response.raise_for_status()

        return response.content

    def get_result_metadata(self, result_id: int) -> Optional[Dict]:
        """Get metadata for a specific result"""
        result_url = f'{RESULTS_URL}/{result_id}'

        response = requests.get(
            result_url,
            headers=self.auth.get_headers()
        )
        response.raise_for_status()

        return response.json().get('data', {})

    def get_all_results(self, per_page: int = 100) -> list:
        """Get all workout results (supports pagination)"""
        all_results = []
        page = 1
        total_pages = None

        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Fetching all results...")

        while True:
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Fetching page {page}...")

            params = {
                'page': page,
                'per_page': per_page
            }

            response = requests.get(
                RESULTS_URL,
                headers=self.auth.get_headers(),
                params=params
            )
            response.raise_for_status()

            data = response.json()
            results = data.get('data', [])
            meta = data.get('meta', {})
            pagination = meta.get('pagination', {})

            if not results:
                break

            all_results.extend(results)
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Page {page}: {len(results)} results")

            # Check if there are more pages
            current_page = pagination.get('current_page', page)
            total_pages = pagination.get('total_pages', total_pages)

            if total_pages and current_page >= total_pages:
                break

            page += 1

        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Total results: {len(all_results)}")
        return all_results


def create_simple_api_client(access_token: str = None) -> SimpleConcept2API:
    """
    Create a simple API client using Access Token

    Args:
        access_token: Concept2 Logbook API Access Token. If None, reads from C2_ACCESS_TOKEN env var.

    Returns:
        SimpleConcept2API instance

    Raises:
        ValueError: If no access token is provided or found in environment
    """
    if not access_token:
        access_token = os.environ.get('C2_ACCESS_TOKEN')

    if not access_token:
        raise ValueError(
            "No Concept2 Access Token found. "
            "Please set the C2_ACCESS_TOKEN environment variable "
            "with your Concept2 Logbook API Access Token."
        )

    auth_client = SimpleConcept2AuthClient(access_token)
    return SimpleConcept2API(auth_client)


def main():
    """Test the simple authentication"""
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Testing simple Concept2 API authentication...")

    try:
        api = create_simple_api_client()

        if api.auth.validate_credentials():
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ✅ Authentication successful!")

            # Get user info
            response = requests.get(
                f'{API_BASE}/users/me',
                headers=api.auth.get_headers()
            )
            user_data = response.json().get('data', {})
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] User: {user_data.get('username', 'Unknown')}")
        else:
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ❌ Authentication failed!")

    except ValueError as e:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ❌ {e}")
        print("\nTo use this client, set your access token:")
        print("export C2_ACCESS_TOKEN='your_concept2_access_token'")
        print("\nYou can get an access token from your Concept2 Logbook account settings.")


if __name__ == '__main__':
    main()