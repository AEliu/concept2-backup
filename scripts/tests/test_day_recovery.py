"""Date-scoped recovery regressions using synthetic Concept2 results."""

import contextlib
import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import download_history


DAY = "2026-11-12"
SCRIPT = Path(download_history.__file__)


def tcx(distance: int) -> bytes:
    return (
        "<TrainingCenterDatabase><Activities><Activity><Lap>"
        f"<DistanceMeters>{distance}</DistanceMeters>"
        "</Lap></Activity></Activities></TrainingCenterDatabase>"
    ).encode()


class FakeAPI:
    def __init__(self, results: list, contents: dict[int, bytes | Exception]):
        self.results = results
        self.contents = contents
        self.listed = 0
        self.downloaded = []

    def get_all_results(self):
        self.listed += 1
        return self.results

    def download_tcx(self, result_id):
        self.downloaded.append(result_id)
        content = self.contents[result_id]
        if isinstance(content, Exception):
            raise content
        return content


class DayRecoveryTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.data_dir = Path(temp.name) / "data"

    def path(self, day: str, result_id: int) -> Path:
        return self.data_dir / day[:4] / f"{day.replace('-', '_')}_{result_id}.tcx"

    def run_day(self, api: FakeAPI, day: str = DAY) -> str:
        output = io.StringIO()
        with (
            patch.object(download_history.time, "sleep"),
            contextlib.redirect_stdout(output),
        ):
            download_history.main(api=api, data_dir=self.data_dir, workout_date=day)
        return output.getvalue()

    def test_day_recovery_skips_existing_downloads_missing_and_ignores_other_day(self):
        existing = self.path(DAY, 111)
        other_day = self.path("2026-11-11", 333)
        for path, content in ((existing, tcx(1000)), (other_day, tcx(3000))):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        stats = self.data_dir / "stats.json"
        stats.write_bytes(
            b'{"daily_distances":{"2026-11-11":3000},"processed_files":[]}'
        )
        before_stats = stats.read_bytes()
        api = FakeAPI(
            [
                {"id": 111, "date": f"{DAY} 08:00:00"},
                {"id": 222, "date": f"{DAY} 09:00:00"},
                {"id": 333, "date": "2026-11-11 07:00:00"},
            ],
            {111: tcx(9999), 222: tcx(2000), 333: tcx(9999)},
        )

        output = self.run_day(api)

        self.assertEqual(api.listed, 1)
        self.assertEqual(api.downloaded, [222])
        self.assertEqual(existing.read_bytes(), tcx(1000))
        self.assertEqual(self.path(DAY, 222).read_bytes(), tcx(2000))
        self.assertEqual(other_day.read_bytes(), tcx(3000))
        self.assertEqual(stats.read_bytes(), before_stats)
        self.assertIn("Total results: 2", output)
        self.assertIn("Downloaded: 1", output)
        self.assertIn("Skipped (already exists): 1", output)

    def test_invalid_date_fails_before_api_or_data_writes(self):
        for value in ("", "2026-2-03", "2026-02-30", "2026-11-12junk", "2026-W46-4"):
            with self.subTest(value=value):
                api = FakeAPI([], {})
                with (
                    contextlib.redirect_stderr(io.StringIO()),
                    self.assertRaises(SystemExit) as exit_status,
                ):
                    download_history.main(
                        api=api, data_dir=self.data_dir, workout_date=value
                    )
                self.assertEqual(exit_status.exception.code, 2)
                self.assertEqual(api.listed, 0)
                self.assertFalse(self.data_dir.exists())

    def test_cli_requires_date_value_before_authentication(self):
        environment = os.environ.copy()
        environment.pop("C2_ACCESS_TOKEN", None)
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--date"],
            env=environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=10,
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("expected one argument", result.stderr)
        self.assertNotIn("API", result.stdout)

    def test_zero_results_for_day_is_explicit(self):
        api = FakeAPI([{"id": 333, "date": "2026-11-11"}], {333: tcx(3000)})
        output = io.StringIO()
        with (
            contextlib.redirect_stdout(output),
            self.assertRaises(SystemExit) as exit_status,
        ):
            download_history.main(api=api, data_dir=self.data_dir, workout_date=DAY)

        self.assertEqual(exit_status.exception.code, 0)
        self.assertEqual(api.listed, 1)
        self.assertEqual(api.downloaded, [])
        self.assertIn(f"No workout results found for {DAY}.", output.getvalue())

    def test_partial_day_download_failure_exits_nonzero_and_continues(self):
        api = FakeAPI(
            [
                {"id": 111, "date": DAY},
                {"id": 222, "date": DAY},
                {"id": 333, "date": "2026-11-11"},
            ],
            {111: OSError("API unavailable"), 222: tcx(2000), 333: tcx(3000)},
        )
        output = io.StringIO()
        with (
            patch.object(download_history.time, "sleep"),
            contextlib.redirect_stdout(output),
            self.assertRaises(SystemExit) as exit_status,
        ):
            download_history.main(api=api, data_dir=self.data_dir, workout_date=DAY)

        self.assertEqual(exit_status.exception.code, 1)
        self.assertEqual(api.downloaded, [111, 222])
        self.assertFalse(self.path(DAY, 111).exists())
        self.assertEqual(self.path(DAY, 222).read_bytes(), tcx(2000))
        self.assertFalse(self.path("2026-11-11", 333).exists())
        self.assertIn("Failed result IDs: 111", output.getvalue())

    def test_unknown_metadata_date_fails_before_download(self):
        api = FakeAPI(
            [{"id": 111, "date": DAY}, {"id": 222, "date": None}],
            {111: tcx(1000), 222: tcx(2000)},
        )
        with (
            contextlib.redirect_stdout(io.StringIO()),
            contextlib.redirect_stderr(io.StringIO()),
            self.assertRaises(SystemExit) as exit_status,
        ):
            download_history.main(api=api, data_dir=self.data_dir, workout_date=DAY)
        self.assertEqual(exit_status.exception.code, 1)
        self.assertEqual(api.downloaded, [])
        self.assertFalse(self.path(DAY, 111).exists())

    def test_day_recovery_rejects_cross_date_copy_before_writing(self):
        old = self.path("2026-11-11", 111)
        old.parent.mkdir(parents=True)
        old.write_bytes(tcx(1000))
        api = FakeAPI([{"id": 111, "date": DAY}], {111: tcx(2000)})
        with (
            contextlib.redirect_stdout(io.StringIO()),
            contextlib.redirect_stderr(io.StringIO()),
            self.assertRaises(SystemExit) as exit_status,
        ):
            download_history.main(api=api, data_dir=self.data_dir, workout_date=DAY)
        self.assertEqual(exit_status.exception.code, 1)
        self.assertEqual(api.downloaded, [])
        self.assertEqual(old.read_bytes(), tcx(1000))
        self.assertFalse(self.path(DAY, 111).exists())

    def test_day_recovery_does_not_resume_unrelated_pending_update(self):
        self.data_dir.mkdir()
        journal = self.data_dir / ".pending-update-999.json"
        journal.write_text("{}", encoding="utf-8")
        api = FakeAPI([{"id": 111, "date": DAY}], {111: tcx(1000)})
        with (
            contextlib.redirect_stdout(io.StringIO()),
            contextlib.redirect_stderr(io.StringIO()),
            self.assertRaises(SystemExit) as exit_status,
        ):
            download_history.main(api=api, data_dir=self.data_dir, workout_date=DAY)
        self.assertEqual(exit_status.exception.code, 1)
        self.assertEqual(api.downloaded, [])
        self.assertEqual(journal.read_text(encoding="utf-8"), "{}")
        self.assertFalse(self.path(DAY, 111).exists())


if __name__ == "__main__":
    unittest.main()
