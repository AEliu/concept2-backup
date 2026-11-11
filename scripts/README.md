# scripts

Deletion webhooks are retained as deterministic ID-only tombstones under
`data/deletions/<result_id>.json`. They do not fetch the deleted result, remove
historical TCX backups, or subtract distance from `data/stats.json`. The
dashboard therefore continues to show historical workouts that were later
deleted from Concept2. Repeated deletion events leave the same marker bytes.

Activity updates retain the difference between each day's stored statistic
and the TCX files already marked processed. This includes manually entered
distance and historical rounding adjustments. The difference is frozen in the
pending update journal so interrupted updates use the same value during
recovery. A legacy journal without this value stops recovery for manual
inspection instead of guessing. If a processed TCX is damaged and its old
statistical contribution cannot be verified, the update also stops before
changing the file or statistics. A damaged TCX not yet marked processed can
still be replaced after its downloaded replacement passes validation.
Recovery verifies the existing statistics and projected totals before removing
an old TCX. If a journal says `stats.json` existed when the update began but
it is missing during recovery, the process stops for manual inspection.
