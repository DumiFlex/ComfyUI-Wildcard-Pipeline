"""Tests for /wp/api/cleaner-presets CRUD + hashes."""
import pytest

pytestmark = pytest.mark.asyncio


def _valid_payload(intensity: str = "balanced") -> dict:
    return {
        "intensity": intensity,
        "mode": "tags",
        "rules_override": {},
        "blocklist": {"kind": "list", "entries": []},
    }


async def test_list_seeded_builtins(wp_client):
    """Migration 011 seeds the 3 built-in intensities."""
    resp = await wp_client.get("/wp/api/cleaner-presets")
    body = await resp.json()
    names = {it["name"] for it in body["items"]}
    assert names == {"gentle", "balanced", "aggressive"}
    assert all(it["is_builtin"] for it in body["items"])


async def test_hashes_endpoint_returns_id_hash_map(wp_client):
    resp = await wp_client.get("/wp/api/cleaner-presets/hashes")
    body = await resp.json()
    assert "hashes" in body
    assert len(body["hashes"]) == 3
    for v in body["hashes"].values():
        assert isinstance(v, str)
        assert len(v) == 16


async def test_create_user_preset(wp_client):
    resp = await wp_client.post(
        "/wp/api/cleaner-presets",
        json={"name": "tag-aggro", "payload": _valid_payload("aggressive")},
    )
    assert resp.status == 201
    body = await resp.json()
    assert body["name"] == "tag-aggro"
    assert body["is_builtin"] is False
    assert body["payload"]["intensity"] == "aggressive"


async def test_create_missing_name_400(wp_client):
    resp = await wp_client.post(
        "/wp/api/cleaner-presets",
        json={"payload": _valid_payload()},
    )
    assert resp.status == 400


async def test_create_invalid_intensity_400(wp_client):
    bad = _valid_payload()
    bad["intensity"] = "nuclear"
    resp = await wp_client.post(
        "/wp/api/cleaner-presets",
        json={"name": "bad", "payload": bad},
    )
    assert resp.status == 400


async def test_get_returns_preset(wp_client):
    create = await wp_client.post(
        "/wp/api/cleaner-presets",
        json={"name": "mine", "payload": _valid_payload()},
    )
    created = await create.json()
    resp = await wp_client.get(f"/wp/api/cleaner-presets/{created['id']}")
    assert resp.status == 200


async def test_get_missing_404(wp_client):
    resp = await wp_client.get("/wp/api/cleaner-presets/does-not-exist")
    assert resp.status == 404


async def test_update_user_preset(wp_client):
    create = await wp_client.post(
        "/wp/api/cleaner-presets",
        json={"name": "mine", "payload": _valid_payload()},
    )
    created = await create.json()
    new_payload = _valid_payload("aggressive")
    new_payload["blocklist"] = {"kind": "list", "entries": ["watermark"]}
    resp = await wp_client.put(
        f"/wp/api/cleaner-presets/{created['id']}",
        json={"payload": new_payload},
    )
    assert resp.status == 200
    body = await resp.json()
    assert body["payload"]["intensity"] == "aggressive"
    assert body["payload"]["blocklist"]["entries"] == ["watermark"]
    assert body["version"] == 2


async def test_update_builtin_403(wp_client):
    resp = await wp_client.put(
        "/wp/api/cleaner-presets/builtin-gentle",
        json={"name": "renamed"},
    )
    assert resp.status == 403


async def test_delete_user_preset(wp_client):
    create = await wp_client.post(
        "/wp/api/cleaner-presets",
        json={"name": "mine", "payload": _valid_payload()},
    )
    created = await create.json()
    resp = await wp_client.delete(f"/wp/api/cleaner-presets/{created['id']}")
    assert resp.status == 204
    # Confirm 404 on subsequent get
    get = await wp_client.get(f"/wp/api/cleaner-presets/{created['id']}")
    assert get.status == 404


async def test_delete_builtin_403(wp_client):
    resp = await wp_client.delete("/wp/api/cleaner-presets/builtin-balanced")
    assert resp.status == 403


async def test_update_changes_hash(wp_client):
    """payload_hash must change on payload edits so drift detection works."""
    create = await wp_client.post(
        "/wp/api/cleaner-presets",
        json={"name": "mine", "payload": _valid_payload()},
    )
    created = await create.json()
    old_hash = created["payload_hash"]
    new_payload = _valid_payload("aggressive")
    resp = await wp_client.put(
        f"/wp/api/cleaner-presets/{created['id']}",
        json={"payload": new_payload},
    )
    body = await resp.json()
    assert body["payload_hash"] != old_hash
