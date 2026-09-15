"""One-off sample data script: assign demo tree ids to existing farmer observations.

Purpose
-------
The farm-map (/farm-map) visualises tree-id observations.  Before any real
tree ids are recorded the map is empty, so this script backfills *sample*
tree ids onto every observation that already belongs to a farmer account
(role='farmer') and currently has no tree id.

The values are clearly demo ids (A-01, A-02, ...) and are only used so the
map can be previewed.  When real analysis is run with a tree id, that real id
overwrites the sample value.  Run again after adding more observations to
catch up, or delete the records via the admin page / tracking page.

Usage
-----
    python tools/assign_sample_tree_ids.py

Idempotent: only touches rows where tree_id IS NULL.
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / "data" / "olive_msystem.db"

# Observations per sample tree (how many records share one demo tree id).
CHUNK_SIZE = 10


def main() -> int:
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    try:
        farmers = con.execute(
            "SELECT id FROM users WHERE role = 'farmer' ORDER BY id"
        ).fetchall()
        updated = 0
        for f in farmers:
            rows = con.execute(
                "SELECT id FROM observations WHERE user_id = ? "
                "AND (tree_id IS NULL OR tree_id = '') "
                "ORDER BY observed_at ASC, id ASC",
                (f["id"],),
            ).fetchall()
            for i, r in enumerate(rows):
                tree_id = "A-%02d" % (i // CHUNK_SIZE + 1)
                con.execute(
                    "UPDATE observations SET tree_id = ? WHERE id = ?",
                    (tree_id, r["id"]),
                )
                updated += 1
        con.commit()
        print(f"assigned sample tree ids to {updated} observations")
        return 0
    finally:
        con.close()


if __name__ == "__main__":
    sys.exit(main())