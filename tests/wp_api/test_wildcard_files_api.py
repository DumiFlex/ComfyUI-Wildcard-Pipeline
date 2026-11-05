"""POST /wp/api/import/wildcard-files — convert wildcard files, then commit
the result through the normal import pipeline."""
import io
import json
import zipfile

import pytest
from aiohttp import FormData

pytestmark = pytest.mark.asyncio


def _form(files: list[tuple[str, bytes]], **meta) -> FormData:
    form = FormData(default_to_multipart=True)
    form.add_field("meta", json.dumps({"paths": [p for p, _ in files], **meta}))
    for path, data in files:
        form.add_field("file", data, filename=path.split("/")[-1])
    return form


async def test_converts_files_with_their_folder_paths(wp_client):
    resp = await wp_client.post("/wp/api/import/wildcard-files", data=_form([
        ("wildcards/hair/colour.txt", b"red\nblonde\n"),
        ("wildcards/look.txt", b"__hair/colour__ hair\n"),
    ]))
    assert resp.status == 200
    body = await resp.json()
    rows = {r["name"]: r for r in body["payload"]["wildcards"]}
    assert set(rows) == {"hair/colour", "look"}
    hair_id = rows["hair/colour"]["id"]
    assert rows["look"]["payload"]["options"][0]["value"] == f"@{{{hair_id}#hair/colour}} hair"
    assert body["report"]["wildcards"] == 2


async def test_reads_zips_and_links_to_existing_library_wildcards(wp_client):
    created = await wp_client.post("/wp/api/modules", json={
        "type": "wildcard", "name": "mood",
        "payload": {"var_binding": "mood", "options": [{"id": "o1", "value": "calm", "weight": 1}]},
    })
    assert created.status in (200, 201)
    mood_id = (await created.json())["id"]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("pack/scene.yaml", "scene:\n  - __mood__ lake\n")
    resp = await wp_client.post("/wp/api/import/wildcard-files", data=_form(
        [("pack.zip", buf.getvalue())], pack_tag="pack",
    ))
    assert resp.status == 200
    (row,) = (await resp.json())["payload"]["wildcards"]
    assert row["payload"]["options"][0]["value"] == f"@{{{mood_id}#mood}} lake"
    assert row["tags"] == ["pack"]


async def test_converted_payload_commits(wp_client):
    resp = await wp_client.post("/wp/api/import/wildcard-files", data=_form([
        ("animals/cats.txt", b"tabby\n"),
        ("animals/dogs.txt", b"pug\n"),
        ("scenes/field.txt", b"__animals/*__ in a field\n"),
        ("scenes/nap.txt", b"__animals/cats__ asleep\n"),
        ("pets.txt", b"__animals/dogs__\n"),
    ], bundle_mode="entries"))
    payload = (await resp.json())["payload"]
    # Only the entry points (nothing references them) are bundled.
    assert [b["name"] for b in payload["bundles"]] == ["Imported wildcards", "scenes"]
    adds = [{"kind": "category", "entity": c} for c in payload["categories"]]
    adds += [{"kind": "wildcard", "entity": w} for w in payload["wildcards"]]
    adds += [{"kind": "bundle", "entity": b} for b in payload["bundles"]]
    commit = await wp_client.post("/wp/api/import/commit", json={"adds": adds})
    assert commit.status == 200, await commit.text()
    listed = await wp_client.get("/wp/api/modules?type=wildcard&limit=50")
    names = {m["name"] for m in (await listed.json())["items"]}
    # animals/cats + animals/dogs merged into one tagged "animals" wildcard;
    # the animals/* glob became a plain reference to it.
    assert {"animals", "scenes/field", "pets"} <= names
    assert not names & {"animals/cats", "animals/dogs", "animals/*"}
    outer_id = payload["bundles"][0]["id"]
    got = await wp_client.get(f"/wp/api/bundles/{outer_id}")
    outer = await got.json()
    # The inner bundle reference expands to its wildcards on read.
    inner = next(c for c in outer["children"] if c["type"] == "bundle")
    assert [c["meta"]["name"] for c in inner["children"]] == ["scenes/field", "scenes/nap"]
    assert [c["type"] for c in outer["children"]] == ["bundle", "wildcard"]


async def test_merging_can_be_turned_off_or_skipped_per_folder(wp_client):
    files = [
        ("hair/red.txt", b"red\n"), ("hair/blonde.txt", b"blonde\n"),
        ("eyes/blue.txt", b"blue\n"), ("eyes/green.txt", b"green\n"),
    ]

    async def names(**meta) -> set[str]:
        resp = await wp_client.post("/wp/api/import/wildcard-files", data=_form(files, **meta))
        return {r["name"] for r in (await resp.json())["payload"]["wildcards"]}

    assert await names() == {"hair", "eyes"}
    assert await names(merge=False) == {"hair/red", "hair/blonde", "eyes/blue", "eyes/green"}
    assert await names(keep_separate=["hair"]) == {"hair/red", "hair/blonde", "eyes"}


async def test_rejects_uploads_without_wildcard_files(wp_client):
    resp = await wp_client.post("/wp/api/import/wildcard-files", data=_form([
        ("readme.md", b"# hi\n"),
    ]))
    assert resp.status == 400
    assert "no wildcard files" in (await resp.json())["error"]


async def test_rejects_non_multipart(wp_client):
    resp = await wp_client.post("/wp/api/import/wildcard-files", json={})
    assert resp.status == 400


async def test_bad_zip_is_a_clean_error(wp_client):
    resp = await wp_client.post("/wp/api/import/wildcard-files", data=_form([
        ("pack.zip", b"not a zip"),
    ]))
    assert resp.status == 400
    assert "pack.zip" in (await resp.json())["error"]


async def test_stacks_with_logic_modules_commit(wp_client):
    resp = await wp_client.post("/wp/api/import/wildcard-files", data=_form([
        ("w/seasons.txt", b"winter\nsummer\n"),
        ("w/clothes.yaml", b"clothes:\n  - {text: coat, if: \"season eq 'winter'\"}\n"
                           b"  - {text: shorts, if: \"season eq 'summer'\"}\n"),
        ("w/scene.txt", b"${season=!__seasons__} a ${season} day, __clothes__\n"),
        ("w/look.txt", b"girl <ppp:if _is_sdxl>score_9<ppp:else>masterpiece<ppp:/if>\n"),
    ], merge=False))
    assert resp.status == 200
    body = await resp.json()
    payload = body["payload"]
    assert payload["combines"] and payload["constraints"]
    adds = [{"kind": "category", "entity": c} for c in payload["categories"]]
    for bucket, kind in (
        ("wildcards", "wildcard"), ("combines", "combine"), ("derivations", "derivation"),
        ("constraints", "constraint"), ("bundles", "bundle"),
    ):
        adds += [{"kind": kind, "entity": e} for e in payload[bucket]]
    commit = await wp_client.post("/wp/api/import/commit", json={"adds": adds})
    assert commit.status == 200, await commit.text()
    listed = await wp_client.get("/wp/api/bundles")
    names = {b["name"] for b in (await listed.json())["items"]}
    assert {"scene", "Model checks (family)"} <= names


async def test_lists_and_reads_wildcard_folders(wp_client, tmp_path, monkeypatch):
    from wp_api import wildcard_files as route

    cn = tmp_path / "custom_nodes"
    wild = cn / "ComfyUI-Impact-Pack" / "wildcards" / "hair"
    wild.mkdir(parents=True)
    (wild / "color.txt").write_text("red\nblonde\n")
    (cn / "ComfyUI-Impact-Pack" / "wildcards" / "look.txt").write_text("__hair/color__ hair\n")
    secret = tmp_path / "secret.txt"
    secret.write_text("token\n")
    (wild / "linked.txt").symlink_to(secret)  # never read through a link
    monkeypatch.setattr(route, "_custom_nodes_dirs", lambda: [cn])
    monkeypatch.setattr(route, "_lora_manager_dirs", lambda: [])
    resp = await wp_client.get("/wp/api/import/wildcard-folders")
    folders = (await resp.json())["folders"]
    assert [(f["id"], f["files"]) for f in folders] == [("impact:wildcards", 2)]
    resp = await wp_client.post(
        "/wp/api/import/wildcard-files", data=_form([], folder="impact:wildcards"),
    )
    assert resp.status == 200, await resp.text()
    names = {r["name"] for r in (await resp.json())["payload"]["wildcards"]}
    assert names == {"hair/color", "look"}
    bad = await wp_client.post("/wp/api/import/wildcard-files", data=_form([], folder="/etc"))
    assert bad.status == 400
