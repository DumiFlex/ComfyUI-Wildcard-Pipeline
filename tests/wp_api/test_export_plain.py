"""Tests for /wp/api/export/plain (plain wildcard files, engine/wildcard_export.py)."""
import base64
import io
import zipfile

import pytest

pytestmark = pytest.mark.asyncio


async def test_plain_export_returns_a_zip(wp_client):
    resp = await wp_client.post("/wp/api/modules", json={
        "type": "wildcard", "name": "Colours", "description": "",
        "category_id": None, "tags": [],
        "payload": {"var_binding": "colour", "options": [
            {"id": "o1", "value": "red", "weight": 2},
            {"id": "o2", "value": "blue", "weight": 1},
        ]},
    })
    assert resp.status == 201
    wc = await resp.json()
    resp = await wp_client.post("/wp/api/export/plain", json={
        "wildcard_uuids": [wc["id"]], "name": "My Colours",
    })
    assert resp.status == 200
    body = await resp.json()
    assert body["filename"] == "my_colours-wildcards.zip"
    assert body["files"] == 1
    zf = zipfile.ZipFile(io.BytesIO(base64.b64decode(body["data"])))
    assert zf.read("my_colours/colour.txt").decode() == "red\nred\nblue\n"
    assert "my_colours/README.md" in zf.namelist()


async def test_plain_export_with_nothing_writable_is_400(wp_client):
    resp = await wp_client.post("/wp/api/export/plain", json={"wildcard_uuids": []})
    assert resp.status == 400


async def test_plain_export_rejects_bad_lists(wp_client):
    resp = await wp_client.post("/wp/api/export/plain", json={"wildcard_uuids": "x"})
    assert resp.status == 400
