"""Serve the built manager (web/) on a throwaway library for the theme audit.

Runs the real /wp/api routes on a bare aiohttp app, no ComfyUI needed, with a
fresh SQLite file seeded from bench/bench-library.json. Used by
scripts/theme-audit/audit.mjs (and CI's theme-audit job):

    python scripts/theme-audit/serve.py --port 8199
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

_BUCKET_KIND = {
    "categories": "category",
    "wildcards": "wildcard",
    "fixed_values": "fixed_values",
    "combines": "combine",
    "derivations": "derivation",
    "constraints": "constraint",
    "bundles": "bundle",
    "templates": "template",
}


def _seed(db_path: Path) -> None:
    from engine.db.connection import get_connection
    from engine.db.migrations import migrate
    from engine.importer import commit_import

    pack = json.loads((ROOT / "bench" / "bench-library.json").read_text("utf-8"))
    adds = [
        {"kind": kind, "entity": entity}
        for bucket, kind in _BUCKET_KIND.items()
        for entity in pack.get(bucket) or []
    ]
    conn = get_connection(db_path)
    try:
        migrate(conn)
        result = commit_import(conn, {"adds": adds})
        if not result.get("ok"):
            raise SystemExit(f"seed failed: {result.get('error')}")
    finally:
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8199)
    args = ap.parse_args()

    work = Path(tempfile.mkdtemp(prefix="wp-theme-audit-"))
    db_path = work / "library.db"
    # Point every connection (and the backup/user dirs) at the scratch dir
    # before wp_api reads them.
    os.environ["WP_DB_PATH"] = str(db_path)
    os.environ["COMFYUI_USER_DIR"] = str(work)
    _seed(db_path)

    from aiohttp import web

    import wp_api

    app = web.Application()
    wp_api.register_routes(app)
    print(f"theme-audit server on http://127.0.0.1:{args.port}/wp/", flush=True)
    web.run_app(app, host="127.0.0.1", port=args.port, print=None)


if __name__ == "__main__":
    main()
