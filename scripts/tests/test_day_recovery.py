"""Date-scoped recovery regressions using synthetic Concept2 results."""

import contextlib
import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import download_history
import simple_auth


DAY = "2026-11-12"
SCRIPT = Path(download_history.__file__)


def tcx(distance: int) -> bytes:
    return (
        "<TrainingCenterDatabase><Activities><Activity><Lap>"
        f"<DistanceMeters>{distance}</DistanceMeters>"
        "</Lap></Activity></Activities></TrainingCenterDatabase>"
    ).encode()


def page(results: list, total: int, number: int, pages: int) -> Mock:
    response = Mock()
    response.json.return_value = {
        "data": results,
        "meta": {
            "pagination": {
                "total": total,
                "count": len(results),
                "current_page": number,
                "total_pages": pages,
            }
        },
    }
    return response


class FakeAPI:
    def __init__(self, results: list, contents: dict[int, bytes | Exception]):
        self.results = results
        self.contents = contents
        self.listed = 0
        self.strict_flags = []
        self.downloaded = []

    def get_all_results(self, strict_pagination=False):
        self.listed += 1
        self.strict_flags.append(strict_pagination)
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
        self.assertEqual(api.strict_flags, [True])
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


class StrictPaginationTests(unittest.TestCase):
    def setUp(self):
        self.api = simple_auth.SimpleConcept2API(
            simple_auth.SimpleConcept2AuthClient("synthetic-test-token")
        )

    def test_reads_every_consistent_page(self):
        responses = [
            page([{"id": 111, "date": "2026-11-11"}], 2, 1, 2),
            page([{"id": 222, "date": DAY}], 2, 2, 2),
        ]
        with patch.object(simple_auth.requests, "get", side_effect=responses) as get:
            results = self.api.get_all_results(strict_pagination=True)

        self.assertEqual([result["id"] for result in results], [111, 222])
        self.assertEqual(
            [call.kwargs["params"]["page"] for call in get.call_args_list], [1, 2]
        )

    def test_zero_results_requires_consistent_pagination(self):
        for pages in (0, 1):
            with self.subTest(pages=pages):
                with patch.object(
                    simple_auth.requests, "get", return_value=page([], 0, 1, pages)
                ) as get:
                    self.assertEqual(
                        self.api.get_all_results(strict_pagination=True), []
                    )
                get.assert_called_once()

    def test_missing_or_inconsistent_page_metadata_fails_closed(self):
        cases = (
            ("missing pagination", {"data": [], "meta": {}}),
            (
                "missing count",
                {
                    "data": [],
                    "meta": {
                        "pagination": {"total": 0, "current_page": 1, "total_pages": 0}
                    },
                },
            ),
            ("wrong current page", page([{"id": 1}], 1, 2, 2).json.return_value),
            ("count mismatch", page([{"id": 1}], 1, 1, 1).json.return_value),
            ("empty page with nonzero total", page([], 1, 1, 2).json.return_value),
            ("invalid total pages", page([{"id": 1}], 1, 1, 0).json.return_value),
            ("boolean total", page([], True, 1, 1).json.return_value),
        )
        for name, body in cases:
            with self.subTest(name=name):
                if name == "count mismatch":
                    body["meta"]["pagination"]["count"] = 2
                fake = Mock()
                fake.json.return_value = body
                with patch.object(simple_auth.requests, "get", return_value=fake):
                    with self.assertRaises(ValueError):
                        self.api.get_all_results(strict_pagination=True)

    def test_invalid_or_duplicate_result_ids_fail_closed(self):
        for name, result in (
            ("non-object", "invalid"),
            ("missing id", {"date": DAY}),
            ("boolean id", {"id": True, "date": DAY}),
            ("zero id", {"id": 0, "date": DAY}),
            ("unsafe id", {"id": 2**53, "date": DAY}),
        ):
            with self.subTest(name=name):
                with patch.object(
                    simple_auth.requests,
                    "get",
                    return_value=page([result], 1, 1, 1),
                ):
                    with self.assertRaises(ValueError):
                        self.api.get_all_results(strict_pagination=True)

        with patch.object(
            simple_auth.requests,
            "get",
            return_value=page([{"id": 111}, {"id": 111}], 2, 1, 1),
        ):
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                self.api.get_all_results(strict_pagination=True)

    def test_inconsistent_total_and_final_count_fail(self):
        for name, second in (
            ("total changed", page([{"id": 222}], 3, 2, 2)),
            ("final count short", page([{"id": 222}], 3, 2, 2)),
        ):
            with self.subTest(name=name):
                first_total = 2 if name == "total changed" else 3
                first = page([{"id": 111}], first_total, 1, 2)
                with patch.object(
                    simple_auth.requests, "get", side_effect=(first, second)
                ):
                    with self.assertRaises(ValueError):
                        self.api.get_all_results(strict_pagination=True)

    def test_empty_middle_page_cannot_report_day_complete_or_write_data(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        data_dir = Path(temp.name) / "data"
        data_dir.mkdir()
        stats = data_dir / "stats.json"
        stats.write_bytes(b'{"daily_distances":{"2026-11-11":1000}}')
        before = stats.read_bytes()
        responses = [
            page([{"id": 111, "date": "2026-11-11"}], 2, 1, 3),
            page([], 2, 2, 3),
            page([{"id": 222, "date": DAY}], 2, 3, 3),
        ]
        with (
            patch.object(simple_auth.requests, "get", side_effect=responses) as get,
            contextlib.redirect_stdout(io.StringIO()) as output,
            contextlib.redirect_stderr(io.StringIO()),
            self.assertRaises(SystemExit) as exit_status,
        ):
            download_history.main(api=self.api, data_dir=data_dir, workout_date=DAY)

        self.assertEqual(exit_status.exception.code, 1)
        self.assertEqual(get.call_count, 2)
        self.assertNotIn("No workout results found", output.getvalue())
        self.assertEqual(stats.read_bytes(), before)
        self.assertEqual(list(data_dir.rglob("*.tcx")), [])

    def test_duplicate_id_across_pages_cannot_report_day_complete_or_write_data(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        data_dir = Path(temp.name) / "data"
        data_dir.mkdir()
        stats = data_dir / "stats.json"
        stats.write_bytes(b'{"daily_distances":{"2026-11-11":1000}}')
        before = stats.read_bytes()
        responses = [
            page([{"id": 111, "date": DAY}], 2, 1, 2),
            page([{"id": 111, "date": DAY}], 2, 2, 2),
        ]
        with (
            patch.object(simple_auth.requests, "get", side_effect=responses) as get,
            contextlib.redirect_stdout(io.StringIO()) as output,
            contextlib.redirect_stderr(io.StringIO()),
            self.assertRaises(SystemExit) as exit_status,
        ):
            download_history.main(api=self.api, data_dir=data_dir, workout_date=DAY)

        self.assertEqual(exit_status.exception.code, 1)
        self.assertEqual(get.call_count, 2)
        self.assertNotIn("Download Complete!", output.getvalue())
        self.assertEqual(stats.read_bytes(), before)
        self.assertEqual(list(data_dir.rglob("*.tcx")), [])


if __name__ == "__main__":
    unittest.main()
