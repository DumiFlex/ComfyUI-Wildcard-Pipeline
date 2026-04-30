"""Endpoint tests for embed-bundle + hashes + ModuleRow shape extension.
Spec §4.2."""
from __future__ import annotations

import sqlite3

import pytest
from aiohttp import web

from engine.db.migrations import migrate
from engine.db.repositories import ModuleRepository
from wp_api import modules as modules_api


@pytest.fixture
def app_with_db(tmp_path):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    migrate(conn)
    app = web.Application()
    app["wp_db"] = conn
    modules_api.register(app.router)
    return app, conn


async def test_embed_bundle_returns_picks_only_no_transitive_walk(
    aiohttp_client, app_with_db,
):
    """Picking outfit (which `@{}`-refs color) returns ONLY outfit's
    snapshot — no transitive walk. The user explicitly asked the
    picker to embed only what they picked; nested wildcards are
    looked up live at graph-run time inside `WP_Context.execute`.
    Workflow JSON stops being self-contained, but the picker stops
    pulling in surprise modules.
    """
    app, conn = app_with_db
    repo = ModuleRepository(conn)
    color = repo.create(
        type="wildcard", name="color", description="",
        category_id=None, tags=[], payload={
            "options": [{"value": "red", "weight": 1}],
        },
    )
    outfit_payload = {
        "options": [{"value": f"@{{{color['id']}}} dress", "weight": 1}],
    }
    outfit = repo.create(
        type="wildcard", name="outfit", description="",
        category_id=None, tags=[], payload=outfit_payload,
    )

    client = await aiohttp_client(app)
    resp = await client.post("/wp/api/modules/embed-bundle", json={
        "uuids": [outfit["id"]],
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["pickOrder"] == [outfit["id"]]
    assert len(body["modules"]) == 1
    assert body["modules"][0] == outfit_payload
    # color is referenced by outfit but NOT embedded — runtime resolves
    # it live from the library.
    assert set(body["snapshots"].keys()) == {outfit["id"]}
    assert color["id"] not in body["snapshots"]
    assert body["walkOverflow"] == []


async def test_embed_bundle_walk_overflow_always_empty(
    aiohttp_client, app_with_db,
):
    """Missing-target overflow used to surface here when the walker
    couldn't resolve a `@{deadbeef}` ref. With the walker gone the
    field is always `[]` — graph-side runtime is now responsible for
    surfacing unresolved refs as resolver warnings."""
    app, conn = app_with_db
    repo = ModuleRepository(conn)
    a = repo.create(
        type="wildcard", name="a", description="",
        category_id=None, tags=[], payload={
            "options": [{"value": "@{deadbeef}", "weight": 1}],
        },
    )
    client = await aiohttp_client(app)
    resp = await client.post("/wp/api/modules/embed-bundle", json={
        "uuids": [a["id"]],
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["walkOverflow"] == []
    # The pick itself is still returned.
    assert a["id"] in body["snapshots"]


async def test_embed_bundle_rejects_non_list_uuids(aiohttp_client, app_with_db):
    app, _ = app_with_db
    client = await aiohttp_client(app)
    resp = await client.post("/wp/api/modules/embed-bundle", json={
        "uuids": "not-a-list",
    })
    assert resp.status == 400


async def test_hashes_endpoint_returns_id_hash_map_for_every_kind(
    aiohttp_client, app_with_db,
):
    """Drift-detection primitive. Returns `{hashes: {id: hash}}` keyed
    by the 8-hex module id for EVERY kind in the library. Pre-5.5.6
    the endpoint hard-coded `type="wildcard"`, but the in-graph
    WP_Context now embeds non-wildcard kinds too — without their
    hashes the missing-dot predicate flagged every freshly-picked
    combine / derivation / constraint / fixed_values as missing."""
    app, conn = app_with_db
    repo = ModuleRepository(conn)
    wc = repo.create(
        type="wildcard", name="x", description="",
        category_id=None, tags=[], payload={"options": []},
    )
    cb = repo.create(
        type="combine", name="y", description="",
        category_id=None, tags=[], payload={"template": "$a"},
    )
    client = await aiohttp_client(app)
    resp = await client.get("/wp/api/modules/hashes")
    assert resp.status == 200
    body = await resp.json()
    assert wc["id"] in body["hashes"]
    assert cb["id"] in body["hashes"]  # every kind included
    assert body["hashes"][wc["id"]] == wc["payload_hash"]
    assert body["hashes"][cb["id"]] == cb["payload_hash"]


# ── ModuleRow shape (spec §4.2) ──────────────────────────────────────
# Post-004 the API row no longer carries a separate `uuid` field — the
# `id` IS the canonical 8-hex uuid. `payload_hash` stays.


async def test_list_modules_response_includes_id_and_payload_hash(
    aiohttp_client, app_with_db,
):
    app, conn = app_with_db
    repo = ModuleRepository(conn)
    repo.create(
        type="wildcard", name="x", description="",
        category_id=None, tags=[], payload={"options": []},
    )
    client = await aiohttp_client(app)
    resp = await client.get("/wp/api/modules")
    assert resp.status == 200
    items = (await resp.json())["items"]
    assert len(items) == 1
    assert "id" in items[0]
    assert "uuid" not in items[0]
    assert "payload_hash" in items[0]
    assert len(items[0]["id"]) == 8
    assert len(items[0]["payload_hash"]) == 64


async def test_get_module_response_includes_id_and_payload_hash(
    aiohttp_client, app_with_db,
):
    app, conn = app_with_db
    repo = ModuleRepository(conn)
    row = repo.create(
        type="wildcard", name="x", description="",
        category_id=None, tags=[], payload={"options": []},
    )
    client = await aiohttp_client(app)
    resp = await client.get(f"/wp/api/modules/{row['id']}")
    assert resp.status == 200
    data = await resp.json()
    assert data["id"] == row["id"]
    assert "uuid" not in data
    assert data["payload_hash"] == row["payload_hash"]
