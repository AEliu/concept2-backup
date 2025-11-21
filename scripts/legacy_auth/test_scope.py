#!/usr/bin/env python3
"""
Test different scope combinations for Concept2 OAuth2
"""

import os
import requests
from datetime import datetime

# Set environment
os.environ['C2_CLIENT_ID'] = 'dZuJWSYr10ntpRt1mKPUA1oLtKjgjn3OLeanhkcL'
os.environ['C2_CLIENT_SECRET'] = 'xsOm6FIU55n0apDo2iKnzMkDa9TWJjmsAkexTrHP'
os.environ['C2_REFRESH_TOKEN'] = 'e1awHNmNRmSvAgmw4KTCxTSmqLr76ZBxNcdyiZh2'

TOKEN_URL = 'https://log.concept2.com/oauth/access_token'

def test_scope(scope):
    """Test a specific scope"""
    print(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Testing scope: {scope}")

    data = {
        'client_id': os.environ['C2_CLIENT_ID'],
        'client_secret': os.environ['C2_CLIENT_SECRET'],
        'refresh_token': os.environ['C2_REFRESH_TOKEN'],
        'grant_type': 'refresh_token',
        'scope': scope
    }

    try:
        response = requests.post(TOKEN_URL, data=data)
        print(f"  Status: {response.status_code}")

        if response.status_code == 200:
            token_data = response.json()
            print(f"  ✅ SUCCESS! Token obtained")
            print(f"  access_token: {token_data['access_token'][:20]}...")
            print(f"  refresh_token: {token_data['refresh_token'][:20]}...")
            return True
        else:
            try:
                error_data = response.json()
                print(f"  ❌ Error: {error_data.get('message', 'Unknown error')}")
            except:
                print(f"  ❌ Error: {response.text[:100]}")
            return False

    except Exception as e:
        print(f"  ❌ Request failed: {e}")
        return False

def main():
    """Test different scope combinations"""
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Testing Concept2 OAuth2 Scopes")
    print("=" * 60)

    # Test different scope combinations based on API documentation
    test_scopes = [
        None,  # No scope - should use default
        'user:read',  # Single scope from docs
        'results:read',  # Single scope
        'results:write',  # Single scope
        'user:read,results:read',  # Combined from docs
        'user:read,results:write',  # Combined from docs example
        'results:read,user:read',  # Reverse order
        'results:write,user:write',  # Write scopes
    ]

    success_count = 0
    for scope in test_scopes:
        if test_scope(scope):
            success_count += 1
            if success_count >= 1:  # Stop after first success
                break

    print(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Testing complete. Success: {success_count}")

if __name__ == '__main__':
    main()