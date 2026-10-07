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
