"""Regression tests for the authentication preflight exit status."""

import contextlib
import io
import os
import runpy
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests

import simple_auth


TOKEN = "synthetic-test-token"
SCRIPT = Path(simple_auth.__file__)


def response(status: int, username: str = "rower") -> Mock:
    result = Mock(status_code=status)
    result.json.return_value = {"data": {"username": username}}
    return result


class SimpleAuthPreflightTests(unittest.TestCase):
    def run_main(self, *responses: Mock | Exception) -> tuple[int, str, Mock]:
        output = io.StringIO()
        with (
            patch.dict(os.environ, {"C2_ACCESS_TOKEN": TOKEN}),
            patch.object(simple_auth.requests, "get", side_effect=responses) as get,
            contextlib.redirect_stdout(output),
        ):
            status = simple_auth.main()
        self.assertNotIn(TOKEN, output.getvalue())
        return status, output.getvalue(), get

    def test_success_exits_zero_after_user_info_and_bounds_both_requests(self):
        status, output, get = self.run_main(response(200), response(200))

        self.assertEqual(status, 0)
        self.assertIn("Authentication successful", output)
        self.assertIn("User: rower", output)
        self.assertEqual(get.call_count, 2)
        for call in get.call_args_list:
            self.assertEqual(call.args[0], f"{simple_auth.API_BASE}/users/me")
            self.assertEqual(call.kwargs["timeout"], simple_auth.AUTH_TIMEOUT_SECONDS)
            self.assertGreater(call.kwargs["timeout"], 0)

    def test_missing_token_exits_nonzero_without_request(self):
        output = io.StringIO()
        with (
            patch.dict(os.environ, {"C2_ACCESS_TOKEN": ""}),
            patch.object(simple_auth.requests, "get") as get,
            contextlib.redirect_stdout(output),
        ):
            status = simple_auth.main()

        self.assertEqual(status, 1)
        self.assertIn("No Concept2 Access Token found", output.getvalue())
        get.assert_not_called()

    def test_unauthorized_exits_nonzero_without_user_info(self):
        status, output, get = self.run_main(response(401))

        self.assertEqual(status, 1)
        self.assertIn("Invalid access token", output)
        self.assertNotIn("Authentication successful", output)
        self.assertEqual(get.call_count, 1)

    def test_unexpected_http_exits_nonzero(self):
        status, output, get = self.run_main(response(503))

        self.assertEqual(status, 1)
        self.assertIn("API error: 503", output)
        self.assertEqual(get.call_count, 1)

    def test_request_exception_exits_nonzero_without_leaking_exception_text(self):
        status, output, get = self.run_main(requests.Timeout(f"secret={TOKEN}"))

        self.assertEqual(status, 1)
        self.assertIn("Token validation request failed", output)
        self.assertNotIn("Authentication successful", output)
        self.assertEqual(get.call_count, 1)

    def test_user_info_failure_exits_nonzero_without_success_message(self):
        failed = response(401)
        failed.raise_for_status.side_effect = requests.HTTPError(f"secret={TOKEN}")
        status, output, get = self.run_main(response(200), failed)

        self.assertEqual(status, 1)
        self.assertIn("Failed to fetch Concept2 user info", output)
        self.assertNotIn("Authentication successful", output)
        self.assertEqual(get.call_count, 2)

    def test_user_info_non_200_with_valid_body_still_exits_nonzero(self):
        status, output, get = self.run_main(response(200), response(202))

        self.assertEqual(status, 1)
        self.assertIn("Failed to fetch Concept2 user info", output)
        self.assertNotIn("Authentication successful", output)
        self.assertEqual(get.call_count, 2)

    def test_malformed_user_profile_exits_nonzero_without_logging_body(self):
        malformed_profiles = (
            ("missing data", {}),
            ("empty data", {"data": {}}),
            ("null data", {"data": None}),
            ("list data", {"data": []}),
            ("string data", {"data": "invalid"}),
            ("missing username", {"data": {"id": 1}}),
            ("empty username", {"data": {"username": ""}}),
            ("whitespace username", {"data": {"username": "  "}}),
            ("null username", {"data": {"username": None}}),
            ("list username", {"data": {"username": []}}),
            ("number username", {"data": {"username": 7}}),
            ("list root", []),
            ("null root", None),
        )
        for name, profile in malformed_profiles:
            with self.subTest(name=name):
                bad = response(200)
                bad.json.return_value = profile
                bad.text = f"private-body-marker {TOKEN}"
                status, output, get = self.run_main(response(200), bad)

                self.assertEqual(status, 1)
                self.assertIn("Failed to fetch Concept2 user info", output)
                self.assertNotIn("Authentication successful", output)
                self.assertNotIn("User:", output)
                self.assertNotIn("private-body-marker", output)
                self.assertEqual(get.call_count, 2)

    def test_user_profile_json_error_exits_nonzero_without_exception_details(self):
        bad = response(200)
        bad.json.side_effect = ValueError(f"malformed JSON includes {TOKEN}")
        status, output, get = self.run_main(response(200), bad)

        self.assertEqual(status, 1)
        self.assertIn("Failed to fetch Concept2 user info", output)
        self.assertNotIn("Authentication successful", output)
        self.assertEqual(get.call_count, 2)

    def test_cli_entrypoint_propagates_unauthorized_exit(self):
        output = io.StringIO()
        with (
            patch.dict(os.environ, {"C2_ACCESS_TOKEN": TOKEN}),
            patch("requests.get", return_value=response(401)),
            contextlib.redirect_stdout(output),
            self.assertRaises(SystemExit) as exit_status,
        ):
            runpy.run_path(str(SCRIPT), run_name="__main__")

        self.assertEqual(exit_status.exception.code, 1)
        self.assertNotIn(TOKEN, output.getvalue())

    def test_cli_entrypoint_rejects_malformed_user_profile(self):
        bad = response(200)
        bad.json.return_value = {"data": {}}
        bad.text = f"private-body-marker {TOKEN}"
        output = io.StringIO()
        with (
            patch.dict(os.environ, {"C2_ACCESS_TOKEN": TOKEN}),
            patch("requests.get", side_effect=(response(200), bad)),
            contextlib.redirect_stdout(output),
            self.assertRaises(SystemExit) as exit_status,
        ):
            runpy.run_path(str(SCRIPT), run_name="__main__")

        self.assertEqual(exit_status.exception.code, 1)
        self.assertIn("Failed to fetch Concept2 user info", output.getvalue())
        self.assertNotIn("Authentication successful", output.getvalue())
        self.assertNotIn("private-body-marker", output.getvalue())
        self.assertNotIn(TOKEN, output.getvalue())

    def test_cli_missing_token_exits_nonzero(self):
        environment = os.environ.copy()
        environment.pop("C2_ACCESS_TOKEN", None)
        environment["PYTHONIOENCODING"] = "utf-8"
        result = subprocess.run(
            [sys.executable, str(SCRIPT)],
            env=environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=10,
            check=False,
        )

        self.assertEqual(result.returncode, 1)
        self.assertIn("No Concept2 Access Token found", result.stdout)


if __name__ == "__main__":
    unittest.main()
