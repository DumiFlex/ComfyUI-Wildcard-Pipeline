"""Pin the no-DB-fallback rule on get_module(uuid). Spec §2.5 / §2.10.

If a future contributor adds `from engine.db import ...` here for an
'ergonomic' DB fallback, this test trips and forces the discussion."""
from __future__ import annotations

import importlib
import sys


def test_engine_modules_init_does_not_import_db():
    if "engine.modules" in sys.modules:
        del sys.modules["engine.modules"]
    importlib.import_module("engine.modules")
    mod = sys.modules["engine.modules"]
    forbidden = ("engine.db", "wp_api", "wp_nodes", "comfy_api")
    for name in dir(mod):
        attr = getattr(mod, name)
        attr_module = getattr(attr, "__module__", "")
        for prefix in forbidden:
            assert not attr_module.startswith(prefix), (
                f"engine.modules.__init__ leaks {prefix} via attribute "
                f"{name!r} (came from {attr_module})"
            )


def test_get_module_returns_none_for_missing_uuid_without_db_call():
    """get_module is a pure dict lookup. Never queries DB even when miss."""
    from engine.modules import build_resolve_ctx
    ctx_dict = {
        "__wp_rng__": __import__("random").Random(0),
        "__wp_warnings__": [],
        "__wp_catalog__": {"aabbccdd": {"uuid": "aabbccdd"}},
    }
    ctx = build_resolve_ctx(ctx_dict, surface="wildcard")
    assert ctx.get_module("aabbccdd") == {"uuid": "aabbccdd"}
    assert ctx.get_module("nonexist") is None
