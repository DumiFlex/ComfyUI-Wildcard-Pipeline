"""Whole-library handlers run in a worker thread, so ComfyUI's event loop
keeps answering while they work (aiohttp runs every handler on that loop).

Each case slows the handler's heavy step down with a blocking sleep and
counts how often a 10 ms ticker on the loop got to run meanwhile."""
from __future__ import annotations

import asyncio
import threading
import time

import pytest

SLOW = 0.5


def _slow(real, seen: list[str]):
    def wrapped(*args, **kwargs):
        seen.append(threading.current_thread().name)
        time.sleep(SLOW)
        return real(*args, **kwargs)
    return wrapped


async def _ticks_during(coro) -> tuple[int, object]:
    ticks = 0

    async def ticker():
        nonlocal ticks
        while True:
            await asyncio.sleep(0.01)
            ticks += 1

    task = asyncio.ensure_future(ticker())
    try:
        result = await coro
    finally:
        task.cancel()
    return ticks, result


def _patch(monkeypatch, target: str, seen: list[str]) -> None:
    import pkgutil

    owner_name, attr = target.rsplit(".", 1)
    owner = pkgutil.resolve_name(owner_name)
    monkeypatch.setattr(owner, attr, _slow(getattr(owner, attr), seen))


CASES = [
    ("wp_api.import_export.build_export_payload", "POST", "/wp/api/export/build", {}),
    ("wp_api.import_export.commit_import", "POST", "/wp/api/import/commit", {"adds": []}),
    ("engine.health.scan_library", "POST", "/wp/api/health/scan", {}),
    ("wp_api.database.integrity_check", "POST", "/wp/api/database/maintenance",
     {"op": "integrity"}),
    ("engine.db.repositories.ModuleRepository.list", "GET", "/wp/api/modules", None),
    ("engine.db.repositories.BundleRepository.list", "GET", "/wp/api/bundles", None),
    ("engine.db.repositories.ModuleRepository.list_hash_rows", "GET",
     "/wp/api/modules/hashes", None),
    ("wp_api.preview.PipelineEngine.run", "POST", "/wp/api/preview/resolve",
     {"chain": [[{"id": "abcdef00", "type": "fixed_values", "enabled": True, "entries": [],
                  "payload": {"values": [{"id": "v", "name": "a", "value": "b"}]}}]]}),
]


@pytest.mark.parametrize("target,method,path,body", CASES, ids=[c[2] for c in CASES])
async def test_heavy_handlers_leave_the_loop_free(wp_client, monkeypatch, target, method,
                                                  path, body):
    if target == "wp_api.database.integrity_check":
        from wp_api import database
        seen: list[str] = []
        monkeypatch.setitem(database._OPS, "integrity",
                            _slow(database._OPS["integrity"], seen))
    else:
        seen = []
        _patch(monkeypatch, target, seen)
    kwargs = {"json": body} if body is not None else {}
    ticks, resp = await _ticks_during(wp_client.request(method, path, **kwargs))
    assert resp.status == 200, await resp.text()
    assert seen, "the slowed step never ran"
    assert threading.main_thread().name not in seen
    # A blocked loop ticks about zero times during the half-second step.
    assert ticks >= 10
