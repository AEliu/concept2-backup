import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests

from export_web_activities import export_activities
from simple_auth import AUTH_TIMEOUT_SECONDS, RESULTS_URL, create_simple_api_client
from sync_web_official_data import sync_official_data
from test_web_activities import tcx
from web_official_data import normalize_official


def workout(**updates):
    return {
        "id": 123,
        "type": "rower",
        "time": 100,
        "comments": "unpublished comment",
        "workout": {"splits": [{"distance": 40, "time": 100}]},
        "strokes": {"data": [{"t": 10, "p": 1200}, {"t": 80, "p": 1190}]},
        **updates,
    }


class OfficialActivityTests(unittest.TestCase):
    def test_keeps_only_splits_and_pace_and_handles_bike_units(self):
        detail = normalize_official(workout(type="bike"))
        self.assertEqual(set(detail), {"segments", "pace", "paceMeters"})
        self.assertEqual(detail["paceMeters"], 1000)
        self.assertEqual(detail["segments"], [{"distance": 40, "seconds": 10, "resting": False}])
        self.assertEqual(detail["pace"]["segments"][0]["points"], [[1, 120], [8, 119]])

    def test_interval_time_resets_and_trailing_recovery(self):
        result = workout(
            workout={"intervals": [
                {"distance": 250, "time": 600, "rest_time": 300},
                {"distance": 260, "time": 550, "rest_time": 400, "rest_distance": 50},
            ]},
            strokes={"data": [
                {"t": 0, "p": 0}, {"t": 119, "p": 1200}, {"t": 450, "p": 1160},
                {"t": 0}, {"t": 200, "p": 1250}, {"t": 470, "p": 1150},
            ]},
        )
        detail = normalize_official(result)
        self.assertEqual(detail["segments"][1], {"distance": None, "seconds": 30, "resting": True})
        self.assertEqual(detail["segments"][3], {"distance": 50, "seconds": 40, "resting": True})
        self.assertEqual(detail["pace"]["duration"], 185)
        self.assertEqual(detail["pace"]["segments"][2]["points"], [[110, 125], [137, 115]])
        self.assertEqual(detail["pace"]["segments"][3]["start"], 145)

        result["strokes"]["data"] = [{"t": 119, "p": 1200}, {"t": 450, "p": 1160}]
        self.assertNotIn("pace", normalize_official(result))

    def test_splits_and_pace_can_fall_back_independently(self):
        self.assertNotIn("segments", normalize_official(workout(workout={"splits": [{"time": 100}]})))
        self.assertIn("pace", normalize_official(workout(workout=None)))
        split_only = normalize_official(workout(strokes={"data": [{"t": 0, "p": 0}, {"t": 80}]}))
        self.assertIn("segments", split_only)
        self.assertNotIn("pace", split_only)
        self.assertNotIn("pace", normalize_official(workout(type="multierg")))

    def test_fetches_embedded_strokes_and_treats_403_or_404_as_missing(self):
        api = create_simple_api_client("synthetic-token")
        response = Mock(status_code=200)
        response.json.return_value = {"data": workout()}
        with patch("simple_auth.requests.get", return_value=response) as get:
            self.assertIn("strokes", api.get_result_with_strokes(123))
            self.assertEqual(get.call_args.args, (f"{RESULTS_URL}/123",))
            self.assertEqual(get.call_args.kwargs["params"], {"include": "strokes"})
            self.assertEqual(get.call_args.kwargs["timeout"], AUTH_TIMEOUT_SECONDS)
            response.json.return_value = {"data": workout(id=124)}
            with self.assertRaises(ValueError):
                api.get_result_with_strokes(123)
            for status in (403, 404):
                response.status_code = status
                self.assertIsNone(api.get_result_with_strokes(123))

    def test_build_uses_cached_data_and_falls_back_for_stale_or_deleted_results(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data = root / "data"
            year = data / "2026"
            year.mkdir(parents=True)
            first = year / "2026_11_12_123.tcx"
            first.write_text(tcx("<TotalTimeSeconds>10</TotalTimeSeconds>"), encoding="utf-8")
            second = year / "2026_11_11_122.tcx"
            second.write_bytes(first.read_bytes())
            cache = root / "official.json"
            output = root / "web" / "public" / "activities"
            fetch = Mock(side_effect=lambda result_id: workout() if result_id == 123 else None)

            self.assertTrue(sync_official_data(data, cache, fetch, limit=1))
            fetch.assert_called_once_with(123)
            self.assertTrue(sync_official_data(data, cache, fetch))
            self.assertFalse(sync_official_data(data, cache, fetch))
            self.assertEqual([call.args[0] for call in fetch.call_args_list], [123, 122])
            export_activities(data, output, cache)

            detail_path = output / "details" / "123.json"
            original = json.loads(detail_path.read_bytes())
            self.assertEqual(original["official"]["pace"]["segments"][0]["points"][0], [1, 120])
            self.assertNotIn("official", json.loads((output / "details" / "122.json").read_bytes()))
            self.assertNotIn("official", json.loads((output / "months" / "2026-11.json").read_bytes())["2026-11-12"][0])

            first.write_bytes(first.read_bytes() + b"\n")
            export_activities(data, output, cache)
            fallback = dict(original)
            fallback.pop("official")
            self.assertEqual(json.loads(detail_path.read_bytes()), fallback)

            self.assertTrue(sync_official_data(data, cache, fetch))
            export_activities(data, output, cache)
            self.assertEqual(json.loads(detail_path.read_bytes()), original)
            deletions = data / "deletions"
            deletions.mkdir()
            (deletions / "123.json").write_text("{}", encoding="utf-8")
            export_activities(data, output, cache)
            self.assertEqual(json.loads(detail_path.read_bytes()), fallback)

    def test_refresh_invalidation_survives_temporary_outage(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data = root / "data"
            year = data / "2026"
            year.mkdir(parents=True)
            (year / "2026_11_12_123.tcx").write_bytes(b"TCX content")
            cache = root / "official.json"
            sync_official_data(data, cache, Mock(return_value=workout()))
            failed = Mock(side_effect=requests.Timeout("temporary outage"))
            self.assertTrue(sync_official_data(data, cache, failed, refresh_id="123"))
            failed.assert_called_once_with(123)
            self.assertEqual(json.loads(cache.read_bytes()), {})
            recovered = Mock(return_value=workout())
            self.assertTrue(sync_official_data(data, cache, recovered))
            recovered.assert_called_once_with(123)

    def test_bad_response_does_not_block_earlier_workouts(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            data = root / "data"
            year = data / "2026"
            year.mkdir(parents=True)
            for result_id in (123, 124):
                (year / f"2026_11_12_{result_id}.tcx").write_bytes(b"TCX content")
            cache = root / "official.json"
            fetch = Mock(side_effect=[ValueError("invalid result"), workout()])
            self.assertTrue(sync_official_data(data, cache, fetch))
            self.assertEqual([call.args[0] for call in fetch.call_args_list], [124, 123])
            self.assertEqual(set(json.loads(cache.read_bytes())), {"123"})
