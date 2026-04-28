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


async def test_embed_bundle_returns_picks_and_transitive_wildcards(
    aiohttp_client, app_with_db,
):
    """Picking outfit (which @{}-refs color) returns:
      - modules: [outfit_payload]                            (only the picks)
      - snapshots: {outfit_uuid: ..., color_uuid: ...}       (picks + transitive wildcards)
      - pickOrder: [outfit_uuid]
      - walkOverflow: []"""
    app, conn = app_with_db
    repo = ModuleRepository(conn)
    color = repo.create(
        type="wildcard", name="color", description="",
        category_id=None, tags=[], payload={
            "options": [{"value": "red", "weight": 1}],
        },
    )
    outfit_payload = {
        "options": [{"value": f"@{{{color['uuid']}}} dress", "weight": 1}],
    }
    outfit = repo.create(
        type="wildcard", name="outfit", description="",
        category_id=None, tags=[], payload=outfit_payload,
    )

    client = await aiohttp_client(app)
    resp = await client.post("/wp/api/modules/embed-bundle", json={
        "uuids": [outfit["uuid"]],
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["pickOrder"] == [outfit["uuid"]]
    assert len(body["modules"]) == 1
    assert body["modules"][0] == outfit_payload
    assert set(body["snapshots"].keys()) == {outfit["uuid"], color["uuid"]}
    assert body["walkOverflow"] == []


async def test_embed_bundle_records_missing_target_in_walk_overflow(
    aiohttp_client, app_with_db,
):
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
        "uuids": [a["uuid"]],
    })
    assert resp.status == 200
    overflow = (await resp.json())["walkOverflow"]
    assert any(o["uuid"] == "deadbeef" and o["reason"] == "missing_target"
               for o in overflow)


async def test_embed_bundle_rejects_non_list_uuids(aiohttp_client, app_with_db):
    app, _ = app_with_db
    client = await aiohttp_client(app)
    resp = await client.post("/wp/api/modules/embed-bundle", json={
        "uuids": "not-a-list",
    })
    assert resp.status == 400


async def test_hashes_endpoint_returns_uuid_hash_map_for_wildcards_only(
    aiohttp_client, app_with_db,
):
    """Drift-detection primitive. Returns {hashes: {uuid: hash}} keyed
    by 8hex uuid. Wildcards-only because catalog only contains wildcards
    (spec §2.7) — no point shipping hashes for kinds that never drift
    embedded snapshots."""
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
    assert wc["uuid"] in body["hashes"]
    assert cb["uuid"] not in body["hashes"]  # combines excluded
    assert body["hashes"][wc["uuid"]] == wc["payload_hash"]
