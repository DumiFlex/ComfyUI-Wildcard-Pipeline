"""Tests for the API CRUD routes using UUID-based ids.

Uses aiohttp.test_utils.TestClient for async HTTP testing without
requiring pytest-aiohttp as an extra dependency.
"""

from __future__ import annotations

import json

import pytest
import pytest_asyncio
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from api.routes.crud import (
    create_constraint_routes,
    create_pipeline_routes,
    create_wildcard_routes,
)
from api.services.file_store import FileStore


# -- Helpers ------------------------------------------------------------------


def _make_wildcard_app(tmp_path) -> tuple[web.Application, FileStore]:
    """Create a test app with wildcard CRUD routes pointing at tmp_path."""
    store = FileStore(tmp_path)
    app = web.Application()
    app.router.add_routes(create_wildcard_routes(store))
    return app, store


def _make_constraint_app(tmp_path) -> tuple[web.Application, FileStore]:
    store = FileStore(tmp_path)
    app = web.Application()
    app.router.add_routes(create_constraint_routes(store))
    return app, store


def _make_pipeline_app(tmp_path) -> tuple[web.Application, FileStore]:
    store = FileStore(tmp_path)
    app = web.Application()
    app.router.add_routes(create_pipeline_routes(store))
    return app, store


# -- Wildcard CRUD tests -----------------------------------------------------


@pytest.mark.asyncio
class TestWildcardRoutes:
    @pytest_asyncio.fixture
    async def client(self, tmp_path):
        app, self.store = _make_wildcard_app(tmp_path)
        async with TestClient(TestServer(app)) as client:
            yield client

    async def test_list_empty(self, client):
        resp = await client.get("/wp/api/wildcards")
        assert resp.status == 200
        data = await resp.json()
        assert data == []

    async def test_create_returns_201_with_id(self, client):
        payload = {"name": "location", "options": [{"value": "forest"}]}
        resp = await client.post("/wp/api/wildcards", json=payload)
        assert resp.status == 201
        data = await resp.json()
        assert "id" in data
        assert len(data["id"]) == 8
        assert data["name"] == "location"

    async def test_create_then_list(self, client):
        payload = {"name": "colors", "options": [{"value": "red"}]}
        await client.post("/wp/api/wildcards", json=payload)
        resp = await client.get("/wp/api/wildcards")
        data = await resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "colors"

    async def test_create_duplicate_names_allowed(self, client):
        """UUIDs are always unique — duplicate names are allowed."""
        payload = {"name": "dupe", "options": []}
        r1 = await client.post("/wp/api/wildcards", json=payload)
        r2 = await client.post("/wp/api/wildcards", json=payload)
        assert r1.status == 201
        assert r2.status == 201
        d1 = await r1.json()
        d2 = await r2.json()
        assert d1["id"] != d2["id"]

    async def test_create_missing_fields_returns_400(self, client):
        resp = await client.post("/wp/api/wildcards", json={"name": "no-options"})
        assert resp.status == 400
        data = await resp.json()
        assert "errors" in data

    async def test_create_invalid_json_returns_400(self, client):
        resp = await client.post(
            "/wp/api/wildcards",
            data=b"not json",
            headers={"Content-Type": "application/json"},
        )
        assert resp.status == 400

    async def test_get_existing_by_id(self, client):
        payload = {"name": "test-item", "options": [{"value": "a"}]}
        create_resp = await client.post("/wp/api/wildcards", json=payload)
        created = await create_resp.json()
        item_id = created["id"]

        resp = await client.get(f"/wp/api/wildcards/{item_id}")
        assert resp.status == 200
        data = await resp.json()
        assert data["name"] == "test-item"
        assert data["id"] == item_id

    async def test_get_nonexistent_returns_404(self, client):
        resp = await client.get("/wp/api/wildcards/deadbeef")
        assert resp.status == 404

    async def test_update_existing_by_id(self, client):
        payload = {"name": "updatable", "options": [{"value": "old"}]}
        create_resp = await client.post("/wp/api/wildcards", json=payload)
        item_id = (await create_resp.json())["id"]

        updated = {"name": "updatable", "options": [{"value": "new"}]}
        resp = await client.put(f"/wp/api/wildcards/{item_id}", json=updated)
        assert resp.status == 200
        data = await resp.json()
        assert data["options"][0]["value"] == "new"

    async def test_update_preserves_id(self, client):
        payload = {"name": "item", "options": []}
        create_resp = await client.post("/wp/api/wildcards", json=payload)
        item_id = (await create_resp.json())["id"]

        resp = await client.put(
            f"/wp/api/wildcards/{item_id}",
            json={"name": "renamed", "options": []},
        )
        assert resp.status == 200
        # id is preserved, file path unchanged
        get_resp = await client.get(f"/wp/api/wildcards/{item_id}")
        assert get_resp.status == 200

    async def test_update_nonexistent_returns_404(self, client):
        payload = {"name": "ghost", "options": []}
        resp = await client.put("/wp/api/wildcards/deadbeef", json=payload)
        assert resp.status == 404

    async def test_update_invalid_body_returns_400(self, client):
        payload = {"name": "valid", "options": []}
        create_resp = await client.post("/wp/api/wildcards", json=payload)
        item_id = (await create_resp.json())["id"]
        # Missing "options" field
        resp = await client.put(f"/wp/api/wildcards/{item_id}", json={"name": "valid"})
        assert resp.status == 400

    async def test_delete_existing(self, client):
        payload = {"name": "deletable", "options": []}
        create_resp = await client.post("/wp/api/wildcards", json=payload)
        item_id = (await create_resp.json())["id"]

        resp = await client.delete(f"/wp/api/wildcards/{item_id}")
        assert resp.status == 200
        data = await resp.json()
        assert data["deleted"] == item_id

        # Verify actually deleted
        resp2 = await client.get(f"/wp/api/wildcards/{item_id}")
        assert resp2.status == 404

    async def test_delete_nonexistent_returns_404(self, client):
        resp = await client.delete("/wp/api/wildcards/deadbeef")
        assert resp.status == 404


# -- Constraint CRUD tests ---------------------------------------------------


@pytest.mark.asyncio
class TestConstraintRoutes:
    @pytest_asyncio.fixture
    async def client(self, tmp_path):
        app, self.store = _make_constraint_app(tmp_path)
        async with TestClient(TestServer(app)) as client:
            yield client

    async def test_create_and_get_by_id(self, client):
        payload = {
            "name": "light-rules",
            "rules": [
                {
                    "target": "weather",
                    "when_variable": "lighting",
                    "when_value": "moonlight",
                    "rule_type": "exclusion",
                    "values": ["sunny"],
                }
            ],
        }
        create_resp = await client.post("/wp/api/constraints", json=payload)
        assert create_resp.status == 201
        item_id = (await create_resp.json())["id"]

        resp = await client.get(f"/wp/api/constraints/{item_id}")
        assert resp.status == 200
        data = await resp.json()
        assert data["name"] == "light-rules"
        assert len(data["rules"]) == 1
        assert data["rules"][0]["target"] == "weather"

    async def test_create_missing_rules_returns_400(self, client):
        resp = await client.post("/wp/api/constraints", json={"name": "bad"})
        assert resp.status == 400

    async def test_create_rule_missing_required_fields_returns_400(self, client):
        payload = {
            "name": "bad-rule",
            "rules": [{"rule_type": "exclusion", "values": ["x"]}],
        }
        resp = await client.post("/wp/api/constraints", json=payload)
        assert resp.status == 400
        data = await resp.json()
        assert "errors" in data

    async def test_list_and_delete_by_id(self, client):
        payload = {
            "name": "temp-rule",
            "rules": [
                {
                    "target": "x",
                    "when_variable": "v",
                    "when_value": "t",
                    "rule_type": "exclusion",
                    "values": [],
                }
            ],
        }
        create_resp = await client.post("/wp/api/constraints", json=payload)
        item_id = (await create_resp.json())["id"]

        list_resp = await client.get("/wp/api/constraints")
        assert len(await list_resp.json()) == 1

        del_resp = await client.delete(f"/wp/api/constraints/{item_id}")
        assert del_resp.status == 200
        assert (await del_resp.json())["deleted"] == item_id

        list_resp2 = await client.get("/wp/api/constraints")
        assert len(await list_resp2.json()) == 0

    async def test_update_constraint(self, client):
        payload = {
            "name": "initial",
            "rules": [
                {
                    "target": "x",
                    "when_variable": "v",
                    "when_value": "old",
                    "rule_type": "exclusion",
                    "values": [],
                }
            ],
        }
        create_resp = await client.post("/wp/api/constraints", json=payload)
        item_id = (await create_resp.json())["id"]

        updated = {
            "name": "updated",
            "rules": [
                {
                    "target": "y",
                    "when_variable": "v",
                    "when_value": "new",
                    "rule_type": "weight_bias",
                    "values": ["a"],
                    "multiplier": 2.0,
                }
            ],
        }
        resp = await client.put(f"/wp/api/constraints/{item_id}", json=updated)
        assert resp.status == 200

        get_resp = await client.get(f"/wp/api/constraints/{item_id}")
        data = await get_resp.json()
        assert data["name"] == "updated"
        assert data["rules"][0]["target"] == "y"


# -- Pipeline CRUD tests -----------------------------------------------------


@pytest.mark.asyncio
class TestPipelineRoutes:
    @pytest_asyncio.fixture
    async def client(self, tmp_path):
        app, self.store = _make_pipeline_app(tmp_path)
        async with TestClient(TestServer(app)) as client:
            yield client

    async def test_create_and_get_by_id(self, client):
        payload = {
            "name": "env-pipeline",
            "modules": [
                {
                    "type": "wildcard",
                    "source": "location.json",
                    "capture_as": "$location",
                }
            ],
        }
        create_resp = await client.post("/wp/api/pipelines", json=payload)
        assert create_resp.status == 201
        item_id = (await create_resp.json())["id"]

        resp = await client.get(f"/wp/api/pipelines/{item_id}")
        assert resp.status == 200
        data = await resp.json()
        assert data["name"] == "env-pipeline"
        assert len(data["modules"]) == 1

    async def test_create_missing_modules_returns_400(self, client):
        resp = await client.post("/wp/api/pipelines", json={"name": "bad"})
        assert resp.status == 400

    async def test_update_pipeline_by_id(self, client):
        payload = {"name": "mypipe", "modules": []}
        create_resp = await client.post("/wp/api/pipelines", json=payload)
        item_id = (await create_resp.json())["id"]

        updated = {
            "name": "mypipe",
            "modules": [{"type": "fixed", "value": "hello", "capture_as": "$greet"}],
        }
        resp = await client.put(f"/wp/api/pipelines/{item_id}", json=updated)
        assert resp.status == 200
        data = await resp.json()
        assert len(data["modules"]) == 1

    async def test_delete_pipeline(self, client):
        payload = {"name": "to-delete", "modules": []}
        create_resp = await client.post("/wp/api/pipelines", json=payload)
        item_id = (await create_resp.json())["id"]

        del_resp = await client.delete(f"/wp/api/pipelines/{item_id}")
        assert del_resp.status == 200
        assert (await del_resp.json())["deleted"] == item_id


# -- Validation tests --------------------------------------------------------


@pytest.mark.asyncio
class TestValidation:
    @pytest_asyncio.fixture
    async def client(self, tmp_path):
        app, _ = _make_wildcard_app(tmp_path)
        async with TestClient(TestServer(app)) as client:
            yield client

    async def test_options_must_be_array(self, client):
        resp = await client.post(
            "/wp/api/wildcards",
            json={"name": "bad", "options": "not-an-array"},
        )
        assert resp.status == 400
        data = await resp.json()
        assert any("array" in e for e in data["errors"])

    async def test_body_must_be_object(self, client):
        resp = await client.post(
            "/wp/api/wildcards",
            data=json.dumps([1, 2, 3]),
            headers={"Content-Type": "application/json"},
        )
        assert resp.status == 400

    async def test_tags_must_be_array(self, client):
        resp = await client.post(
            "/wp/api/wildcards",
            json={"name": "x", "options": [], "tags": "not-list"},
        )
        assert resp.status == 400
        data = await resp.json()
        assert any("tags" in e for e in data["errors"])

    async def test_constraint_invalid_rule_type_returns_400(self, client_constraint):
        resp = await client_constraint.post(
            "/wp/api/constraints",
            json={
                "name": "bad-type",
                "rules": [
                    {
                        "target": "x",
                        "when_variable": "v",
                        "when_value": "t",
                        "rule_type": "invalid_type",
                        "values": [],
                    }
                ],
            },
        )
        assert resp.status == 400

    @pytest_asyncio.fixture
    async def client_constraint(self, tmp_path):
        app, _ = _make_constraint_app(tmp_path)
        async with TestClient(TestServer(app)) as client:
            yield client


# -- Preview route tests ------------------------------------------------------

from api.routes.preview import create_preview_routes


def _make_preview_app() -> web.Application:
    app = web.Application()
    app.router.add_routes(create_preview_routes())
    return app


@pytest.mark.asyncio
class TestPreviewRoute:
    @pytest_asyncio.fixture
    async def client(self):
        app = _make_preview_app()
        async with TestClient(TestServer(app)) as client:
            yield client

    async def test_fixed_module(self, client):
        resp = await client.post(
            "/wp/api/preview",
            json={
                "modules": [
                    {"type": "fixed", "value": "hello", "capture_as": "greeting"}
                ],
                "seed": 42,
            },
        )
        assert resp.status == 200
        data = await resp.json()
        assert data["variables"]["greeting"] == "hello"

    async def test_wildcard_module_deterministic(self, client):
        resp = await client.post(
            "/wp/api/preview",
            json={
                "modules": [
                    {
                        "type": "wildcard",
                        "capture_as": "color",
                        "options": [
                            {"value": "red", "weight": 1},
                            {"value": "blue", "weight": 1},
                            {"value": "green", "weight": 1},
                        ],
                    }
                ],
                "seed": 42,
            },
        )
        assert resp.status == 200
        data = await resp.json()
        assert data["variables"]["color"] in ("red", "blue", "green")

        resp2 = await client.post(
            "/wp/api/preview",
            json={
                "modules": [
                    {
                        "type": "wildcard",
                        "capture_as": "color",
                        "options": [
                            {"value": "red", "weight": 1},
                            {"value": "blue", "weight": 1},
                            {"value": "green", "weight": 1},
                        ],
                    }
                ],
                "seed": 42,
            },
        )
        data2 = await resp2.json()
        assert data["variables"]["color"] == data2["variables"]["color"]

    async def test_internal_keys_stripped(self, client):
        resp = await client.post(
            "/wp/api/preview",
            json={
                "modules": [
                    {"type": "fixed", "value": "v", "capture_as": "x"},
                    {
                        "type": "constrain",
                        "rules": [
                            {
                                "when_variable": "x",
                                "when_value": "v",
                                "rule_type": "exclusion",
                                "values": [],
                                "target": "y",
                            }
                        ],
                    },
                ],
                "seed": 42,
            },
        )
        assert resp.status == 200
        data = await resp.json()
        assert "__constraints__" not in data["variables"]

    async def test_empty_modules(self, client):
        resp = await client.post(
            "/wp/api/preview",
            json={"modules": [], "seed": 42},
        )
        assert resp.status == 200
        data = await resp.json()
        assert data["variables"] == {}

    async def test_invalid_json(self, client):
        resp = await client.post(
            "/wp/api/preview",
            data=b"not json",
            headers={"Content-Type": "application/json"},
        )
        assert resp.status == 400

    async def test_invalid_modules_type(self, client):
        resp = await client.post(
            "/wp/api/preview",
            json={"modules": "not a list", "seed": 42},
        )
        assert resp.status == 400

    async def test_wildcard_seed_is_used_for_selection(self, client):
        options = [{"value": str(i), "weight": 1} for i in range(20)]
        payload = {
            "modules": [{"type": "wildcard", "capture_as": "x", "options": options}]
        }

        r1 = await client.post("/wp/api/preview", json={**payload, "seed": 1})
        r2 = await client.post("/wp/api/preview", json={**payload, "seed": 1})
        d1, d2 = await r1.json(), await r2.json()
        assert d1["variables"]["x"] == d2["variables"]["x"]

        picks = set()
        for s in range(10):
            r = await client.post("/wp/api/preview", json={**payload, "seed": s})
            d = await r.json()
            picks.add(d["variables"]["x"])
        assert len(picks) > 1, (
            "All seeds produced the same wildcard pick — seed is not wired"
        )

    async def test_preview_internal_var_not_in_response_variables(self, client):
        resp = await client.post(
            "/wp/api/preview",
            json={
                "modules": [
                    {
                        "type": "wildcard",
                        "capture_as": "secret_var",
                        "internal": True,
                        "options": [{"value": "hidden_value", "weight": 1}],
                    },
                    {
                        "type": "fixed",
                        "value": "visible_value",
                        "capture_as": "public_var",
                    },
                ],
                "seed": 42,
            },
        )
        assert resp.status == 200
        data = await resp.json()
        variables = data["variables"]
        assert "secret_var" not in variables
        assert "public_var" in variables
        assert variables["public_var"] == "visible_value"
