"""Manual daily distance must survive result replacement and recovery."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import download_history
import download_single
from activity_stats import MAX_SAFE_DISTANCE, recover_pending_updates


def tcx(distance: int) -> bytes:
    return (
        "<TrainingCenterDatabase><Activities><Activity><Lap>"
        f"<DistanceMeters>{distance}</DistanceMeters>"
        "</Lap></Activity></Activities></TrainingCenterDatabase>"
    ).encode()


class FakeAPI:
    def __init__(self, content: bytes):
        self.content = content

    def download_tcx(self, result_id: int) -> bytes:
        return self.content


class ManualAdjustmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.data_dir = Path(self.temp.name) / "data"
        self.data_dir.mkdir()
        self.stats_path = self.data_dir / "stats.json"

    def add_tcx(self, date: str, result_id: int, distance: int) -> Path:
        path = self.data_dir / date[:4] / f"{date.replace('-', '_')}_{result_id}.tcx"
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(tcx(distance))
        return path

    def set_stats(self, daily: dict[str, int], processed: list[Path]):
        self.stats_path.write_text(
            json.dumps(
                {
                    "daily_distances": daily,
                    "processed_files": [path.name for path in processed],
                }
            ),
            encoding="utf-8",
        )

    def stats(self) -> dict:
        return json.loads(self.stats_path.read_text(encoding="utf-8"))

    def test_same_day_update_preserves_manual_five_kilometers(self):
        old = self.add_tcx("2026-03-04", 123, 2000)
        self.set_stats({"2026-03-04": 7000}, [old])
        result = {"id": 123, "date": "2026-03-04"}

        download_single.update_tcx_file(self.data_dir, result, tcx(2000))
        self.assertEqual(self.stats()["daily_distances"], {"2026-03-04": 7000})
        download_single.update_tcx_file(self.data_dir, result, tcx(2500))
        self.assertEqual(self.stats()["daily_distances"], {"2026-03-04": 7500})
        self.assertEqual(old.read_bytes(), tcx(2500))

    def test_move_off_manual_day_retains_only_manual_distance(self):
        old = self.add_tcx("2026-03-04", 123, 2000)
        self.set_stats({"2026-03-04": 7000}, [old])

        new = download_single.update_tcx_file(
            self.data_dir, {"id": 123, "date": "2026-03-05"}, tcx(2500)
        )

        self.assertFalse(old.exists())
        self.assertEqual(new.read_bytes(), tcx(2500))
        self.assertEqual(
            self.stats()["daily_distances"],
            {"2026-03-04": 5000, "2026-03-05": 2500},
        )

    def test_move_onto_manual_only_day_adds_both_distances(self):
        old = self.add_tcx("2026-03-04", 123, 2000)
        self.set_stats({"2026-03-04": 7000, "2026-01-26": 1000}, [old])

        download_single.update_tcx_file(
            self.data_dir, {"id": 123, "date": "2026-01-26"}, tcx(2000)
        )

        self.assertEqual(
            self.stats()["daily_distances"],
            {"2026-03-04": 5000, "2026-01-26": 3000},
        )

    def test_negative_one_meter_rounding_adjustment_survives_same_day_edit(self):
        old = self.add_tcx("2020-08-04", 123, 1001)
        self.set_stats({"2020-08-04": 1000}, [old])

        download_single.update_tcx_file(
            self.data_dir, {"id": 123, "date": "2020-08-04"}, tcx(1501)
        )

        self.assertEqual(self.stats()["daily_distances"], {"2020-08-04": 1500})

    def test_negative_final_total_rejects_move_before_writing(self):
        old = self.add_tcx("2020-08-04", 123, 1001)
        self.set_stats({"2020-08-04": 1000}, [old])
        before = self.stats_path.read_bytes()

        with self.assertRaisesRegex(ValueError, "safe range"):
            download_single.update_tcx_file(
                self.data_dir, {"id": 123, "date": "2020-08-05"}, tcx(1500)
            )

        self.assertEqual(old.read_bytes(), tcx(1001))
        self.assertEqual(self.stats_path.read_bytes(), before)
        self.assertEqual(list(self.data_dir.glob(".pending-update-*")), [])

    def test_unsafe_stored_daily_distance_fails_before_writing(self):
        old = self.add_tcx("2026-03-04", 123, 2000)
        for invalid in (True, -1, 1.5, MAX_SAFE_DISTANCE + 1):
            with self.subTest(invalid=invalid):
                self.set_stats({"2026-03-04": invalid}, [old])
                before = self.stats_path.read_bytes()
                with self.assertRaisesRegex(ValueError, "stored daily distance"):
                    download_single.update_tcx_file(
                        self.data_dir,
                        {"id": 123, "date": "2026-03-04"},
                        tcx(2500),
                    )
                self.assertEqual(old.read_bytes(), tcx(2000))
                self.assertEqual(self.stats_path.read_bytes(), before)
                self.assertEqual(list(self.data_dir.glob(".pending-update-*")), [])

    def test_crash_recovery_uses_frozen_adjustment(self):
        old = self.add_tcx("2026-03-04", 123, 2000)
        self.set_stats({"2026-03-04": 7000}, [old])
        with patch.object(
            download_single, "refresh_dates", side_effect=KeyboardInterrupt
        ):
            with self.assertRaises(KeyboardInterrupt):
                download_single.update_tcx_file(
                    self.data_dir, {"id": 123, "date": "2026-03-04"}, tcx(2500)
                )

        journal = self.data_dir / ".pending-update-123.json"
        self.assertEqual(
            json.loads(journal.read_text())["date_adjustments"],
            {"2026-03-04": 5000},
        )
        self.assertEqual(self.stats()["daily_distances"], {"2026-03-04": 7000})
        recover_pending_updates(self.data_dir)
        self.assertEqual(self.stats()["daily_distances"], {"2026-03-04": 7500})
        self.assertFalse(journal.exists())
        recover_pending_updates(self.data_dir)
        self.assertEqual(self.stats()["daily_distances"], {"2026-03-04": 7500})

    def test_full_history_date_change_preserves_both_manual_days(self):
        old = self.add_tcx("2026-03-04", 123, 2000)
        self.set_stats({"2026-03-04": 7000, "2026-01-26": 1000}, [old])
        result = {"id": 123, "date": "2026-01-26"}
        with patch.object(download_history.time, "sleep"):
            outcome = download_history.download_results(
                FakeAPI(tcx(1500)), self.data_dir, [result]
            )

        self.assertEqual(outcome, (1, 0, []))
        self.assertFalse(old.exists())
        self.assertEqual(
            self.stats()["daily_distances"],
            {"2026-03-04": 5000, "2026-01-26": 2500},
        )

    def test_external_history_write_during_interrupt_keeps_frozen_adjustments(self):
        old = self.add_tcx("2026-03-04", 123, 2000)
        self.set_stats({"2026-03-04": 7000, "2026-01-26": 1000}, [old])
        result = {"id": 123, "date": "2026-01-26"}
        with patch.object(
            download_single, "write_atomically", side_effect=KeyboardInterrupt
        ):
            with self.assertRaises(KeyboardInterrupt):
                download_single.update_tcx_file(self.data_dir, result, tcx(1500))

        target = download_history.save_tcx_file(self.data_dir, result, tcx(1500))
        self.assertTrue(old.exists())
        self.assertTrue(target.exists())
        recover_pending_updates(self.data_dir)

        self.assertFalse(old.exists())
        self.assertEqual(
            self.stats()["daily_distances"],
            {"2026-03-04": 5000, "2026-01-26": 2500},
        )
        self.assertEqual(self.stats()["processed_files"], [target.name])

    def test_unprocessed_tcx_is_not_mistaken_for_manual_distance(self):
        old = self.add_tcx("2026-03-04", 123, 1000)
        unprocessed = self.add_tcx("2026-03-04", 124, 300)
        self.set_stats({"2026-03-04": 1500}, [old])

        download_single.update_tcx_file(
            self.data_dir, {"id": 123, "date": "2026-03-04"}, tcx(2000)
        )

        self.assertEqual(self.stats()["daily_distances"], {"2026-03-04": 2800})
        self.assertEqual(
            set(self.stats()["processed_files"]), {old.name, unprocessed.name}
        )

    def test_missing_processed_tcx_is_not_mistaken_for_manual_distance(self):
        old = self.add_tcx("2026-03-04", 123, 2000)
        missing = self.data_dir / "2026" / "2026_03_04_124.tcx"
        self.set_stats({"2026-03-04": 7000}, [old, missing])
        before = self.stats_path.read_bytes()

        with self.assertRaisesRegex(ValueError, "Processed TCX is missing"):
            download_single.update_tcx_file(
                self.data_dir, {"id": 123, "date": "2026-03-04"}, tcx(2500)
            )

        self.assertEqual(old.read_bytes(), tcx(2000))
        self.assertEqual(self.stats_path.read_bytes(), before)
        self.assertEqual(list(self.data_dir.glob(".pending-update-*")), [])

    def test_legacy_and_malformed_journals_fail_before_changes(self):
        old = self.add_tcx("2026-03-04", 123, 2000)
        self.set_stats({"2026-03-04": 7000}, [old])
        before_stats = self.stats_path.read_bytes()
        before_tcx = old.read_bytes()
        journal = self.data_dir / ".pending-update-123.json"
        valid = {
            "result_id": 123,
            "target": "2026/2026_03_04_123.tcx",
            "affected_dates": ["2026-03-04"],
            "target_preexisted": True,
            "date_adjustments": {"2026-03-04": 5000},
        }
        bad_adjustments = [
            None,
            {"2026-03-05": 5000},
            {"2026-03-04": True},
            {"2026-03-04": 1.5},
            {"2026-03-04": MAX_SAFE_DISTANCE + 1},
        ]
        records = [
            {key: value for key, value in valid.items() if key != "date_adjustments"}
        ]
        records.extend(valid | {"date_adjustments": value} for value in bad_adjustments)
        for record in records:
            with self.subTest(record=record):
                journal.write_text(json.dumps(record), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "journal|adjustment"):
                    recover_pending_updates(self.data_dir)
                self.assertEqual(old.read_bytes(), before_tcx)
                self.assertEqual(self.stats_path.read_bytes(), before_stats)
                self.assertEqual(journal.read_text(), json.dumps(record))

    def test_invalid_adjustment_that_would_make_negative_total_keeps_old_paths(self):
        old = self.add_tcx("2026-03-04", 123, 2000)
        target = self.add_tcx("2026-03-05", 123, 1500)
        self.set_stats({"2026-03-04": 7000}, [old])
        before_stats = self.stats_path.read_bytes()
        journal = self.data_dir / ".pending-update-123.json"
        journal.write_text(
            json.dumps(
                {
                    "result_id": 123,
                    "target": "2026/2026_03_05_123.tcx",
                    "affected_dates": ["2026-03-04", "2026-03-05"],
                    "target_preexisted": False,
                    "date_adjustments": {"2026-03-04": -3000, "2026-03-05": 0},
                }
            ),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(ValueError, "safe range"):
            recover_pending_updates(self.data_dir)
        self.assertTrue(old.exists())
        self.assertTrue(target.exists())
        self.assertEqual(self.stats_path.read_bytes(), before_stats)
        self.assertTrue(journal.exists())

    def test_journal_cannot_delete_an_old_date_it_does_not_reconcile(self):
        old = self.add_tcx("2026-03-04", 123, 2000)
        target = self.add_tcx("2026-03-05", 123, 1500)
        self.set_stats({"2026-03-04": 7000}, [old])
        before_stats = self.stats_path.read_bytes()
        journal = self.data_dir / ".pending-update-123.json"
        journal.write_text(
            json.dumps(
                {
                    "result_id": 123,
                    "target": "2026/2026_03_05_123.tcx",
                    "affected_dates": ["2026-03-05"],
                    "target_preexisted": False,
                    "date_adjustments": {"2026-03-05": 0},
                }
            ),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(ValueError, "omits an existing result date"):
            recover_pending_updates(self.data_dir)
        self.assertTrue(old.exists())
        self.assertTrue(target.exists())
        self.assertEqual(self.stats_path.read_bytes(), before_stats)
        self.assertTrue(journal.exists())

    def test_failed_stats_write_rolls_back_manual_update(self):
        old = self.add_tcx("2026-03-04", 123, 2000)
        self.set_stats({"2026-03-04": 7000}, [old])
        before_stats = self.stats_path.read_bytes()
        with patch.object(
            download_single, "refresh_dates", side_effect=OSError("stats failed")
        ):
            with self.assertRaisesRegex(OSError, "stats failed"):
                download_single.update_tcx_file(
                    self.data_dir, {"id": 123, "date": "2026-03-04"}, tcx(2500)
                )
        self.assertEqual(old.read_bytes(), tcx(2000))
        self.assertEqual(self.stats_path.read_bytes(), before_stats)
        self.assertEqual(list(self.data_dir.glob(".pending-update-*")), [])


if __name__ == "__main__":
    unittest.main()
