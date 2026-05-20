"""Tier-2 bundle nesting — reference model.

Bundles store nested bundle children as REFERENCES (id-only pointers),
not deep snapshots. The API expands references inline at GET time so the
SPA pre-flatten path keeps working without knowing the difference, but
the DB only stores the pointer — when the referenced bundle changes the
parent's view is naturally fresh, no drift propagation needed.

API rules enforced here:

- Writes strip everything except {id, type, name?, color?} off bundle
  children, so a request body that round-tripped the GET-expanded shape
  doesn't accidentally persist a stale snapshot.
- Self-include (A → A) rejected at PUT.
- Missing reference (id not in repo) rejected.
- Tier 3 (referenced bundle already has bundle children) rejected.
- GET expands every reference inline so the SPA sees the inner bundle's
  current children verbatim under the same `children` key.
"""
import pytest

pytestmark = pytest.mark.asyncio


def _leaf_wildcard(child_id: str = "aaaa0001") -> dict:
    return {"id": child_id, "type": "wildcard", "payload": {"options": []}}


def _bundle_ref(ref_id: str, name: str = "ref") -> dict:
    """Minimal bundle reference shape the SPA sends on save."""
    return {"id": ref_id, "type": "bundle", "name": name}


async def _create_bundle(wp_client, **fields) -> dict:
    resp = await wp_client.post("/wp/api/bundles", json={
        "name": fields.pop("name", "untitled"),
        **fields,
    })
    assert resp.status == 201
    return await resp.json()


# ── Reference storage shape ───────────────────────────────────────────────


async def test_post_strips_inner_children_from_bundle_refs(wp_client):
    """SPA may forward the GET-expanded shape on save. Server must strip
    every field except the reference pointers before persisting."""
    inner = await _create_bundle(wp_client, name="inner")
    # Forward a ref WITH a stale `children` snapshot embedded.
    polluted = {
        "id": inner["id"], "type": "bundle", "name": "inner",
        "color": "#abcdef",
        "children": [_leaf_wildcard("snapshot")],
        "_resolved_from": inner["id"],
        "extra_garbage": True,
    }
    outer = await _create_bundle(wp_client, name="outer", children=[polluted])
    # The expanded view will re-attach `children` from the live inner
    # bundle, but the underlying ref should only carry the pointer
    # fields — fetch raw via list (which doesn't expand) to confirm.
    listing = await (await wp_client.get("/wp/api/bundles")).json()
    raw = next(b for b in listing["items"] if b["id"] == outer["id"])
    raw_ref = raw["children"][0]
    assert raw_ref["id"] == inner["id"]
    assert raw_ref["type"] == "bundle"
    assert raw_ref["name"] == "inner"
    assert raw_ref["color"] == "#abcdef"
    # Stale snapshot stripped.
    assert "children" not in raw_ref
    assert "extra_garbage" not in raw_ref
    assert "_resolved_from" not in raw_ref


# ── GET-time reference expansion ──────────────────────────────────────────


async def test_get_expands_bundle_refs_with_live_inner_children(wp_client):
    """GET /bundles/{id} attaches the referenced bundle's current
    children under the bundle-child entry so the SPA pre-flatten sees
    fresh content on every read."""
    inner = await _create_bundle(
        wp_client, name="inner",
        children=[_leaf_wildcard("xx000001"), _leaf_wildcard("xx000002")],
    )
    outer = await _create_bundle(
        wp_client, name="outer", children=[_bundle_ref(inner["id"])],
    )
    resp = await wp_client.get(f"/wp/api/bundles/{outer['id']}")
    body = await resp.json()
    [ref] = body["children"]
    assert ref["type"] == "bundle"
    assert ref["id"] == inner["id"]
    assert [c["id"] for c in ref["children"]] == ["xx000001", "xx000002"]
    assert ref["_resolved_from"] == inner["id"]


async def test_get_reflects_inner_bundle_update_without_outer_write(wp_client):
    """The reference model's headline benefit: update the inner bundle,
    fetch the outer, see the new contents — no propagation required."""
    inner = await _create_bundle(
        wp_client, name="inner", children=[_leaf_wildcard("v1")],
    )
    outer = await _create_bundle(
        wp_client, name="outer", children=[_bundle_ref(inner["id"])],
    )
    # Update inner — change its children.
    await wp_client.put(f"/wp/api/bundles/{inner['id']}", json={
        "children": [_leaf_wildcard("v2"), _leaf_wildcard("v3")],
    })
    # GET outer; expansion picks up the new state.
    body = await (await wp_client.get(f"/wp/api/bundles/{outer['id']}")).json()
    [ref] = body["children"]
    assert [c["id"] for c in ref["children"]] == ["v2", "v3"]


async def test_get_flags_missing_reference(wp_client):
    """If the referenced bundle is deleted, GET still returns the parent
    but the ref entry is marked so the SPA can show a placeholder. The
    cached display name written at insert time survives the deletion."""
    inner = await _create_bundle(wp_client, name="will-be-deleted")
    outer = await _create_bundle(
        wp_client, name="outer",
        children=[_bundle_ref(inner["id"], name="will-be-deleted")],
    )
    await wp_client.delete(f"/wp/api/bundles/{inner['id']}")
    body = await (await wp_client.get(f"/wp/api/bundles/{outer['id']}")).json()
    [ref] = body["children"]
    assert ref["_missing_ref"] is True
    assert ref["name"] == "will-be-deleted"


# ── Validation: tier-2 rule ───────────────────────────────────────────────


async def test_post_allows_tier1_bundle_reference(wp_client):
    """Inner bundle has no bundle children → fine."""
    inner = await _create_bundle(
        wp_client, name="inner", children=[_leaf_wildcard()],
    )
    resp = await wp_client.post("/wp/api/bundles", json={
        "name": "outer",
        "children": [_bundle_ref(inner["id"])],
    })
    assert resp.status == 201


async def test_post_rejects_tier3_reference(wp_client):
    """Referenced bundle already contains a bundle child → reject."""
    # Build a tier-1 bundle B.
    inner_b = await _create_bundle(wp_client, name="inner-b")
    # Build a tier-2 bundle M that references B (legal — M itself is
    # tier 2, not stored as a tier-3 from anyone's view yet).
    middle = await _create_bundle(
        wp_client, name="middle", children=[_bundle_ref(inner_b["id"])],
    )
    # Now try to make M a child of OUTER. OUTER would reference M, and M
    # contains a bundle child — Tier 3 from OUTER's perspective.
    resp = await wp_client.post("/wp/api/bundles", json={
        "name": "outer",
        "children": [_bundle_ref(middle["id"])],
    })
    assert resp.status == 400
    body = await resp.json()
    assert "tier 2" in body["error"].lower()


async def test_post_rejects_missing_reference(wp_client):
    """Dangling pointer at write time → reject."""
    resp = await wp_client.post("/wp/api/bundles", json={
        "name": "outer",
        "children": [_bundle_ref("deadbeef")],
    })
    assert resp.status == 400
    body = await resp.json()
    assert "not found" in body["error"].lower()


async def test_put_rejects_self_include(wp_client):
    """A → A: a child references the parent's own id."""
    outer = await _create_bundle(wp_client, name="outer")
    resp = await wp_client.put(f"/wp/api/bundles/{outer['id']}", json={
        "children": [_bundle_ref(outer["id"])],
    })
    assert resp.status == 400
    body = await resp.json()
    assert "itself" in body["error"].lower()


async def test_put_allows_swapping_refs(wp_client):
    """Replacing one tier-1 reference with another is fine."""
    a = await _create_bundle(wp_client, name="a", children=[_leaf_wildcard("a")])
    b = await _create_bundle(wp_client, name="b", children=[_leaf_wildcard("b")])
    outer = await _create_bundle(
        wp_client, name="outer", children=[_bundle_ref(a["id"])],
    )
    resp = await wp_client.put(f"/wp/api/bundles/{outer['id']}", json={
        "children": [_bundle_ref(b["id"])],
    })
    assert resp.status == 200
    body = await resp.json()
    [ref] = body["children"]
    assert ref["id"] == b["id"]
    assert [c["id"] for c in ref["children"]] == ["b"]


# ── Mixed children (leaves + refs) ────────────────────────────────────────


async def test_post_allows_mixed_leaf_and_reference(wp_client):
    inner = await _create_bundle(
        wp_client, name="inner", children=[_leaf_wildcard("inner-leaf")],
    )
    resp = await wp_client.post("/wp/api/bundles", json={
        "name": "outer",
        "children": [
            _leaf_wildcard("aaaa0001"),
            _bundle_ref(inner["id"]),
            _leaf_wildcard("aaaa0002"),
        ],
    })
    assert resp.status == 201
    body = await resp.json()
    types = [c["type"] for c in body["children"]]
    assert types == ["wildcard", "bundle", "wildcard"]
    # Inner expansion attached on the bundle entry.
    assert [c["id"] for c in body["children"][1]["children"]] == ["inner-leaf"]


# ── Bilateral tier-2 integrity ────────────────────────────────────────────
# The write-time check on A enforces tier-2 from A's perspective, but B
# can be updated unilaterally. Without a complementary check on B's
# update, B could gain bundle children of its own and silently demote
# every parent A's reference into a tier-3 structure on read. The
# server refuses the B-side write to keep the ceiling honest.


async def test_put_rejects_adding_bundle_child_when_referenced_by_parent(wp_client):
    """B is referenced by A. B tries to add another bundle as a child —
    would make A's view tier-3. Reject with 409 Conflict."""
    grandchild = await _create_bundle(wp_client, name="grandchild")
    # B starts as tier-1 (no bundle children).
    b = await _create_bundle(
        wp_client, name="b", children=[_leaf_wildcard("b-leaf")],
    )
    # A references B — legal (B is tier-1).
    await _create_bundle(wp_client, name="a", children=[_bundle_ref(b["id"])])
    # Now try to upgrade B by adding a bundle child of its own.
    resp = await wp_client.put(f"/wp/api/bundles/{b['id']}", json={
        "children": [_leaf_wildcard("b-leaf"), _bundle_ref(grandchild["id"])],
    })
    assert resp.status == 409
    body = await resp.json()
    assert "tier" in body["error"].lower() or "referenced" in body["error"].lower()


async def test_put_allows_adding_bundle_child_when_no_parents(wp_client):
    """Same B, no parents referencing it — adding a bundle child is fine."""
    grandchild = await _create_bundle(wp_client, name="grandchild")
    b = await _create_bundle(
        wp_client, name="b", children=[_leaf_wildcard("b-leaf")],
    )
    resp = await wp_client.put(f"/wp/api/bundles/{b['id']}", json={
        "children": [_leaf_wildcard("b-leaf"), _bundle_ref(grandchild["id"])],
    })
    assert resp.status == 200


async def test_put_allows_leaf_only_edits_when_referenced(wp_client):
    """B is referenced by A. B can still edit its leaf children — the
    integrity check only fires when a bundle child appears in the update."""
    b = await _create_bundle(
        wp_client, name="b", children=[_leaf_wildcard("v1")],
    )
    await _create_bundle(wp_client, name="a", children=[_bundle_ref(b["id"])])
    resp = await wp_client.put(f"/wp/api/bundles/{b['id']}", json={
        "children": [_leaf_wildcard("v2"), _leaf_wildcard("v3")],
    })
    assert resp.status == 200


async def test_put_allows_rename_or_recolor_when_referenced(wp_client):
    """Metadata-only updates on B skip the children integrity check
    entirely — no `children` key in the patch, no work to do."""
    b = await _create_bundle(wp_client, name="b")
    await _create_bundle(wp_client, name="a", children=[_bundle_ref(b["id"])])
    resp = await wp_client.put(f"/wp/api/bundles/{b['id']}", json={
        "name": "b-renamed",
        "color": "#ff0000",
    })
    assert resp.status == 200


async def test_put_error_lists_offending_parents(wp_client):
    """The 409 body cites which parent bundles would break, so the SPA
    can route the user to detach the reference first."""
    grandchild = await _create_bundle(wp_client, name="grandchild")
    b = await _create_bundle(wp_client, name="b")
    parent_a = await _create_bundle(
        wp_client, name="parent-a", children=[_bundle_ref(b["id"])],
    )
    parent_x = await _create_bundle(
        wp_client, name="parent-x", children=[_bundle_ref(b["id"])],
    )
    resp = await wp_client.put(f"/wp/api/bundles/{b['id']}", json={
        "children": [_bundle_ref(grandchild["id"])],
    })
    assert resp.status == 409
    body = await resp.json()
    # Both parents named — order not guaranteed by repo.list, accept either.
    assert "parent-a" in body["error"] or parent_a["id"] in body["error"]
    assert "parent-x" in body["error"] or parent_x["id"] in body["error"]


# ── Edge cases ────────────────────────────────────────────────────────────


async def test_post_empty_children_unaffected(wp_client):
    resp = await wp_client.post("/wp/api/bundles", json={
        "name": "empty",
        "children": [],
    })
    assert resp.status == 201
