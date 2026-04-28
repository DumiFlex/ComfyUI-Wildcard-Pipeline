"""Walker + SnapshotEntry tests. Mirrors spec §2.4–2.10 + §6 (5.5.0).

The walker is the single shared lazy-walk implementation used by:
- wp_api/test_runner.py:run_test (request-scoped roots)
- wp_api/modules.py:embed_bundle (user pick roots)
NEVER called from wp_nodes/context_node.py — graph runs use pre-walked
snapshots embedded in workflow JSON."""
from __future__ import annotations

import importlib
import sys


def test_snapshot_entry_canonical_shape():
    """SnapshotEntry has the 7 fields locked in spec §2.4. Other code
    grep-asserts these names; never rename without updating callers."""
    from engine.modules.snapshot import SnapshotEntry
    # SnapshotEntry is a TypedDict — read its annotations
    annotations = SnapshotEntry.__annotations__
    assert set(annotations.keys()) == {
        "snapshot_version", "uuid", "type", "name",
        "payload", "payload_hash", "source",
    }


def test_engine_modules_snapshot_does_not_import_db_or_wp_api():
    """Engine isolation: snapshot.py must be importable with no DB layer
    in sys.modules. CLAUDE.md isolation rule — engine/ never knows about
    wp_api/ or wp_nodes/. Any future contributor adding `from engine.db
    import ...` here breaks the runtime separation."""
    # Force fresh import to capture import-time side effects
    if "engine.modules.snapshot" in sys.modules:
        del sys.modules["engine.modules.snapshot"]
    importlib.import_module("engine.modules.snapshot")
    mod = sys.modules["engine.modules.snapshot"]
    forbidden_prefixes = ("engine.db", "wp_api", "wp_nodes", "comfy_api")
    for name in dir(mod):
        attr = getattr(mod, name)
        attr_module = getattr(attr, "__module__", "")
        for prefix in forbidden_prefixes:
            assert not attr_module.startswith(prefix), (
                f"engine.modules.snapshot leaks {prefix} via attribute "
                f"{name!r} (came from {attr_module})"
            )
