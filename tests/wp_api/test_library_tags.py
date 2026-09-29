"""Tests for /wp/api/library-tags rename / merge / delete."""
import pytest

from wp_api.library_tags import replace_tag


async def _module(client, name, tags):
    resp = await client.post("/wp/api/modules", json={
        "type": "fixed_values", "name": name, "tags": tags,
        "payload": {"values": []},
    })
    assert resp.status == 201, await resp.text()
    return (await resp.json())["id"]


async def _get(client, kind, rid):
    return await (await client.get(f"/wp/api/{kind}/{rid}")).json()


def test_replace_tag_keeps_order_and_dedupes():
    assert replace_tag(["a", "b", "c"], "b", "x") == ["a", "x", "c"]
    assert replace_tag(["a", "b", "c"], "a", "c") == ["c", "b"]
    assert replace_tag(["a", "b"], "a", None) == ["b"]
    assert replace_tag(["a"], "z", "y") == ["a"]


@pytest.mark.asyncio
async def test_rename_across_modules_bundles_templates(wp_client):
    m1 = await _module(wp_client, "m1", ["outfit", "nsfw"])
    m2 = await _module(wp_client, "m2", ["scene"])
    b = await (await wp_client.post("/wp/api/bundles", json={
        "name": "b", "tags": ["outfit"],
    })).json()
    t = await (await wp_client.post("/wp/api/templates", json={
        "name": "t", "tags": ["outfit"],
    })).json()

    resp = await wp_client.post("/wp/api/library-tags/rename", json={
        "from": "outfit", "to": "clothing",
    })
    assert resp.status == 200
    assert (await resp.json())["updated"] == {"modules": 1, "bundles": 1, "templates": 1}

    row = await _get(wp_client, "modules", m1)
    assert row["tags"] == ["clothing", "nsfw"]
    assert row["version"] == 2
    assert (await _get(wp_client, "modules", m2))["tags"] == ["scene"]
    assert (await _get(wp_client, "bundles", b["id"]))["tags"] == ["clothing"]
    assert (await _get(wp_client, "templates", t["id"]))["tags"] == ["clothing"]


@pytest.mark.asyncio
async def test_rename_onto_existing_tag_merges(wp_client):
    m = await _module(wp_client, "m", ["outfit", "clothing"])
    await wp_client.post("/wp/api/library-tags/rename", json={
        "from": "outfit", "to": "clothing",
    })
    assert (await _get(wp_client, "modules", m))["tags"] == ["clothing"]


@pytest.mark.asyncio
async def test_delete_removes_tag_everywhere(wp_client):
    m = await _module(wp_client, "m", ["outfit", "nsfw"])
    resp = await wp_client.post("/wp/api/library-tags/delete", json={"tag": "outfit"})
    assert (await resp.json())["updated"]["modules"] == 1
    assert (await _get(wp_client, "modules", m))["tags"] == ["nsfw"]


@pytest.mark.asyncio
async def test_rename_rejects_bad_bodies(wp_client):
    rename = "/wp/api/library-tags/rename"
    bad = [{"from": "a"}, {"from": "a", "to": "  "}, {"from": "a", "to": "x" * 500}]
    for body in bad:
        assert (await wp_client.post(rename, json=body)).status == 400
    assert (await wp_client.post("/wp/api/library-tags/delete", json={})).status == 400
    assert (await wp_client.post("/wp/api/library-tags/delete", json=[1])).status == 400
