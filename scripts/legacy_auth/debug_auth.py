#!/usr/bin/env python3
"""
Debug script for Concept2 OAuth2 authentication
Shows detailed request information
"""

import os
import requests
from datetime import datetime

# API Constants
TOKEN_URL = 'https://log.concept2.com/oauth/access_token'

def debug_token_request():
    """Debug the token request with detailed logging"""

    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] === OAuth2 Token Request Debug ===")

    # Get environment variables
    client_id = os.environ.get('C2_CLIENT_ID')
    client_secret = os.environ.get('C2_CLIENT_SECRET')
    refresh_token = os.environ.get('C2_REFRESH_TOKEN')

    print(f"Environment check:")
    print(f"  C2_CLIENT_ID: {'SET' if client_id else 'NOT SET'}")
    print(f"  C2_CLIENT_SECRET: {'SET' if client_secret else 'NOT SET'}")
    print(f"  C2_REFRESH_TOKEN: {'SET' if refresh_token else 'NOT SET'}")

    if not all([client_id, client_secret, refresh_token]):
        print("❌ Missing required environment variables")
        return

    # Show what we're sending (without exposing secrets)
    print(f"\nRequest details:")
    print(f"  URL: {TOKEN_URL}")
    print(f"  Method: POST")
    print(f"  Content-Type: application/x-www-form-urlencoded")

    # Prepare request data
    data = {
        'client_id': client_id,
        'client_secret': client_secret,
        'refresh_token': refresh_token,
        'grant_type': 'refresh_token',
        'scope': 'results:read'  # 只使用支持的scope
    }

    print(f"\nRequest body (sanitized):")
    for key, value in data.items():
        if key in ['client_secret', 'refresh_token']:
            print(f"  {key}: {'*' * min(len(value), 10)}...")
        else:
            print(f"  {key}: {value}")

    print(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Sending request...")

    try:
        response = requests.post(TOKEN_URL, data=data)

        print(f"\nResponse status: {response.status_code}")
        print(f"Response headers:")
        for key, value in response.headers.items():
            print(f"  {key}: {value}")

        if response.status_code == 200:
            token_data = response.json()
            print(f"\n✅ Success! Token response:")
            print(f"  access_token: {token_data.get('access_token', 'N/A')[:20]}...")
            print(f"  refresh_token: {token_data.get('refresh_token', 'N/A')[:20]}...")
            print(f"  expires_in: {token_data.get('expires_in', 'N/A')}")
            print(f"  token_type: {token_data.get('token_type', 'N/A')}")
        else:
            print(f"\n❌ Error response:")
            print(f"  Status: {response.status_code}")
            print(f"  Reason: {response.reason}")

            try:
                error_data = response.json()
                print(f"  Error response body:")
                for key, value in error_data.items():
                    print(f"    {key}: {value}")
            except:
                print(f"  Raw response: {response.text[:500]}")

    except Exception as e:
        print(f"\n❌ Request failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    debug_token_request()