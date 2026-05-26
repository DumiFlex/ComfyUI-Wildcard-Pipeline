import pytest

pytestmark = pytest.mark.asyncio


async def test_create_minimal_returns_201_with_8hex_id(wp_client):
    resp = await wp_client.post(
        "/wp/api/templates",
        json={"name": "portrait", "template_string": "$subject $style"},
    )
    assert resp.status == 201
    body = await resp.json()
    assert len(body["id"]) == 8
    assert body["name"] == "portrait"
    assert body["template_string"] == "$subject $style"


async def test_create_missing_name_400(wp_client):
    resp = await wp_client.post("/wp/api/templates", json={"template_string": "$x"})
    assert resp.status == 400


async def test_create_bad_category_fk_400(wp_client):
    resp = await wp_client.post(
        "/wp/api/templates",
        json={"name": "x", "template_string": "$x", "category_id": "nope1234"},
    )
    assert resp.status == 400


async def test_list_filters_by_q(wp_client):
    await wp_client.post("/wp/api/templates", json={"name": "alpha", "template_string": "$x"})
    await wp_client.post("/wp/api/templates", json={"name": "beta", "template_string": "$y"})
    resp = await wp_client.get("/wp/api/templates?q=alph")
    body = await resp.json()
    assert [t["name"] for t in body["items"]] == ["alpha"]
    assert body["total"] == 1


async def test_get_unknown_404(wp_client):
    resp = await wp_client.get("/wp/api/templates/aaaaaaaa")
    assert resp.status == 404


async def test_update_and_favorite(wp_client):
    created = await (await wp_client.post(
        "/wp/api/templates", json={"name": "a", "template_string": "$x"},
    )).json()
    tid = created["id"]
    upd = await wp_client.put(f"/wp/api/templates/{tid}", json={"template_string": "$y"})
    assert (await upd.json())["template_string"] == "$y"
    fav = await wp_client.post(f"/wp/api/templates/{tid}/favorite", json={"is_favorite": True})
    assert (await fav.json())["is_favorite"] is True


async def test_delete(wp_client):
    created = await (await wp_client.post(
        "/wp/api/templates", json={"name": "a", "template_string": "$x"},
    )).json()
    resp = await wp_client.delete(f"/wp/api/templates/{created['id']}")
    assert resp.status == 200
    assert (await resp.json())["deleted"] == created["id"]
    assert (await wp_client.get(f"/wp/api/templates/{created['id']}")).status == 404
