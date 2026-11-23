"""/wp/api/image-filter/* — the picker's answer channel."""
from __future__ import annotations

import pytest

from engine import image_filter as f


@pytest.fixture(autouse=True)
def _fresh_pending(monkeypatch):
    monkeypatch.setattr(f, "PENDING", f.PendingAnswers())


async def test_answer_reaches_the_waiting_request(wp_client):
    f.PENDING.open("tok", {"token": "tok", "frames": []})
    resp = await wp_client.post(
        "/wp/api/image-filter/answer",
        json={"token": "tok", "action": "picks", "picks": [[0, 1]]},
    )
    assert resp.status == 200
    assert f.PENDING.take("tok") == {"token": "tok", "action": "picks", "picks": [[0, 1]]}


async def test_answer_without_a_waiting_request_is_404(wp_client):
    resp = await wp_client.post(
        "/wp/api/image-filter/answer", json={"token": "gone", "action": "stop"},
    )
    assert resp.status == 404


@pytest.mark.parametrize("body", [
    {"action": "stop"},
    {"token": "tok", "action": "explode"},
    ["tok"],
])
async def test_bad_bodies_are_400(wp_client, body):
    f.PENDING.open("tok", {"token": "tok"})
    resp = await wp_client.post("/wp/api/image-filter/answer", json=body)
    assert resp.status == 400
    assert f.PENDING.take("tok") is None


async def test_pending_lists_waiting_requests(wp_client):
    f.PENDING.open("a", {"token": "a", "node_id": "7"})
    resp = await wp_client.get("/wp/api/image-filter/pending")
    assert resp.status == 200
    assert (await resp.json()) == {"pending": [{"token": "a", "node_id": "7"}]}


async def test_extend_adds_time_to_a_waiting_countdown(wp_client):
    f.PENDING.open("tok", {"token": "tok", "timeout": 600})
    resp = await wp_client.post(
        "/wp/api/image-filter/extend", json={"token": "tok", "seconds": 300})
    assert resp.status == 200
    assert (await resp.json()) == {"timeout": 900}
    assert f.PENDING.timeout("tok", 0) == 900


async def test_extend_caps_one_step_and_the_total(wp_client):
    f.PENDING.open("tok", {"token": "tok", "timeout": f.MAX_TIMEOUT - 10})
    resp = await wp_client.post(
        "/wp/api/image-filter/extend", json={"token": "tok", "seconds": 99_999})
    assert (await resp.json()) == {"timeout": f.MAX_TIMEOUT}


async def test_extend_without_a_countdown_is_404(wp_client):
    f.PENDING.open("tok", {"token": "tok", "timeout": 0})
    resp = await wp_client.post(
        "/wp/api/image-filter/extend", json={"token": "tok", "seconds": 60})
    assert resp.status == 404
    resp = await wp_client.post(
        "/wp/api/image-filter/extend", json={"token": "gone", "seconds": 60})
    assert resp.status == 404


@pytest.mark.parametrize("body", [
    {"seconds": 60},
    {"token": "tok"},
    {"token": "tok", "seconds": -5},
    {"token": "tok", "seconds": True},
    {"token": "tok", "seconds": "60"},
    ["tok"],
])
async def test_extend_bad_bodies_are_400(wp_client, body):
    f.PENDING.open("tok", {"token": "tok", "timeout": 600})
    resp = await wp_client.post(
        "/wp/api/image-filter/extend", json=body)
    assert resp.status == 400
    assert f.PENDING.timeout("tok", 0) == 600
