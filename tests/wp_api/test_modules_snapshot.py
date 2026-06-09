"""Tests for /wp/api/modules/{id}/snapshot + duplicate + favorite."""
import pytest

pytestmark = pytest.mark.asyncio


async def _create(client, **overrides):
    body = {
        "type": "wildcard", "name": "colors", "description": "",
        "category_id": None, "tags": [], "payload": {"options": []},
    }
    body.update(overrides)
    resp = await client.post("/wp/api/modules", json=body)
    return await resp.json()


async def test_snapshot_returns_frozen_shape(wp_client):
    created = await _create(wp_client)
    resp = await wp_client.post(f"/wp/api/modules/{created['id']}/snapshot")
    assert resp.status == 200
    snap = await resp.json()
    assert snap["library_id"] == created["id"]
    assert snap["library_version_at_snapshot"] == 1
    assert snap["library_snapshot_at"]
    assert snap["library_snapshot_at"].endswith("Z")
    assert snap["type"] == "wildcard"
    assert snap["payload"] == {"options": []}
    assert snap["instance"] == {
        "variable_binding": None, "enabled_options": None, "category_filter": None,
        "option_weights": None,
        # SP2a multi-select + null toggle — part of the snapshot baseline.
        "exclude_null": None, "pick_min": None, "pick_max": None, "pick_separator": None,
        "pick_independent": None,
        "mode": None, "pinned_option_id": None,
        "locked_seed": None, "internal": None,
        "disabled_rule_ids": None, "disabled_exception_keys": None,
        "disabled_matrix_cells": None,
    }


async def test_snapshot_missing_module_404(wp_client):
    resp = await wp_client.post("/wp/api/modules/ghost/snapshot")
    assert resp.status == 404


async def test_duplicate_creates_copy_with_suffix(wp_client):
    created = await _create(wp_client, name="palette")
    resp = await wp_client.post(f"/wp/api/modules/{created['id']}/duplicate")
    assert resp.status == 201
    body = await resp.json()
    assert body["id"] != created["id"]
    assert body["name"] == "palette (copy)"
    assert body["payload"] == created["payload"]
    assert body["is_favorite"] is False


async def test_duplicate_missing_404(wp_client):
    resp = await wp_client.post("/wp/api/modules/ghost/duplicate")
    assert resp.status == 404


async def test_favorite_toggles(wp_client):
    created = await _create(wp_client)
    on = await wp_client.post(f"/wp/api/modules/{created['id']}/favorite")
    assert (await on.json())["is_favorite"] is True
    off = await wp_client.post(f"/wp/api/modules/{created['id']}/favorite")
    assert (await off.json())["is_favorite"] is False


async def test_favorite_missing_404(wp_client):
    resp = await wp_client.post("/wp/api/modules/ghost/favorite")
    assert resp.status == 404
