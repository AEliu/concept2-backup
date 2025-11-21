# Concept2 Logbook API - Simplified Access Token Authentication

This directory now uses a simplified authentication method that directly uses the Concept2 Logbook API Access Token instead of the complex OAuth2 flow.

## Quick Start

1. **Get your Access Token** from your Concept2 Logbook account settings
2. **Set the environment variable** in your GitHub repository secrets or local environment:
   ```bash
   export C2_ACCESS_TOKEN="your_concept2_access_token_here"
   ```

3. **Run the scripts**:
   ```bash
   # Download all workout history
   python download_history.py

   # Download a single workout by ID
   python download_single.py 123456
   ```

## Environment Variable

Only one environment variable is required:
- `C2_ACCESS_TOKEN`: Your personal Concept2 Logbook API Access Token

## How It Works

The new authentication system:
- Uses the `/users/me` endpoint as specified in Concept2's documentation for personal data access
- Sends the Access Token as `Authorization: Bearer token` header
- Directly validates the token with a simple test request
- Removes all OAuth2 complexity (no client_id, client_secret, refresh_token needed)

## API Usage

The new `simple_auth.py` module provides:

```python
from simple_auth import create_simple_api_client

# Create API client (reads C2_ACCESS_TOKEN from environment)
api = create_simple_api_client()

# Validate the token
if api.auth.validate_credentials():
    # Use the API
    results = api.get_all_results()
    tcx_data = api.download_tcx(result_id)
```

## Migration from OAuth2

If you were previously using the OAuth2 authentication:
1. Remove the old environment variables: `C2_CLIENT_ID`, `C2_CLIENT_SECRET`, `C2_REFRESH_TOKEN`
2. Set only `C2_ACCESS_TOKEN` with your personal access token
3. The scripts will automatically use the simplified authentication

## Files

- `simple_auth.py`: New simplified authentication module
- `download_history.py`: Updated to use simple auth
- `download_single.py`: Updated to use simple auth
- `auth.py`, `auth_client.py`, `debug_auth.py`: Legacy OAuth2 files (can be removed)

## Note

This simplified approach is specifically designed for accessing your own workout data using the `me` endpoint, as mentioned in Concept2's documentation for personal access tokens.