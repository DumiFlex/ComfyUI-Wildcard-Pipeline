"""Conditional-request behaviour for the two drift-poll endpoints.

`components/context/drift-store.ts` polls `/wp/api/modules/hashes` and
`/wp/api/bundles/hashes` every 5 seconds, and BOTH the SPA and the in-graph
WP_Context subscribe — so a ComfyUI tab with a Context node on the graph polls
these forever whether or not the manager is ever opened.

Measured against a real install on 2026-08-06: 33 KB per poll, no caching
headers, nothing served from cache. These tests pin the fix — a 304 on an
unchanged library, and an ETag that moves when (and only when) a payload does.
"""
from __future__ import annotations

import sqlite3

import pytest
from aiohttp import web

from engine.db.migrations import migrate
from engine.db.repositories import BundleRepository, ModuleRepository
from wp_api import bundles as bundles_api
from wp_api import modules as modules_api


@pytest.fixture
def app_with_db():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    migrate(conn)
    app = web.Application()
    app["wp_db"] = conn
    modules_api.register(app.router)
    bundles_api.register(app.router)
    return app, conn


def _make_module(conn, name="x", payload=None):
    return ModuleRepository(conn).create(
        type="wildcard", name=name, description="",
        category_id=None, tags=[], payload=payload or {"options": []},
    )


class TestModuleHashesConditional:
    async def test_first_response_carries_an_etag_and_revalidate_header(
        self, aiohttp_client, app_with_db,
    ):
        app, conn = app_with_db
        _make_module(conn)
        client = await aiohttp_client(app)
        resp = await client.get("/wp/api/modules/hashes")
        assert resp.status == 200
        assert resp.headers["ETag"]
        # `no-cache` means "store, but revalidate" — NOT "don't store". The
        # whole saving depends on the browser keeping the body.
        assert resp.headers["Cache-Control"] == "no-cache"

    async def test_unchanged_library_answers_304_with_no_body(
        self, aiohttp_client, app_with_db,
    ):
        app, conn = app_with_db
        _make_module(conn)
        client = await aiohttp_client(app)
        first = await client.get("/wp/api/modules/hashes")
        etag = first.headers["ETag"]

        second = await client.get(
            "/wp/api/modules/hashes", headers={"If-None-Match": etag},
        )
        assert second.status == 304
        assert second.headers["ETag"] == etag
        assert await second.read() == b""

    async def test_editing_a_payload_moves_the_etag(
        self, aiohttp_client, app_with_db,
    ):
        app, conn = app_with_db
        row = _make_module(conn)
        client = await aiohttp_client(app)
        etag = (await client.get("/wp/api/modules/hashes")).headers["ETag"]

        ModuleRepository(conn).update(row["id"], payload={"options": [{"value": "a"}]})

        resp = await client.get(
            "/wp/api/modules/hashes", headers={"If-None-Match": etag},
        )
        assert resp.status == 200, "a payload edit must not be served as 304"
        assert resp.headers["ETag"] != etag

    async def test_inserting_and_deleting_move_the_etag(
        self, aiohttp_client, app_with_db,
    ):
        app, conn = app_with_db
        _make_module(conn, name="first")
        client = await aiohttp_client(app)
        etag_one = (await client.get("/wp/api/modules/hashes")).headers["ETag"]

        extra = _make_module(conn, name="second")
        etag_two = (await client.get("/wp/api/modules/hashes")).headers["ETag"]
        assert etag_two != etag_one, "insert must invalidate"

        ModuleRepository(conn).delete(extra["id"])
        etag_three = (await client.get("/wp/api/modules/hashes")).headers["ETag"]
        assert etag_three != etag_two, "delete must invalidate"

    async def test_community_origin_write_does_not_move_the_etag(
        self, aiohttp_client, app_with_db,
    ):
        """The stamp must not move for a write that cannot change the map.

        `set_community_origin` writes two metadata columns with raw SQL and
        deliberately does NOT bump `version`, so the drift map is
        byte-identical afterwards. Holding the ETag steady is correct — moving
        it would cost every open tab a refetch of a map it already has.
        """
        app, conn = app_with_db
        row = _make_module(conn)
        client = await aiohttp_client(app)
        before_resp = await client.get("/wp/api/modules/hashes")
        before_etag = before_resp.headers["ETag"]
        before_body = await before_resp.json()

        ModuleRepository(conn).set_community_origin(
            row["id"], post_slug="some-slug", version_number=2,
        )

        after_resp = await client.get("/wp/api/modules/hashes")
        assert await after_resp.json() == before_body, (
            "precondition: this write must not alter the drift map"
        )
        assert after_resp.headers["ETag"] == before_etag

    async def test_favorite_toggle_does_move_the_etag_and_that_is_accepted(
        self, aiohttp_client, app_with_db,
    ):
        """Documents a known imprecision rather than asserting it away.

        Favouriting goes through `ModuleRepository.update`, whose single
        UPDATE statement always does `version = version + 1`. So the stamp
        moves and every open tab refetches — even though `payload_hash` did
        not change and the map is identical.

        Left as-is deliberately: the cost is one extra fetch on a rare,
        user-initiated action, and the alternative is a second version counter
        tracking payload-affecting columns only. If this test ever starts
        failing because the ETag held steady, that is an IMPROVEMENT — verify
        the map is genuinely unchanged and update the expectation.
        """
        app, conn = app_with_db
        row = _make_module(conn)
        client = await aiohttp_client(app)
        before_resp = await client.get("/wp/api/modules/hashes")
        before_etag = before_resp.headers["ETag"]
        before_body = await before_resp.json()

        ModuleRepository(conn).update(row["id"], is_favorite=True)

        after_resp = await client.get("/wp/api/modules/hashes")
        assert await after_resp.json() == before_body, "the map itself is unchanged"
        assert after_resp.headers["ETag"] != before_etag

    async def test_body_is_unchanged_from_the_unconditional_shape(
        self, aiohttp_client, app_with_db,
    ):
        """`list_hash_rows` replaced `list()`; the wire shape must not drift."""
        app, conn = app_with_db
        wc = _make_module(conn, name="wc")
        cb = ModuleRepository(conn).create(
            type="combine", name="cb", description="",
            category_id=None, tags=[], payload={"template": "$a"},
        )
        client = await aiohttp_client(app)
        body = await (await client.get("/wp/api/modules/hashes")).json()

        assert body["hashes"][wc["id"]] == {
            "type": "wildcard", "payload_hash": wc["payload_hash"],
        }
        assert body["hashes"][cb["id"]] == {
            "type": "combine", "payload_hash": cb["payload_hash"],
        }


class TestBundleHashesConditional:
    async def test_unchanged_library_answers_304(
        self, aiohttp_client, app_with_db,
    ):
        app, conn = app_with_db
        BundleRepository(conn).create(
            name="b", description="", color=None,
            category_id=None, tags=[], children=[],
        )
        client = await aiohttp_client(app)
        first = await client.get("/wp/api/bundles/hashes")
        assert first.status == 200
        etag = first.headers["ETag"]

        second = await client.get(
            "/wp/api/bundles/hashes", headers={"If-None-Match": etag},
        )
        assert second.status == 304
        assert await second.read() == b""

    async def test_new_bundle_moves_the_etag_and_body_shape_holds(
        self, aiohttp_client, app_with_db,
    ):
        app, conn = app_with_db
        repo = BundleRepository(conn)
        first_bundle = repo.create(
            name="b", description="", color=None,
            category_id=None, tags=[], children=[],
        )
        client = await aiohttp_client(app)
        etag = (await client.get("/wp/api/bundles/hashes")).headers["ETag"]

        repo.create(
            name="c", description="", color=None,
            category_id=None, tags=[], children=[],
        )
        resp = await client.get(
            "/wp/api/bundles/hashes", headers={"If-None-Match": etag},
        )
        assert resp.status == 200
        body = await resp.json()
        # Flat `{id: hash}` — bundles differ from modules here, deliberately.
        assert body["hashes"][first_bundle["id"]] == first_bundle["payload_hash"]


class TestIfNoneMatchParsing:
    async def test_weak_prefix_and_multi_value_lists_are_honoured(
        self, aiohttp_client, app_with_db,
    ):
        """Proxies rewrite and merge these headers; both forms are legal."""
        app, conn = app_with_db
        _make_module(conn)
        client = await aiohttp_client(app)
        etag = (await client.get("/wp/api/modules/hashes")).headers["ETag"]

        weak = await client.get(
            "/wp/api/modules/hashes", headers={"If-None-Match": f"W/{etag}"},
        )
        assert weak.status == 304

        listed = await client.get(
            "/wp/api/modules/hashes",
            headers={"If-None-Match": f'"other", {etag}'},
        )
        assert listed.status == 304

    async def test_a_stale_etag_gets_a_full_response(
        self, aiohttp_client, app_with_db,
    ):
        app, conn = app_with_db
        _make_module(conn)
        client = await aiohttp_client(app)
        resp = await client.get(
            "/wp/api/modules/hashes", headers={"If-None-Match": '"stale"'},
        )
        assert resp.status == 200
        assert "hashes" in await resp.json()
