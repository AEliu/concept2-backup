#!/usr/bin/env python3
"""
Concept2 Logbook API OAuth2 Authentication Script

This script helps you obtain OAuth2 tokens for the Concept2 Logbook API.
It uses the Authorization Code flow with a local redirect URI.

Usage:
    python auth.py
    # Then enter your Client ID and Client Secret when prompted

API Documentation:
    https://log.concept2.com/developers/documentation/
"""

import requests
import webbrowser
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading
import sys

# Constants
AUTH_URL = 'https://log.concept2.com/oauth/authorize'
TOKEN_URL = 'https://log.concept2.com/oauth/access_token'
REDIRECT_URI = 'http://localhost:8080/callback'
# Scope for accessing user results
SCOPE = 'results:read'


class OAuthCallbackHandler(BaseHTTPRequestHandler):
    """Simple HTTP handler to capture OAuth callback"""

    def do_GET(self):
        """Handle GET requests"""
        if '/callback' in self.path:
            # Parse the query parameters
            parsed = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(parsed.query)

            if 'code' in query:
                self.server.auth_code = query['code'][0]
                self.send_response(200)
                self.send_header('Content-type', 'text/html')
                self.end_headers()
                self.wfile.write(b"""
                <html>
                    <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                        <h1>Authentication Successful!</h1>
                        <p>You can close this window and return to the terminal.</p>
                    </body>
                </html>
                """)
            elif 'error' in query:
                self.server.auth_error = query['error'][0]
                self.send_response(400)
                self.send_header('Content-type', 'text/html')
                self.end_headers()
                error_msg = query.get('error_description', ['Unknown error'])[0]
                self.wfile.write(f"""
                <html>
                    <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                        <h1>Authentication Failed</h1>
                        <p>{error_msg}</p>
                    </body>
                </html>
                """.encode())
            else:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'Invalid callback')
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        """Suppress HTTP server log output"""
        pass


def start_local_server():
    """Start a local HTTP server to capture OAuth callback"""
    server = HTTPServer(('localhost', 8080), OAuthCallbackHandler)
    server.auth_code = None
    server.auth_error = None

    # Start server in a separate thread
    thread = threading.Thread(target=server.serve_forever)
    thread.daemon = True
    thread.start()

    return server


def get_authorization_url(client_id):
    """Build the authorization URL"""
    params = {
        'client_id': client_id,
        'redirect_uri': REDIRECT_URI,
        'response_type': 'code',
        'scope': SCOPE
    }
    return f"{AUTH_URL}?{urllib.parse.urlencode(params)}"


def exchange_code_for_token(client_id, client_secret, auth_code):
    """Exchange authorization code for access and refresh tokens"""
    data = {
        'client_id': client_id,
        'client_secret': client_secret,
        'code': auth_code,
        'grant_type': 'authorization_code',
        'redirect_uri': REDIRECT_URI
    }

    response = requests.post(TOKEN_URL, data=data)
    response.raise_for_status()

    return response.json()


def main():
    """Main authentication flow"""
    print("=== Concept2 Logbook API OAuth2 Authentication ===\n")

    # Get credentials from user
    client_id = input("Enter your Client ID: ").strip()
    if not client_id:
        print("Error: Client ID is required")
        sys.exit(1)

    client_secret = input("Enter your Client Secret: ").strip()
    if not client_secret:
        print("Error: Client Secret is required")
        sys.exit(1)

    # Start local server
    print("\nStarting local server to capture OAuth callback...")
    server = start_local_server()

    # Build and open authorization URL
    auth_url = get_authorization_url(client_id)
    print(f"\nOpening browser for authorization...")
    print(f"If browser doesn't open automatically, visit:\n{auth_url}\n")
    webbrowser.open(auth_url)

    # Wait for callback
    print("Waiting for authorization...")
    while server.auth_code is None and server.auth_error is None:
        pass

    # Shutdown server
    server.shutdown()

    # Check for errors
    if server.auth_error:
        print(f"Authorization error: {server.auth_error}")
        sys.exit(1)

    # Exchange code for tokens
    print("Authorization successful! Exchanging code for tokens...")
    try:
        token_response = exchange_code_for_token(
            client_id,
            client_secret,
            server.auth_code
        )

        # Display tokens
        print("\n" + "="*60)
        print("SUCCESS! Tokens obtained:")
        print("="*60)
        print(f"\nAccess Token:\n{token_response['access_token']}")
        print(f"\nRefresh Token:\n{token_response['refresh_token']}")
        print(f"\nExpires In: {token_response.get('expires_in', 'N/A')} seconds")
        print("\n" + "="*60)
        print("\nSave these tokens securely!")
        print("The Refresh Token can be used to obtain new Access Tokens.")
        print("\nSet the following environment variables:")
        print(f"  export C2_CLIENT_ID='{client_id}'")
        print(f"  export C2_CLIENT_SECRET='{client_secret}'")
        print(f"  export C2_REFRESH_TOKEN='{token_response['refresh_token']}'")

    except requests.exceptions.HTTPError as e:
        print(f"\nError exchanging code for token: {e}")
        if e.response.status_code == 401:
            print("Check your Client ID and Client Secret")
        sys.exit(1)
    except Exception as e:
        print(f"\nUnexpected error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
