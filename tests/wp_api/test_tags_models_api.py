"""The /wp/api/tags/* and /wp/api/models/* routes (the matching itself is in
test_tag_index.py and test_models.py)."""
from __future__ import annotations

import os
import sys
import types

import pytest

from wp_api import _tag_download
from wp_api import models as _models
from wp_api import tags as _tags


@pytest.fixture
def tag_file(tmp_path, monkeypatch):
    csv = tmp_path / "tags.csv"
    monkeypatch.setattr(_tags, "tag_file_path", lambda: csv)
    _tags.reset_cache()
    yield csv
    _tags.reset_cache()


async def test_tags_status_and_suggest_without_a_list(wp_client, tag_file):
    body = (await (await wp_client.get("/wp/api/tags/status")).json())
    assert body["available"] is False and body["tag_count"] == 0
    got = (await (await wp_client.get("/wp/api/tags/suggest?q=hair")).json())
    assert got == {"tags": [], "available": False}
    assert (await (await wp_client.get("/wp/api/tags/suggest?q=")).json()) == {"tags": []}


async def test_tags_suggest_reads_the_list_and_picks_up_a_new_one(wp_client, tag_file):
    tag_file.write_text("long_hair,0,900,\nred_hair,0,400,longhair_red\nsmile,0,3000,\n")
    status = (await (await wp_client.get("/wp/api/tags/status")).json())
    assert status["available"] is True and status["tag_count"] >= 3
    got = (await (await wp_client.get("/wp/api/tags/suggest?q=long&limit=5")).json())
    names = [t["name"] for t in got["tags"]]
    # red_hair comes in through its alias longhair_red.
    assert names == ["long_hair", "red_hair"] and got["available"] is True
    assert got["tags"][1]["matched"] == "longhair_red"
    assert got["tags"][0]["category_name"] == "general"
    # Replacing the file takes effect without a restart.
    tag_file.write_text("blonde_hair,0,10,\n")
    st = os.stat(tag_file)
    os.utime(tag_file, (st.st_atime + 5, st.st_mtime + 5))
    got = (await (await wp_client.get("/wp/api/tags/suggest?q=blo")).json())
    assert [t["name"] for t in got["tags"]] == ["blonde_hair"]
    bad = await wp_client.get("/wp/api/tags/suggest?q=hair&limit=x")
    assert bad.status == 400


async def test_tags_download_and_remove(wp_client, tag_file, monkeypatch):
    def fake_download(dest):
        dest.write_text("smile,0,3000,\n")
        return _tag_download.DownloadResult(path=dest, bytes_written=14)
    monkeypatch.setattr(_tags, "download_tag_list", fake_download)
    got = (await (await wp_client.post("/wp/api/tags/download", json={"url": "ignored"})).json())
    assert got["bytes"] == 14 and got["tag_count"] == 1
    gone = (await (await wp_client.delete("/wp/api/tags")).json())
    assert gone["removed"] is True and not tag_file.exists()

    def failing(dest):
        raise _tag_download.DownloadError("the release is gone")
    monkeypatch.setattr(_tags, "download_tag_list", failing)
    r = await wp_client.post("/wp/api/tags/download", json={})
    assert r.status == 502 and "release is gone" in (await r.json())["error"]


async def test_tags_remove_refuses_a_symlink_and_a_missing_user_dir(wp_client, tag_file, tmp_path,
                                                                     monkeypatch):
    target = tmp_path / "precious.txt"
    target.write_text("keep me")
    tag_file.symlink_to(target)
    r = await wp_client.delete("/wp/api/tags")
    assert r.status == 409 and target.exists()
    monkeypatch.setattr(_tags, "tag_file_path", lambda: None)
    assert (await wp_client.delete("/wp/api/tags")).status == 409
    assert (await wp_client.post("/wp/api/tags/download", json={})).status == 409


@pytest.fixture
def comfy_models(monkeypatch):
    """ComfyUI's folder_paths with a few LoRAs and no embeddings folder."""
    files = {"loras": ["styles/ink_wash.safetensors", "characters/aria_v2.safetensors"]}
    fp = types.ModuleType("folder_paths")

    def get_filename_list(key):
        if key not in files:
            raise KeyError(key)
        return list(files[key])
    fp.get_filename_list = get_filename_list  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "folder_paths", fp)
    _models.reset_cache()
    yield files
    _models.reset_cache()


async def test_models_status_suggest_and_refresh(wp_client, comfy_models):
    st = (await (await wp_client.get("/wp/api/models/status")).json())
    assert st["sources"] == [{"kind": "lora", "count": 2}, {"kind": "embedding", "count": 0}]
    got = (await (await wp_client.get("/wp/api/models/suggest?q=ink")).json())
    assert got["results"]["lora"] == [
        {"name": "ink_wash", "path": "styles/ink_wash.safetensors", "folder": "styles"}]
    assert got["results"]["embedding"] == []
    # An empty query lists nothing, unless the caret is inside a reference.
    assert (await (await wp_client.get("/wp/api/models/suggest?q=")).json()) == {"results": {}}
    every = (await (await wp_client.get(
        "/wp/api/models/suggest?q=&all=1&kinds=lora,future")).json())
    assert [h["name"] for h in every["results"]["lora"]] == ["aria_v2", "ink_wash"]
    assert "embedding" not in every["results"]
    assert (await wp_client.get("/wp/api/models/suggest?q=a&limit=no")).status == 400
    # A LoRA added while ComfyUI runs shows up after Refresh.
    comfy_models["loras"].append("new_one.safetensors")
    ref = (await (await wp_client.post("/wp/api/models/refresh", json={})).json())
    assert ref["sources"][0] == {"kind": "lora", "count": 3}


async def test_models_outside_comfyui_are_empty(wp_client, monkeypatch):
    monkeypatch.setitem(sys.modules, "folder_paths", None)
    _models.reset_cache()
    st = (await (await wp_client.get("/wp/api/models/status")).json())
    assert all(s["count"] == 0 for s in st["sources"])
    _models.reset_cache()
