"""/wp/api/label-grid/fonts — the widget's font list."""

from __future__ import annotations

from engine import label_grid as g


async def test_fonts_list_starts_with_default(wp_client):
    resp = await wp_client.get("/wp/api/label-grid/fonts")
    assert resp.status == 200
    body = await resp.json()
    assert body["fonts"][0] == g.DEFAULT_FONT
