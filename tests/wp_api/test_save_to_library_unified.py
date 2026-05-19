"""Save-to-library unified contract tests.

Phase B coverage: the canonical PUT ``/wp/api/modules/{id}`` and its alias
PUT ``/wp/api/modules/{id}/payload`` both:

  * persist meta (name, description, tags) alongside the payload
  * recompute bundle children snapshots that reference this module id
  * return ``bundles_updated`` so the SPA can surface "this affected N
    other library entries" in the modal
  * honor ``propagate_to_bundles=false`` to skip the bundle rewrite when
    the caller explicitly opts out

Plus GET ``/wp/api/bundles?contains_module=<id>`` returns the bundles a
save would propagate to — used by the modal preview before the user
commits.
"""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


VALID_WILDCARD = {
    "options": [{"id": "o1", "value": "red", "weight": 1}],
    "var_binding": "color",
    "sub_categories": [],
}


async def _make_wildcard(client, name: str = "qa_save_w"):
    resp = await client.post("/wp/api/modules", json={
        "type": "wildcard", "name": name, "payload": VALID_WILDCARD,
    })
    assert resp.status == 201, await resp.text()
    return await resp.json()


async def _make_bundle_containing(client, child_module: dict, bundle_name: str = "qa_save_b"):
    snapshot = {
        "id": child_module["id"],
        "type": child_module["type"],
        "meta": {"name": child_module["name"], "library_name": child_module["name"]},
        "payload": child_module["payload"],
        "payload_hash": child_module["payload_hash"],
    }
    resp = await client.post("/wp/api/bundles", json={
        "name": bundle_name,
        "children": [snapshot],
    })
    assert resp.status == 201, await resp.text()
    return await resp.json()


# ─── PUT /modules/{id} persists meta ─────────────────────────────────


async def test_put_modules_id_persists_meta(wp_client):
    mod = await _make_wildcard(wp_client)
    mid = mod["id"]
    resp = await wp_client.put(f"/wp/api/modules/{mid}", json={
        "name": "renamed_via_put",
        "description": "set via put",
        "tags": ["t1", "t2"],
        "payload": VALID_WILDCARD,
        "propagate_to_bundles": False,
    })
    assert resp.status == 200
    after_resp = await wp_client.get(f"/wp/api/modules/{mid}")
    after = await after_resp.json()
    assert after["name"] == "renamed_via_put"
    assert after["description"] == "set via put"
    assert after["tags"] == ["t1", "t2"]


# ─── Bundle propagation — default on ─────────────────────────────────


async def test_canonical_put_propagates_to_bundles(wp_client):
    mod = await _make_wildcard(wp_client, name="qa_prop_source")
    mid = mod["id"]
    bundle = await _make_bundle_containing(wp_client, mod, bundle_name="qa_prop_bundle")
    bid = bundle["id"]

    # New payload with a marker we can grep on.
    new_payload = {**VALID_WILDCARD, "options": [
        {"id": "o1", "value": "marker_qa_prop", "weight": 1},
    ]}
    resp = await wp_client.put(f"/wp/api/modules/{mid}", json={
        "payload": new_payload,
        "name": "qa_prop_renamed",
    })
    assert resp.status == 200
    body = await resp.json()
    assert bid in body["bundles_updated"]

    # Bundle's stored child snapshot reflects the new payload + new name.
    after_resp = await wp_client.get(f"/wp/api/bundles/{bid}")
    after = await after_resp.json()
    child = next(c for c in after["children"] if c["id"] == mid)
    assert child["payload"]["options"][0]["value"] == "marker_qa_prop"
    assert child["meta"]["name"] == "qa_prop_renamed"
    assert child["meta"]["library_name"] == "qa_prop_renamed"
    # Bundle payload_hash also recomputes when children change.
    assert after["payload_hash"] != bundle["payload_hash"]


# ─── Bundle propagation — opt out ────────────────────────────────────


async def test_canonical_put_propagate_to_bundles_false_skips_rewrite(wp_client):
    mod = await _make_wildcard(wp_client, name="qa_optout_source")
    mid = mod["id"]
    bundle = await _make_bundle_containing(wp_client, mod, bundle_name="qa_optout_bundle")
    bid = bundle["id"]

    new_payload = {**VALID_WILDCARD, "options": [
        {"id": "o1", "value": "should_NOT_appear_in_bundle", "weight": 1},
    ]}
    resp = await wp_client.put(f"/wp/api/modules/{mid}", json={
        "payload": new_payload,
        "propagate_to_bundles": False,
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["bundles_updated"] == []

    after = await (await wp_client.get(f"/wp/api/bundles/{bid}")).json()
    child = next(c for c in after["children"] if c["id"] == mid)
    # Old value preserved — bundle child snapshot intentionally drifts.
    assert child["payload"]["options"][0]["value"] != "should_NOT_appear_in_bundle"
    assert after["payload_hash"] == bundle["payload_hash"]


# ─── Bundles list filter ─────────────────────────────────────────────


async def test_list_bundles_filtered_by_contains_module(wp_client):
    mod = await _make_wildcard(wp_client, name="qa_filter_src")
    mid = mod["id"]
    bundle = await _make_bundle_containing(wp_client, mod, bundle_name="qa_filter_bundle")
    bid = bundle["id"]

    resp = await wp_client.get(f"/wp/api/bundles?contains_module={mid}")
    assert resp.status == 200
    body = await resp.json()
    ids = [b["id"] for b in body["items"]]
    assert bid in ids
    assert body["total"] == len(ids)


async def test_list_bundles_contains_module_returns_empty_for_unused_id(wp_client):
    # Unused uuid → no bundles.
    resp = await wp_client.get("/wp/api/bundles?contains_module=deadbeef")
    assert resp.status == 200
    body = await resp.json()
    assert body["items"] == []
    assert body["total"] == 0
