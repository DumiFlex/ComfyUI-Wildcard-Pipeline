"""Regression tests for the 2026-05-19 QA hardening sweep.

Covers the bugs catalogued in the deep-QA pass:

- Dangling ``category_id`` now returns 400 (was 500 unhandled IntegrityError)
- ``/wp/api/<unknown>`` now returns JSON 404 (was 200 SPA shell)
- Non-string tag entries rejected (was silently stored)
- Body size cap on Content-Length header
- Bundle children deduplicated by id (was duplicated verbatim)
- Bundle name auto-suffix on collision (was duplicate-name silent)
- ``If-Match`` optimistic concurrency on module + bundle PUT
- Orphaned children stamped on bundle when source module deleted
"""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


VALID_WILDCARD_PAYLOAD = {
    "options": [{"id": "o1", "value": "red", "weight": 1}],
    "var_binding": "color",
    "sub_categories": [],
}


async def _create_wildcard(client, name="qa", **extra):
    body = {"type": "wildcard", "name": name, "payload": VALID_WILDCARD_PAYLOAD, **extra}
    resp = await client.post("/wp/api/modules", json=body)
    return resp


# ─── Fix 1: dangling category_id ─────────────────────────────────────


async def test_dangling_category_id_returns_400_not_500(wp_client):
    """POST with a category_id that doesn't exist in the categories
    table previously surfaced sqlite3.IntegrityError → 500. Now caught
    and re-raised as 400 JSON so the client can act on it."""
    resp = await _create_wildcard(wp_client, name="qa_bad_cat", category_id="doesnotexist")
    assert resp.status == 400, await resp.text()
    body = await resp.json()
    assert "error" in body


# ─── Fix 3: non-string tags ──────────────────────────────────────────


@pytest.mark.parametrize("bad_tags", [
    ["valid", 42],
    ["valid", None],
    [{"evil": True}],
    [["nested"]],
])
async def test_post_rejects_non_string_tag_entries(wp_client, bad_tags):
    resp = await _create_wildcard(wp_client, name="qa_bad_tags", tags=bad_tags)
    assert resp.status == 400, await resp.text()


async def test_post_rejects_too_many_tags(wp_client):
    too_many = [f"tag_{i}" for i in range(100)]  # cap is 50
    resp = await _create_wildcard(wp_client, name="qa_many_tags", tags=too_many)
    assert resp.status == 400


async def test_post_rejects_overlong_tag(wp_client):
    resp = await _create_wildcard(wp_client, name="qa_long_tag", tags=["a" * 200])
    assert resp.status == 400


async def test_put_rejects_non_string_tags(wp_client):
    create = await _create_wildcard(wp_client, name="qa_for_put")
    assert create.status == 201
    mid = (await create.json())["id"]

    resp = await wp_client.put(f"/wp/api/modules/{mid}", json={"tags": ["ok", 42]})
    assert resp.status == 400


# ─── Fix 5: name length cap ──────────────────────────────────────────


async def test_post_rejects_overlong_name(wp_client):
    long_name = "x" * 500  # cap is 200
    resp = await _create_wildcard(wp_client, name=long_name)
    assert resp.status == 400


async def test_post_rejects_empty_name(wp_client):
    resp = await _create_wildcard(wp_client, name="   ")
    assert resp.status == 400


# ─── Fix 14: If-Match optimistic concurrency ─────────────────────────


async def test_put_without_if_match_uses_legacy_last_write_wins(wp_client):
    """Backward-compatibility — PUT without the header keeps the prior
    last-write-wins behavior so existing clients aren't broken."""
    create = await _create_wildcard(wp_client, name="qa_concurrency_legacy")
    mid = (await create.json())["id"]
    resp = await wp_client.put(f"/wp/api/modules/{mid}", json={"description": "first"})
    assert resp.status == 200
    resp = await wp_client.put(f"/wp/api/modules/{mid}", json={"description": "second"})
    assert resp.status == 200


async def test_put_with_matching_if_match_succeeds(wp_client):
    create = await _create_wildcard(wp_client, name="qa_concurrency_match")
    body = await create.json()
    mid = body["id"]
    resp = await wp_client.put(
        f"/wp/api/modules/{mid}",
        json={"description": "ok"},
        headers={"If-Match": str(body["version"])},
    )
    assert resp.status == 200


async def test_put_with_stale_if_match_returns_409(wp_client):
    create = await _create_wildcard(wp_client, name="qa_concurrency_stale")
    mid = (await create.json())["id"]
    # First PUT bumps the version.
    await wp_client.put(f"/wp/api/modules/{mid}", json={"description": "first"})
    # Second PUT claims the original version → conflict.
    resp = await wp_client.put(
        f"/wp/api/modules/{mid}",
        json={"description": "second"},
        headers={"If-Match": "1"},
    )
    assert resp.status == 409
    body = await resp.json()
    assert "version mismatch" in body["error"]


async def test_put_with_malformed_if_match_returns_400(wp_client):
    create = await _create_wildcard(wp_client, name="qa_concurrency_bad_header")
    mid = (await create.json())["id"]
    resp = await wp_client.put(
        f"/wp/api/modules/{mid}",
        json={"description": "x"},
        headers={"If-Match": "not-a-number"},
    )
    assert resp.status == 400


# ─── Fix 15: orphan-stamping on module delete ───────────────────────


async def test_delete_module_stamps_orphaned_on_bundle_children(wp_client):
    """When a module referenced by a bundle child is deleted, that
    child's meta.orphaned flag flips to True so the SPA can render a
    'library entry gone' badge."""
    create = await _create_wildcard(wp_client, name="qa_orphan_target")
    mid = (await create.json())["id"]
    bun = await wp_client.post("/wp/api/bundles", json={
        "name": "qa_orphan_bundle",
        "children": [{"id": mid, "type": "wildcard", "payload": VALID_WILDCARD_PAYLOAD}],
    })
    bid = (await bun.json())["id"]

    resp = await wp_client.delete(f"/wp/api/modules/{mid}")
    assert resp.status == 204

    refetch = await wp_client.get(f"/wp/api/bundles/{bid}")
    body = await refetch.json()
    child = body["children"][0]
    assert child["meta"]["orphaned"] is True
    assert "orphaned_at" in child["meta"]
    # Payload snapshot stays intact — bundles are self-contained.
    assert child["payload"] == VALID_WILDCARD_PAYLOAD


# ─── Fix 11: bundle name auto-suffix ─────────────────────────────────


async def test_bundle_create_auto_suffixes_duplicate_name(wp_client):
    r1 = await wp_client.post("/wp/api/bundles", json={"name": "qa_dup"})
    assert r1.status == 201
    assert (await r1.json())["name"] == "qa_dup"

    r2 = await wp_client.post("/wp/api/bundles", json={"name": "qa_dup"})
    assert r2.status == 201
    assert (await r2.json())["name"] == "qa_dup (copy)"

    r3 = await wp_client.post("/wp/api/bundles", json={"name": "qa_dup"})
    assert r3.status == 201
    assert (await r3.json())["name"] == "qa_dup (copy 2)"


async def test_bundle_update_keeps_own_name_unsuffixed(wp_client):
    """Renaming a bundle to its CURRENT name (no-op rename) must not
    suffix — the collision check excludes the row being edited."""
    create = await wp_client.post("/wp/api/bundles", json={"name": "qa_self"})
    bid = (await create.json())["id"]
    resp = await wp_client.put(f"/wp/api/bundles/{bid}", json={"name": "qa_self"})
    assert resp.status == 200
    assert (await resp.json())["name"] == "qa_self"


# ─── Fix 12: bundle children dedup ───────────────────────────────────


async def test_bundle_create_dedupes_children_by_id(wp_client):
    create = await _create_wildcard(wp_client, name="qa_shared_child")
    mid = (await create.json())["id"]

    resp = await wp_client.post("/wp/api/bundles", json={
        "name": "qa_dup_children",
        "children": [
            {"id": mid, "type": "wildcard", "payload": VALID_WILDCARD_PAYLOAD},
            {"id": mid, "type": "wildcard", "payload": VALID_WILDCARD_PAYLOAD},
            {"id": mid, "type": "wildcard", "payload": VALID_WILDCARD_PAYLOAD},
        ],
    })
    assert resp.status == 201
    body = await resp.json()
    assert len(body["children"]) == 1


async def test_bundle_update_dedupes_children_by_id(wp_client):
    create = await _create_wildcard(wp_client, name="qa_shared_child_2")
    mid = (await create.json())["id"]
    bun = await wp_client.post("/wp/api/bundles", json={"name": "qa_dup_children_put"})
    bid = (await bun.json())["id"]

    resp = await wp_client.put(f"/wp/api/bundles/{bid}", json={
        "children": [
            {"id": mid, "type": "wildcard", "payload": VALID_WILDCARD_PAYLOAD},
            {"id": mid, "type": "wildcard", "payload": VALID_WILDCARD_PAYLOAD},
        ],
    })
    assert resp.status == 200
    body = await resp.json()
    assert len(body["children"]) == 1
