"""End-to-end Test Runner tests. Spec §6 / 5.5.1.

These run the real aiohttp handler against a real in-memory DB. After
this task, posting a wildcard whose option references @{B_uuid} resolves
B and produces the expanded value, instead of leaking raw @{B} text."""
from __future__ import annotations

import sqlite3

import pytest
from aiohttp import web

from engine.db.migrations import migrate
from engine.db.repositories import ModuleRepository
from wp_api import test_runner as test_runner_mod


@pytest.fixture
def app_with_db(tmp_path):
    """Build an aiohttp app with a freshly-migrated in-memory DB and the
    test_runner endpoint wired up."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    migrate(conn)
    app = web.Application()
    app["wp_db"] = conn
    app.router.add_post("/wp/api/test", test_runner_mod.run_test)
    return app, conn


async def test_nested_wildcard_ref_resolves_via_catalog(aiohttp_client, app_with_db):
    """Library has wildcards 'color' (UUID c0000001) and 'outfit' (UUID
    o0000001) where outfit.options[0].value = "@{c0000001} dress". Test
    Runner must load color into the catalog and resolve the ref so the
    sample is "red dress" or "blue dress", never raw "@{c0000001} dress"."""
    app, conn = app_with_db
    repo = ModuleRepository(conn)
    color = repo.create(
        type="wildcard", name="color", description="",
        category_id=None, tags=[],
        payload={"options": [
            {"value": "red", "weight": 1},
            {"value": "blue", "weight": 1},
        ]},
    )
    outfit_payload = {
        "options": [
            {"value": f"@{{{color['uuid']}}} dress", "weight": 1},
        ],
    }
    repo.create(
        type="wildcard", name="outfit", description="",
        category_id=None, tags=[], payload=outfit_payload,
    )

    client = await aiohttp_client(app)
    resp = await client.post("/wp/api/test", json={
        "type": "wildcard",
        "payload": outfit_payload,
        "instance": {"variable_binding": "outfit"},
        "samples": 5,
    })
    assert resp.status == 200
    body = await resp.json()
    samples = body["data"]["samples"]
    assert len(samples) == 5
    for s in samples:
        assert s in ("red dress", "blue dress"), (
            f"@{{{color['uuid']}}} did not resolve — got raw text {s!r}"
        )


async def test_unknown_ref_emits_warning_does_not_crash(aiohttp_client, app_with_db):
    """A missing target produces a graceful warning + raw token in the
    output (lenient mode) — Test Runner never strict-raises."""
    app, conn = app_with_db
    payload = {
        "options": [{"value": "@{deadbeef} thing", "weight": 1}],
    }
    client = await aiohttp_client(app)
    resp = await client.post("/wp/api/test", json={
        "type": "wildcard",
        "payload": payload,
        "instance": {"variable_binding": "x"},
        "samples": 1,
    })
    assert resp.status == 200
    body = await resp.json()
    warnings = body["data"].get("warnings", [])
    assert any("deadbeef" in str(w) for w in warnings), (
        f"expected 'Unknown wildcard ref' warning for deadbeef, got: {warnings}"
    )
