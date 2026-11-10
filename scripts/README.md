# scripts

Deletion webhooks are retained as deterministic ID-only tombstones under
`data/deletions/<result_id>.json`. They do not fetch the deleted result, remove
historical TCX backups, or subtract distance from `data/stats.json`. The
dashboard therefore continues to show historical workouts that were later
deleted from Concept2. Repeated deletion events leave the same marker bytes.
