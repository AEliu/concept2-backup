"""Regression tests for edited Concept2 activities, using synthetic data only."""

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from activity_stats import recover_pending_updates
from download_single import download_activity


def tcx(distance: int) -> bytes:
    return (
        "<TrainingCenterDatabase><Activities><Activity><Lap>"
        f"<DistanceMeters>{distance}</DistanceMeters>"
        "</Lap></Activity></Activities></TrainingCenterDatabase>"
    ).encode()


class FakeAPI:
    def __init__(self, result: dict, content: bytes):
        self.result = result
        self.content = content
        self.downloads = 0

    def get_result_metadata(self, result_id: int) -> dict:
        return self.result

    def download_tcx(self, result_id: int) -> bytes:
        self.downloads += 1
        return self.content


class ActivityUpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.data_dir = Path(self.temp.name) / "data"
        self.data_dir.mkdir()

    def add_tcx(self, date: str, result_id: int, distance: int) -> Path:
        filename = f"{date.replace('-', '_')}_{result_id}.tcx"
        path = self.data_dir / date[:4] / filename
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(tcx(distance))
        return path

    def set_stats(self, distances: dict, files: list[Path]) -> None:
        stats = {
            "daily_distances": distances,
            "processed_files": [path.name for path in files],
        }
        (self.data_dir / "stats.json").write_text(json.dumps(stats), encoding="utf-8")

    def stats(self) -> dict:
        return json.loads((self.data_dir / "stats.json").read_text(encoding="utf-8"))

    def journal(self, result_id: int) -> Path:
        return self.data_dir / f".pending-update-{result_id}.json"

    def stage(self, result_id: int) -> Path:
        return self.data_dir / f".pending-update-{result_id}.stage"

    def test_distance_edit_replaces_existing_file_and_day_total(self):
        old = self.add_tcx("2026-11-09", 123, 1000)
        other = self.add_tcx("2026-11-09", 124, 500)
        self.set_stats({"2026-11-09": 1500, "2020-01-01": 999}, [old, other])
        api = FakeAPI({"id": 123, "date": "2026-11-09 08:00:00"}, tcx(1500))

        path, downloaded = download_activity(api, self.data_dir, 123, update=True)

        self.assertTrue(downloaded)
        self.assertEqual(path, old)
        self.assertEqual(path.read_bytes(), tcx(1500))
        self.assertEqual(
            self.stats()["daily_distances"], {"2026-11-09": 2000, "2020-01-01": 999}
        )
        self.assertEqual(set(self.stats()["processed_files"]), {old.name, other.name})
        self.assertFalse(self.journal(123).exists())
        self.assertFalse(self.stage(123).exists())

        download_activity(api, self.data_dir, 123, update=True)
        self.assertEqual(self.stats()["daily_distances"]["2026-11-09"], 2000)
        self.assertEqual(api.downloads, 2)

    def test_date_edit_removes_old_path_and_reconciles_both_days(self):
        old = self.add_tcx("2026-11-09", 123, 1000)
        old_day_other = self.add_tcx("2026-11-09", 124, 500)
        new_day_other = self.add_tcx("2026-11-10", 125, 250)
        self.set_stats(
            {"2026-11-09": 1500, "2026-11-10": 250},
            [old, old_day_other, new_day_other],
        )
        api = FakeAPI({"id": 123, "date": "2026-11-10 08:00:00"}, tcx(2000))

        path, downloaded = download_activity(api, self.data_dir, 123, update=True)

        self.assertTrue(downloaded)
        self.assertFalse(old.exists())
        self.assertEqual(path.name, "2026_11_10_123.tcx")
        self.assertEqual(
            self.stats()["daily_distances"], {"2026-11-09": 500, "2026-11-10": 2250}
        )
        self.assertEqual(
            set(self.stats()["processed_files"]),
            {old_day_other.name, new_day_other.name, path.name},
        )

    def test_date_edit_across_year_removes_empty_old_day(self):
        old = self.add_tcx("2025-12-31", 123, 1000)
        self.set_stats({"2025-12-31": 1000, "2020-01-01": 999}, [old])
        api = FakeAPI({"id": 123, "date": "2026-01-01"}, tcx(2000))

        path, _ = download_activity(api, self.data_dir, 123, update=True)

        self.assertFalse(old.exists())
        self.assertEqual(path, self.data_dir / "2026" / "2026_01_01_123.tcx")
        self.assertEqual(
            self.stats()["daily_distances"], {"2026-01-01": 2000, "2020-01-01": 999}
        )
        self.assertEqual(self.stats()["processed_files"], [path.name])

    def test_invalid_update_keeps_existing_file_and_stats(self):
        old = self.add_tcx("2026-11-09", 123, 1000)
        self.set_stats({"2026-11-09": 1000}, [old])
        prior_stats = (self.data_dir / "stats.json").read_bytes()
        api = FakeAPI({"id": 123, "date": "2026-11-10"}, b"not TCX")

        with self.assertRaises(ValueError):
            download_activity(api, self.data_dir, 123, update=True)

        self.assertEqual(old.read_bytes(), tcx(1000))
        self.assertEqual((self.data_dir / "stats.json").read_bytes(), prior_stats)
        self.assertFalse((self.data_dir / "2026" / "2026_11_10_123.tcx").exists())
        self.assertFalse(self.journal(123).exists())

    def test_stats_failure_restores_old_file_and_date(self):
        old = self.add_tcx("2026-11-09", 123, 1000)
        self.set_stats({"2026-11-09": 1000}, [old])
        prior_stats = (self.data_dir / "stats.json").read_bytes()
        api = FakeAPI({"id": 123, "date": "2026-11-10"}, tcx(1500))

        with patch(
            "download_single.refresh_dates", side_effect=OSError("stats failed")
        ):
            with self.assertRaisesRegex(OSError, "stats failed"):
                download_activity(api, self.data_dir, 123, update=True)

        self.assertEqual(old.read_bytes(), tcx(1000))
        self.assertEqual((self.data_dir / "stats.json").read_bytes(), prior_stats)
        self.assertFalse((self.data_dir / "2026" / "2026_11_10_123.tcx").exists())
        self.assertFalse(self.journal(123).exists())

    def test_failed_rollback_keeps_journal_for_next_recovery(self):
        import download_single

        old = self.add_tcx("2026-11-09", 123, 1000)
        self.set_stats({"2026-11-09": 1000}, [old])
        api = FakeAPI({"id": 123, "date": "2026-11-10"}, tcx(1500))
        actual_write = download_single.write_atomically

        def fail_restoring_old(path, content):
            if path == old and content == tcx(1000):
                raise OSError("rollback failed")
            actual_write(path, content)

        with (
            patch("download_single.refresh_dates", side_effect=OSError("stats failed")),
            patch("download_single.write_atomically", side_effect=fail_restoring_old),
        ):
            with self.assertRaisesRegex(OSError, "rollback failed"):
                download_activity(api, self.data_dir, 123, update=True)

        self.assertTrue(self.journal(123).exists())
        self.assertTrue(self.stage(123).exists())
        recover_pending_updates(self.data_dir)
        self.assertFalse(self.journal(123).exists())
        self.assertFalse(self.stage(123).exists())
        self.assertEqual(self.stats()["daily_distances"], {"2026-11-10": 1500})

    def test_interrupt_before_new_target_preserves_old_file_and_recovers(self):
        old = self.add_tcx("2026-11-09", 123, 1000)
        self.set_stats({"2026-11-09": 1000}, [old])
        api = FakeAPI({"id": 123, "date": "2026-11-10"}, tcx(1500))

        with patch("download_single.write_atomically", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                download_activity(api, self.data_dir, 123, update=True)

        self.assertTrue(self.journal(123).exists())
        self.assertFalse(self.stage(123).exists())
        self.assertEqual(old.read_bytes(), tcx(1000))
        recover_pending_updates(self.data_dir)
        self.assertFalse(self.journal(123).exists())
        self.assertEqual(self.stats()["daily_distances"], {"2026-11-09": 1000})
        recover_pending_updates(self.data_dir)
        self.assertEqual(self.stats()["daily_distances"], {"2026-11-09": 1000})

    def test_interrupt_after_stage_but_before_target_keeps_old_result(self):
        import download_single

        old = self.add_tcx("2026-11-09", 123, 1000)
        self.set_stats({"2026-11-09": 1000}, [old])
        api = FakeAPI({"id": 123, "date": "2026-11-10"}, tcx(1500))
        actual_write = download_single.write_atomically

        def interrupt_target(path, content):
            if path.suffix == ".tcx":
                raise KeyboardInterrupt
            actual_write(path, content)

        with patch("download_single.write_atomically", side_effect=interrupt_target):
            with self.assertRaises(KeyboardInterrupt):
                download_activity(api, self.data_dir, 123, update=True)

        self.assertTrue(self.journal(123).exists())
        self.assertTrue(self.stage(123).exists())
        self.assertEqual(old.read_bytes(), tcx(1000))
        recover_pending_updates(self.data_dir)
        self.assertEqual(self.stats()["daily_distances"], {"2026-11-09": 1000})
        self.assertFalse(self.journal(123).exists())
        self.assertFalse(self.stage(123).exists())
        self.assertFalse((self.data_dir / "2026" / "2026_11_10_123.tcx").exists())

    def test_same_path_before_target_does_not_mistake_old_file_for_new(self):
        import download_single

        old = self.add_tcx("2026-11-09", 123, 1000)
        self.set_stats({"2026-11-09": 1000}, [old])
        api = FakeAPI({"id": 123, "date": "2026-11-09"}, tcx(1500))
        actual_write = download_single.write_atomically

        def interrupt_target(path, content):
            if path == old:
                raise KeyboardInterrupt
            actual_write(path, content)

        with patch("download_single.write_atomically", side_effect=interrupt_target):
            with self.assertRaises(KeyboardInterrupt):
                download_activity(api, self.data_dir, 123, update=True)

        self.assertEqual(old.read_bytes(), tcx(1000))
        self.assertTrue(self.stage(123).exists())
        recover_pending_updates(self.data_dir)
        self.assertEqual(old.read_bytes(), tcx(1000))
        self.assertEqual(self.stats()["daily_distances"], {"2026-11-09": 1000})
        self.assertFalse(self.journal(123).exists())

    def test_heatmap_startup_recovers_interrupt_after_file_replacement(self):
        import update_heatmap

        old = self.add_tcx("2026-11-09", 123, 1000)
        self.set_stats({"2026-11-09": 1000}, [old])
        api = FakeAPI({"id": 123, "date": "2026-11-10"}, tcx(1500))

        with patch("download_single.refresh_dates", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                download_activity(api, self.data_dir, 123, update=True)

        self.assertFalse(old.exists())
        self.assertTrue(self.journal(123).exists())
        self.assertTrue(self.stage(123).exists())
        self.assertEqual(self.stats()["daily_distances"], {"2026-11-09": 1000})

        with (
            patch.object(update_heatmap, "DATA_DIR", str(self.data_dir)),
            patch.object(
                update_heatmap, "STATS_FILE", str(self.data_dir / "stats.json")
            ),
            patch.object(
                update_heatmap, "OUTPUT_IMAGE", str(self.data_dir / "heatmap.png")
            ),
            patch.object(
                update_heatmap.july,
                "heatmap",
                return_value=SimpleNamespace(collections=[]),
            ),
            patch.object(update_heatmap.plt, "savefig"),
        ):
            update_heatmap.main()

        new = self.data_dir / "2026" / "2026_11_10_123.tcx"
        self.assertEqual(new.read_bytes(), tcx(1500))
        self.assertFalse(self.journal(123).exists())
        self.assertFalse(self.stage(123).exists())
        self.assertEqual(self.stats()["daily_distances"], {"2026-11-10": 1500})
        self.assertEqual(self.stats()["processed_files"], [new.name])
        recover_pending_updates(self.data_dir)
        self.assertEqual(self.stats()["daily_distances"], {"2026-11-10": 1500})

    def test_recovery_removes_old_path_when_target_landed_before_delete(self):
        old = self.add_tcx("2026-11-09", 123, 1000)
        self.set_stats({"2026-11-09": 1000}, [old])
        api = FakeAPI({"id": 123, "date": "2026-11-10"}, tcx(1500))
        actual_unlink = Path.unlink

        def interrupt_old_delete(path, *args, **kwargs):
            if path == old:
                raise KeyboardInterrupt
            return actual_unlink(path, *args, **kwargs)

        with patch("pathlib.Path.unlink", new=interrupt_old_delete):
            with self.assertRaises(KeyboardInterrupt):
                download_activity(api, self.data_dir, 123, update=True)

        new = self.data_dir / "2026" / "2026_11_10_123.tcx"
        self.assertTrue(old.exists())
        self.assertTrue(new.exists())
        self.assertTrue(self.journal(123).exists())
        recover_pending_updates(self.data_dir)
        self.assertFalse(old.exists())
        self.assertEqual(new.read_bytes(), tcx(1500))
        self.assertEqual(self.stats()["daily_distances"], {"2026-11-10": 1500})
        self.assertFalse(self.journal(123).exists())

    def test_same_date_interrupt_recovers_new_distance_once(self):
        old = self.add_tcx("2026-11-09", 123, 1000)
        self.set_stats({"2026-11-09": 1000}, [old])
        api = FakeAPI({"id": 123, "date": "2026-11-09"}, tcx(1500))
        with patch("download_single.refresh_dates", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                download_activity(api, self.data_dir, 123, update=True)

        self.assertEqual(old.read_bytes(), tcx(1500))
        self.assertEqual(self.stats()["daily_distances"], {"2026-11-09": 1000})
        recover_pending_updates(self.data_dir)
        self.assertEqual(self.stats()["daily_distances"], {"2026-11-09": 1500})
        recover_pending_updates(self.data_dir)
        self.assertEqual(self.stats()["daily_distances"], {"2026-11-09": 1500})

    def test_next_update_recovers_prior_interrupted_update(self):
        old = self.add_tcx("2026-11-09", 123, 1000)
        self.set_stats({"2026-11-09": 1000}, [old])
        interrupted = FakeAPI({"id": 123, "date": "2026-11-10"}, tcx(1500))
        with patch("download_single.refresh_dates", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                download_activity(interrupted, self.data_dir, 123, update=True)

        next_api = FakeAPI({"id": 124, "date": "2026-11-10"}, tcx(250))
        download_activity(next_api, self.data_dir, 124, update=True)

        self.assertFalse(self.journal(123).exists())
        self.assertFalse(self.journal(124).exists())
        self.assertEqual(self.stats()["daily_distances"], {"2026-11-10": 1750})

    def test_recovery_rejects_path_traversal_in_journal(self):
        outside = Path(self.temp.name) / "outside.tcx"
        outside.write_bytes(tcx(1000))
        self.journal(123).write_text(
            json.dumps(
                {
                    "result_id": 123,
                    "target": "../outside.tcx",
                    "affected_dates": ["2026-11-10"],
                }
            ),
            encoding="utf-8",
        )

        with self.assertRaisesRegex(ValueError, "pending target"):
            recover_pending_updates(self.data_dir)

        self.assertEqual(outside.read_bytes(), tcx(1000))
        self.assertTrue(self.journal(123).exists())

    def test_added_event_still_skips_existing_filename(self):
        old = self.add_tcx("2026-11-09", 123, 1000)
        api = FakeAPI({"id": 123, "date": "2026-11-09"}, tcx(1500))

        path, downloaded = download_activity(api, self.data_dir, 123)

        self.assertEqual(path, old)
        self.assertFalse(downloaded)
        self.assertEqual(api.downloads, 0)
        self.assertEqual(old.read_bytes(), tcx(1000))

    def test_mismatched_metadata_id_is_rejected(self):
        api = FakeAPI({"id": 124, "date": "2026-11-09"}, tcx(1500))
        with self.assertRaisesRegex(ValueError, "does not match"):
            download_activity(api, self.data_dir, 123, update=True)
        self.assertEqual(api.downloads, 0)

    def test_malformed_metadata_date_cannot_escape_data_directory(self):
        api = FakeAPI({"id": 123, "date": "2026-11-09/../../outside"}, tcx(1500))
        with self.assertRaisesRegex(ValueError, "invalid ID or date"):
            download_activity(api, self.data_dir, 123, update=True)
        self.assertEqual(list(self.data_dir.rglob("*.tcx")), [])


if __name__ == "__main__":
    unittest.main()
