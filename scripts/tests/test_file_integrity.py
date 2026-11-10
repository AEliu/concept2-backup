"""Backup integrity regressions using temporary synthetic workouts only."""

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import activity_stats
import download_history
import download_single
import update_heatmap


def tcx(distance: str = "1000") -> bytes:
    return (
        "<TrainingCenterDatabase><Activities><Activity><Lap>"
        f"<DistanceMeters>{distance}</DistanceMeters>"
        "</Lap></Activity></Activities></TrainingCenterDatabase>"
    ).encode()


class FakeAPI:
    def __init__(self, contents: dict[int, bytes | Exception]):
        self.contents = contents
        self.downloaded = []

    def download_tcx(self, result_id):
        self.downloaded.append(result_id)
        content = self.contents[result_id]
        if isinstance(content, Exception):
            raise content
        return content

    def get_result_metadata(self, result_id):
        return {"id": result_id, "date": "2026-11-10"}

    def get_all_results(self):
        return [{"id": result_id, "date": "2026-11-10"} for result_id in self.contents]


class FileIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.data_dir = Path(self.temp.name) / "data"
        self.data_dir.mkdir()
        self.result = {"id": 123, "date": "2026-11-10"}
        self.path = self.data_dir / "2026" / "2026_11_10_123.tcx"

    def test_both_downloaders_accept_valid_tcx_atomically(self):
        for save in (download_single.save_tcx_file, download_history.save_tcx_file):
            with self.subTest(save=save.__module__):
                self.assertEqual(save(self.data_dir, self.result, tcx()), self.path)
                self.assertEqual(self.path.read_bytes(), tcx())
                self.assertEqual(
                    list(self.path.parent.glob(".2026_11_10_123.tcx.*")), []
                )

    def test_namespaced_workout_structure_is_accepted(self):
        namespaced = (
            b'<TrainingCenterDatabase xmlns="urn:garmin:tcx">'
            b"<Activities><Activity><Lap><DistanceMeters>1200</DistanceMeters>"
            b"</Lap></Activity></Activities></TrainingCenterDatabase>"
        )
        self.assertEqual(activity_stats.tcx_distance(namespaced), 1200)

    def test_invalid_xml_and_distance_never_replace_existing_file(self):
        self.path.parent.mkdir()
        self.path.write_bytes(tcx())
        for save in (download_single.save_tcx_file, download_history.save_tcx_file):
            for content in (
                b"not XML",
                tcx("NaN"),
                tcx("-1"),
                b"<TrainingCenterDatabase/>",
                b"<TrainingCenterDatabase><Lap><DistanceMeters>1000</DistanceMeters></Lap></TrainingCenterDatabase>",
                b"<TrainingCenterDatabase><Activities><Activity/></Activities></TrainingCenterDatabase>",
                b"<TrainingCenterDatabase><Activities><Activity><Track><Lap><DistanceMeters>1000</DistanceMeters></Lap></Track></Activity></Activities></TrainingCenterDatabase>",
                b"<TrainingCenterDatabase><Activities><Activity><Lap/></Activity></Activities></TrainingCenterDatabase>",
                b"<TrainingCenterDatabase><Activities><Activity><Lap><DistanceMeters>1000</DistanceMeters><DistanceMeters>2000</DistanceMeters></Lap></Activity></Activities></TrainingCenterDatabase>",
            ):
                with self.subTest(save=save.__module__, content=content):
                    with self.assertRaises(ValueError):
                        save(self.data_dir, self.result, content)
                    self.assertEqual(self.path.read_bytes(), tcx())

    def test_failed_atomic_replace_preserves_old_file_and_cleans_temp(self):
        self.path.parent.mkdir()
        self.path.write_bytes(tcx())
        with patch.object(
            activity_stats.os, "replace", side_effect=OSError("replace failed")
        ):
            with self.assertRaisesRegex(OSError, "replace failed"):
                download_history.save_tcx_file(self.data_dir, self.result, tcx("1500"))
        self.assertEqual(self.path.read_bytes(), tcx())
        self.assertEqual(list(self.path.parent.glob(".2026_11_10_123.tcx.*")), [])

    def test_existing_invalid_file_is_redownloaded_by_single_and_history(self):
        self.path.parent.mkdir()
        self.path.write_bytes(b"<truncated")
        stats_path = self.data_dir / "stats.json"
        stats_path.write_text(
            json.dumps(
                {
                    "daily_distances": {"2026-11-10": 0},
                    "processed_files": [self.path.name],
                }
            ),
            encoding="utf-8",
        )
        single_api = FakeAPI({123: tcx("1500")})
        path, downloaded = download_single.download_activity(
            single_api, self.data_dir, 123
        )
        self.assertTrue(downloaded)
        self.assertEqual(path.read_bytes(), tcx("1500"))
        self.assertEqual(single_api.downloaded, [123])
        self.assertEqual(
            json.loads(stats_path.read_text())["daily_distances"]["2026-11-10"], 1500
        )

        self.path.write_bytes(b"<truncated")
        history_api = FakeAPI({123: tcx("2000")})
        with patch.object(download_history.time, "sleep"):
            downloaded, skipped, failures = download_history.download_results(
                history_api, self.data_dir, [self.result]
            )
        self.assertEqual((downloaded, skipped, failures), (1, 0, []))
        self.assertEqual(history_api.downloaded, [123])
        self.assertEqual(self.path.read_bytes(), tcx("2000"))
        self.assertEqual(
            json.loads(stats_path.read_text())["daily_distances"]["2026-11-10"], 2000
        )

    def test_valid_existing_file_is_skipped(self):
        self.path.parent.mkdir()
        self.path.write_bytes(tcx())
        api = FakeAPI({123: tcx("1500")})
        path, downloaded = download_single.download_activity(api, self.data_dir, 123)
        self.assertFalse(downloaded)
        self.assertEqual(path, self.path)
        self.assertEqual(api.downloaded, [])
        self.assertTrue(download_history.tcx_file_exists(self.data_dir, self.result))

    def test_invalid_heatmap_input_does_not_mark_any_file_processed(self):
        self.path.parent.mkdir()
        self.path.write_bytes(b"<truncated")
        stats_path = self.data_dir / "stats.json"
        before = b'{"daily_distances": {"2020-01-01": 500}, "processed_files": []}'
        stats_path.write_bytes(before)
        with (
            patch.object(update_heatmap, "DATA_DIR", str(self.data_dir)),
            patch.object(update_heatmap, "STATS_FILE", str(stats_path)),
        ):
            with self.assertRaises(ValueError):
                update_heatmap.main()
        self.assertEqual(stats_path.read_bytes(), before)

    def test_already_processed_corrupt_file_still_fails_heatmap(self):
        self.path.parent.mkdir()
        self.path.write_bytes(b"<truncated")
        stats_path = self.data_dir / "stats.json"
        before = json.dumps(
            {
                "daily_distances": {"2026-11-10": 1000},
                "processed_files": [self.path.name],
            }
        ).encode()
        stats_path.write_bytes(before)
        with (
            patch.object(update_heatmap, "DATA_DIR", str(self.data_dir)),
            patch.object(update_heatmap, "STATS_FILE", str(stats_path)),
        ):
            with self.assertRaises(ValueError):
                update_heatmap.main()
        self.assertEqual(stats_path.read_bytes(), before)

    def test_stats_save_failure_preserves_existing_json(self):
        stats_path = self.data_dir / "stats.json"
        before = b'{"daily_distances": {}, "processed_files": []}'
        stats_path.write_bytes(before)
        with (
            patch.object(update_heatmap, "STATS_FILE", str(stats_path)),
            patch.object(
                activity_stats.os, "replace", side_effect=OSError("replace failed")
            ),
        ):
            with self.assertRaisesRegex(OSError, "replace failed"):
                update_heatmap.save_stats(
                    {
                        "daily_distances": {"2026-11-10": 1000},
                        "processed_files": [self.path.name],
                    }
                )
        self.assertEqual(stats_path.read_bytes(), before)
        self.assertEqual(list(self.data_dir.glob(".stats.json.*")), [])

    def test_malformed_stats_json_fails_without_overwrite(self):
        stats_path = self.data_dir / "stats.json"
        stats_path.write_bytes(b"{broken")
        with patch.object(update_heatmap, "STATS_FILE", str(stats_path)):
            with self.assertRaises(json.JSONDecodeError):
                update_heatmap.load_stats()
        self.assertEqual(stats_path.read_bytes(), b"{broken")

    def test_full_history_reports_each_failure_after_attempting_remaining_results(self):
        api = FakeAPI(
            {1: tcx(), 2: OSError("API unavailable"), 3: b"not XML", 4: tcx("2000")}
        )
        output = io.StringIO()
        with (
            patch.object(download_history.time, "sleep"),
            contextlib.redirect_stdout(output),
        ):
            with self.assertRaises(SystemExit) as exit_result:
                download_history.main(api=api, data_dir=self.data_dir)
        self.assertEqual(exit_result.exception.code, 1)
        self.assertEqual(api.downloaded, [1, 2, 3, 4])
        self.assertIn("Failed result IDs: 2, 3", output.getvalue())
        self.assertEqual(
            (self.data_dir / "2026" / "2026_11_10_1.tcx").read_bytes(), tcx()
        )
        self.assertEqual(
            (self.data_dir / "2026" / "2026_11_10_4.tcx").read_bytes(), tcx("2000")
        )
        self.assertFalse((self.data_dir / "2026" / "2026_11_10_3.tcx").exists())

    def test_full_history_all_success_returns_normally(self):
        api = FakeAPI({1: tcx(), 2: tcx("2000")})
        output = io.StringIO()
        with (
            patch.object(download_history.time, "sleep"),
            contextlib.redirect_stdout(output),
        ):
            download_history.main(api=api, data_dir=self.data_dir)
        self.assertEqual(api.downloaded, [1, 2])
        self.assertIn("Errors: 0", output.getvalue())
        self.assertNotIn("Failed result IDs:", output.getvalue())

    def test_full_history_date_change_removes_old_result_and_old_day_stats(self):
        old = self.data_dir / "2025" / "2025_12_31_123.tcx"
        old.parent.mkdir()
        old.write_bytes(tcx("1000"))
        stats_path = self.data_dir / "stats.json"
        stats_path.write_text(
            json.dumps(
                {"daily_distances": {"2025-12-31": 1000}, "processed_files": [old.name]}
            ),
            encoding="utf-8",
        )
        api = FakeAPI({123: tcx("1500")})
        with patch.object(download_history.time, "sleep"):
            downloaded, skipped, failed = download_history.download_results(
                api, self.data_dir, [self.result]
            )

        self.assertEqual((downloaded, skipped, failed), (1, 0, []))
        self.assertFalse(old.exists())
        self.assertEqual(self.path.read_bytes(), tcx("1500"))
        stats = json.loads(stats_path.read_text())
        self.assertEqual(stats["daily_distances"], {"2026-11-10": 1500})
        self.assertEqual(stats["processed_files"], [self.path.name])

    def test_full_history_reconciles_multiple_old_paths_for_one_result(self):
        first = self.data_dir / "2024" / "2024_01_01_123.tcx"
        second = self.data_dir / "2025" / "2025_02_02_123.tcx"
        for path, content in ((first, tcx("1000")), (second, tcx("2000"))):
            path.parent.mkdir()
            path.write_bytes(content)
        stats_path = self.data_dir / "stats.json"
        stats_path.write_text(
            json.dumps(
                {
                    "daily_distances": {"2024-01-01": 1000, "2025-02-02": 2000},
                    "processed_files": [first.name, second.name],
                }
            ),
            encoding="utf-8",
        )
        api = FakeAPI({123: tcx("3000")})
        with patch.object(download_history.time, "sleep"):
            downloaded, skipped, failed = download_history.download_results(
                api, self.data_dir, [self.result]
            )

        self.assertEqual((downloaded, skipped, failed), (1, 0, []))
        self.assertFalse(first.exists())
        self.assertFalse(second.exists())
        self.assertEqual(self.path.read_bytes(), tcx("3000"))
        stats = json.loads(stats_path.read_text())
        self.assertEqual(stats["daily_distances"], {"2026-11-10": 3000})
        self.assertEqual(stats["processed_files"], [self.path.name])

    def test_full_history_update_failure_rolls_back_then_attempts_next_result(self):
        old = self.data_dir / "2025" / "2025_12_31_123.tcx"
        old.parent.mkdir()
        old.write_bytes(tcx("1000"))
        stats_path = self.data_dir / "stats.json"
        previous_stats = json.dumps(
            {
                "daily_distances": {"2025-12-31": 1000},
                "processed_files": [old.name],
            }
        ).encode()
        stats_path.write_bytes(previous_stats)
        api = FakeAPI({123: tcx("1500"), 124: tcx("2000")})
        results = [self.result, {"id": 124, "date": "2026-11-10"}]
        with (
            patch("download_single.refresh_dates", side_effect=OSError("stats failed")),
            patch.object(download_history.time, "sleep"),
        ):
            downloaded, skipped, failed = download_history.download_results(
                api, self.data_dir, results
            )

        self.assertEqual((downloaded, skipped, failed), (1, 0, [123]))
        self.assertEqual(api.downloaded, [123, 124])
        self.assertEqual(old.read_bytes(), tcx("1000"))
        self.assertFalse(self.path.exists())
        self.assertEqual(stats_path.read_bytes(), previous_stats)
        self.assertEqual(
            (self.data_dir / "2026" / "2026_11_10_124.tcx").read_bytes(), tcx("2000")
        )
        self.assertEqual(list(self.data_dir.glob(".pending-update-*.json")), [])

    def test_full_history_valid_target_with_stale_old_path_is_reconciled(self):
        old = self.data_dir / "2025" / "2025_12_31_123.tcx"
        old.parent.mkdir()
        old.write_bytes(tcx("1000"))
        self.path.parent.mkdir()
        self.path.write_bytes(tcx("1500"))
        stats_path = self.data_dir / "stats.json"
        stats_path.write_text(
            json.dumps(
                {
                    "daily_distances": {"2025-12-31": 1000, "2026-11-10": 1500},
                    "processed_files": [old.name, self.path.name],
                }
            ),
            encoding="utf-8",
        )
        api = FakeAPI({123: tcx("1500")})
        with patch.object(download_history.time, "sleep"):
            downloaded, skipped, failed = download_history.download_results(
                api, self.data_dir, [self.result]
            )

        self.assertEqual((downloaded, skipped, failed), (1, 0, []))
        self.assertFalse(old.exists())
        self.assertEqual(
            json.loads(stats_path.read_text())["daily_distances"], {"2026-11-10": 1500}
        )

    def test_bad_date_cannot_write_outside_data_directory(self):
        bad_result = {"id": 123, "date": "2026-11-10/../../outside"}
        with self.assertRaises(ValueError):
            download_history.save_tcx_file(self.data_dir, bad_result, tcx())
        with self.assertRaises(ValueError):
            download_single.save_tcx_file(self.data_dir, bad_result, tcx())
        self.assertEqual(list(self.data_dir.rglob("*.tcx")), [])


if __name__ == "__main__":
    unittest.main()
