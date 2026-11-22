import json
import tempfile
import unittest
from pathlib import Path

from export_web_activities import export_activities


def trackpoint(second: int, distance: int) -> str:
    return f"""
    <Trackpoint><Time>2026-11-12T07:00:{second:02}Z</Time>
      <DistanceMeters>{distance}</DistanceMeters><Cadence>24</Cadence>
      <Extensions><TPX xmlns="urn:extensions"><Watts>150</Watts></TPX></Extensions>
    </Trackpoint>"""


def tcx(first_duration: str) -> str:
    return f"""
    <TrainingCenterDatabase xmlns="urn:tcx"><Activities><Activity>
      <Id>2026-11-12T07:00:00Z</Id>
      <Lap StartTime="2026-11-12T07:00:00Z">
        {first_duration}<DistanceMeters>40</DistanceMeters><Intensity>Active</Intensity>
        <Track>{trackpoint(0, 0)}{trackpoint(10, 40)}</Track>
      </Lap>
      <Lap StartTime="2026-11-12T07:00:10Z">
        <TotalTimeSeconds>30</TotalTimeSeconds><DistanceMeters>12</DistanceMeters><Intensity>Resting</Intensity>
        <Track>{trackpoint(10, 0)}{trackpoint(20, 12)}</Track>
      </Lap>
    </Activity></Activities></TrainingCenterDatabase>"""


class WebActivitiesTests(unittest.TestCase):
    def test_summary_and_on_demand_segments_keep_recovery_separate(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            directory = root / "data" / "2026"
            directory.mkdir(parents=True)
            (directory / "2026_11_12_124.tcx").write_text(tcx("<TotalTimeSeconds>10</TotalTimeSeconds>"))
            (directory / "2026_11_12_123.tcx").write_text(tcx(""))
            (directory / "2026_10_12_122.tcx").write_text(tcx(""))
            output = root / "web" / "public" / "activities"

            export_activities(root / "data", output)
            november = json.loads((output / "months/2026-11.json").read_text())
            october = json.loads((output / "months/2026-10.json").read_text())
            self.assertEqual(list(november), ["2026-11-12"])
            self.assertEqual([row["id"] for row in october["2026-10-12"]], ["122"])
            summaries = november["2026-11-12"]
            self.assertEqual([row["id"] for row in summaries], ["124", "123"])
            self.assertEqual(summaries[0]["distance"], 52)
            self.assertEqual(summaries[0]["workDistance"], 40)
            self.assertEqual(summaries[0]["restSeconds"], 30)
            self.assertNotIn("segments", summaries[0])

            first, recovery = json.loads((output / "details/124.json").read_text())["segments"]
            self.assertEqual(first["points"][-1], [10, 125, 24, 150, None])
            self.assertTrue(recovery["resting"])
            self.assertIsNone(recovery["points"][-1][1])
            self.assertIsNone(summaries[1]["duration"])

            (directory / "2026_11_12_123.tcx").unlink()
            (directory / "2026_10_12_122.tcx").unlink()
            export_activities(root / "data", output)
            self.assertFalse((output / "details/123.json").exists())
            self.assertFalse((output / "months/2026-10.json").exists())
