"""Deletion webhooks retain historical files and record an idempotent marker."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import record_deleted


class DeleteEventTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.data_dir = Path(self.temp.name) / "data"
        self.data_dir.mkdir()
        self.tcx = self.data_dir / "2026" / "2026_11_10_123.tcx"
        self.tcx.parent.mkdir()
        self.tcx.write_bytes(b"historical TCX bytes")
        self.stats = self.data_dir / "stats.json"
        self.stats.write_bytes(b'{"daily_distances":{"2026-11-10":1000}}')

    def test_record_and_repeat_preserve_workout_and_stats(self):
        old_tcx = self.tcx.read_bytes()
        old_stats = self.stats.read_bytes()

        marker, created = record_deleted.record_deletion(self.data_dir, 123)
        first_content = marker.read_bytes()
        repeated_marker, repeated_created = record_deleted.record_deletion(
            self.data_dir, 123
        )

        self.assertTrue(created)
        self.assertFalse(repeated_created)
        self.assertEqual(marker, repeated_marker)
        self.assertEqual(marker.read_bytes(), first_content)
        self.assertEqual(
            json.loads(first_content),
            {"event_type": "result-deleted", "result_id": 123},
        )
        self.assertEqual(self.tcx.read_bytes(), old_tcx)
        self.assertEqual(self.stats.read_bytes(), old_stats)
        self.assertEqual(list(self.data_dir.rglob("*.tcx")), [self.tcx])

    def test_rejects_invalid_ids_without_touching_data(self):
        for result_id in (0, -1, True, "123", 1.5, 2**53):
            with self.subTest(result_id=result_id):
                with self.assertRaises(ValueError):
                    record_deleted.record_deletion(self.data_dir, result_id)
        self.assertFalse((self.data_dir / "deletions").exists())
        self.assertTrue(self.tcx.exists())
        self.assertTrue(self.stats.exists())

    def test_conflicting_marker_fails_without_overwrite(self):
        marker = self.data_dir / "deletions" / "123.json"
        marker.parent.mkdir()
        marker.write_bytes(b"corrupted marker")

        with self.assertRaisesRegex(ValueError, "does not match"):
            record_deleted.record_deletion(self.data_dir, 123)

        self.assertEqual(marker.read_bytes(), b"corrupted marker")
        self.assertTrue(self.tcx.exists())
        self.assertTrue(self.stats.exists())

    def test_marker_write_failure_leaves_no_partial_marker(self):
        with patch.object(record_deleted, "write_atomically", side_effect=OSError):
            with self.assertRaises(OSError):
                record_deleted.record_deletion(self.data_dir, 123)
        self.assertFalse((self.data_dir / "deletions" / "123.json").exists())
        self.assertTrue(self.tcx.exists())
        self.assertTrue(self.stats.exists())

    def test_cli_rejects_non_numeric_input(self):
        for invalid in ("0", "-1", "123; echo injected", "$(echo injected)"):
            with self.subTest(invalid=invalid):
                self.assertEqual(record_deleted.main([invalid]), 1)


if __name__ == "__main__":
    unittest.main()
