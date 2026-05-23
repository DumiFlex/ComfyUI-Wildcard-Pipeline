"""Tests for /wp/api/export/build — Task 10 / importer-exporter v2.

Endpoint wraps `engine.exporter.build_export_payload` and returns the
full 7-bucket payload directly. UUID sets are partitioned by bucket;
mis-typed UUIDs are silently dropped by the exporter (cross-bucket
isolation guarantee).
"""
import pytest

pytestmark = pytest.mark.asyncio


async def _create_wildcard(wp_client, name: str = "colors") -> dict:
    resp = await wp_client.post("/wp/api/modules", json={
        "type": "wildcard", "name": name, "description": "",
        "category_id": None, "tags": [], "payload": {"options": []},
    })
    assert resp.status == 201
    return await resp.json()


async def _create_bundle(wp_client, *, name: str, children=None) -> dict:
    resp = await wp_client.post("/wp/api/bundles", json={
        "name": name,
        "children": children or [],
    })
    assert resp.status == 201
    return await resp.json()


# ── Happy path ────────────────────────────────────────────────────────────


async def test_build_returns_seven_bucket_payload_with_wildcard(wp_client):
    wc = await _create_wildcard(wp_client)
    resp = await wp_client.post("/wp/api/export/build", json={
        "wildcard_uuids": [wc["id"]],
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["schema_version"] == 1
    assert isinstance(body["exported_at"], str)
    assert body["exported_at"] != ""
    # All 7 buckets present.
    for key in (
        "bundles", "wildcards", "fixed_values", "combines",
        "derivations", "constraints", "categories",
    ):
        assert key in body, f"missing bucket: {key}"
    # Wildcard appears in wildcards bucket with non-empty fingerprint.
    assert len(body["wildcards"]) == 1
    assert body["wildcards"][0]["id"] == wc["id"]
    assert body["wildcards"][0].get("snapshot_fingerprint")


async def test_build_with_empty_body_returns_empty_buckets(wp_client):
    resp = await wp_client.post("/wp/api/export/build", json={})
    assert resp.status == 200
    body = await resp.json()
    assert body["schema_version"] == 1
    for key in (
        "bundles", "wildcards", "fixed_values", "combines",
        "derivations", "constraints", "categories",
    ):
        assert body[key] == [], f"expected empty bucket: {key}"


async def test_build_transitive_bundle_walk(wp_client):
    """Bundle A references bundle B via children[type==bundle]; passing
    A's id should pull B in too."""
    b = await _create_bundle(wp_client, name="inner")
    a = await _create_bundle(
        wp_client, name="outer",
        children=[{"id": b["id"], "type": "bundle", "name": "inner"}],
    )
    resp = await wp_client.post("/wp/api/export/build", json={
        "bundle_uuids": [a["id"]],
    })
    assert resp.status == 200
    body = await resp.json()
    ids = {row["id"] for row in body["bundles"]}
    assert ids == {a["id"], b["id"]}


# ── Validation ────────────────────────────────────────────────────────────


async def test_build_invalid_json_returns_400(wp_client):
    resp = await wp_client.post(
        "/wp/api/export/build",
        data="not json",
        headers={"content-type": "application/json"},
    )
    assert resp.status == 400


async def test_build_non_object_body_returns_400(wp_client):
    resp = await wp_client.post("/wp/api/export/build", json=["x"])
    assert resp.status == 400


async def test_build_non_array_uuid_list_returns_400(wp_client):
    resp = await wp_client.post("/wp/api/export/build", json={
        "bundle_uuids": "not a list",
    })
    assert resp.status == 400


# ── Cross-bucket isolation (inherited from exporter) ──────────────────────


async def test_build_wrong_type_uuid_silently_filtered(wp_client):
    """Passing a wildcard's id under combine_uuids should yield empty
    combines AND empty wildcards — the exporter filters cross-bucket misses."""
    wc = await _create_wildcard(wp_client)
    resp = await wp_client.post("/wp/api/export/build", json={
        "combine_uuids": [wc["id"]],
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["combines"] == []
    assert body["wildcards"] == []


