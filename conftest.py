"""Root conftest — lets pytest import engine/wp_nodes without installing the package.

If ``comfy_api`` is not importable (running outside ComfyUI), inject the
``tests/stubs/comfy_api_stub`` module into ``sys.modules`` as both
``comfy_api`` and ``comfy_api.latest`` so production code that does
``from comfy_api.latest import ComfyExtension, io`` succeeds in tests.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

if importlib.util.find_spec("comfy_api") is None:
    from tests.stubs import comfy_api_stub as _stub

    sys.modules.setdefault("comfy_api", _stub)
    sys.modules.setdefault("comfy_api.latest", _stub)
    sys.modules.setdefault("comfy_api.latest._io", _stub.io._io)

from engine.db.connection import get_connection  # noqa: E402
from engine.db.migrations import migrate  # noqa: E402

collect_ignore: list[str] = []


@pytest.fixture
def wp_db(tmp_path):
    """Fresh, migrated SQLite DB. Yields a sqlite3.Connection."""
    conn = get_connection(tmp_path / "wp.db")
    migrate(conn)
    try:
        yield conn
    finally:
        conn.close()
