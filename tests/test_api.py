"""Tests for the API CRUD routes and server setup.

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


def _make_app(tmp_path) -> tuple[web.Application, FileStore]:
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
        app, self.store = _make_app(tmp_path)
        async with TestClient(TestServer(app)) as client:
            yield client

    async def test_list_empty(self, client):
        resp = await client.get("/wp/api/wildcards")
        assert resp.status == 200
        data = await resp.json()
        assert data == []

    async def test_create(self, client):
        payload = {"name": "location", "options": [{"value": "forest"}]}
        resp = await client.post("/wp/api/wildcards", json=payload)
        assert resp.status == 201
        data = await resp.json()
        assert data["name"] == "location"

    async def test_create_then_list(self, client):
        payload = {"name": "colors", "options": [{"value": "red"}]}
        await client.post("/wp/api/wildcards", json=payload)
        resp = await client.get("/wp/api/wildcards")
        data = await resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "colors"

    async def test_create_duplicate_returns_409(self, client):
        payload = {"name": "dupe", "options": []}
        await client.post("/wp/api/wildcards", json=payload)
        resp = await client.post("/wp/api/wildcards", json=payload)
        assert resp.status == 409

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

    async def test_get_existing(self, client):
        payload = {"name": "test-item", "options": [{"value": "a"}]}
        await client.post("/wp/api/wildcards", json=payload)
        resp = await client.get("/wp/api/wildcards/test-item")
        assert resp.status == 200
        data = await resp.json()
        assert data["name"] == "test-item"

    async def test_get_nonexistent_returns_404(self, client):
        resp = await client.get("/wp/api/wildcards/nonexistent")
        assert resp.status == 404

    async def test_update_existing(self, client):
        payload = {"name": "updatable", "options": [{"value": "old"}]}
        await client.post("/wp/api/wildcards", json=payload)
        updated = {"name": "updatable", "options": [{"value": "new"}]}
        resp = await client.put("/wp/api/wildcards/updatable", json=updated)
        assert resp.status == 200
        data = await resp.json()
        assert data["options"][0]["value"] == "new"

    async def test_update_nonexistent_returns_404(self, client):
        payload = {"name": "ghost", "options": []}
        resp = await client.put("/wp/api/wildcards/ghost", json=payload)
        assert resp.status == 404

    async def test_update_invalid_body_returns_400(self, client):
        self.store.create({"name": "valid", "options": []})
        resp = await client.put("/wp/api/wildcards/valid", json={"name": "valid"})
        assert resp.status == 400

    async def test_delete_existing(self, client):
        payload = {"name": "deletable", "options": []}
        await client.post("/wp/api/wildcards", json=payload)
        resp = await client.delete("/wp/api/wildcards/deletable")
        assert resp.status == 200
        data = await resp.json()
        assert data["deleted"] == "deletable"
        # Verify actually deleted
        resp2 = await client.get("/wp/api/wildcards/deletable")
        assert resp2.status == 404

    async def test_delete_nonexistent_returns_404(self, client):
        resp = await client.delete("/wp/api/wildcards/nope")
        assert resp.status == 404


# -- Constraint CRUD tests (verify same pattern works) ------------------------


@pytest.mark.asyncio
class TestConstraintRoutes:
    @pytest_asyncio.fixture
    async def client(self, tmp_path):
        app, _ = _make_constraint_app(tmp_path)
        async with TestClient(TestServer(app)) as client:
            yield client

    async def test_create_and_get(self, client):
        payload = {
            "name": "light-rules",
            "rules": [
                {
                    "when_value": "moonlight",
                    "rule_type": "exclusion",
                    "values": ["sunny"],
                }
            ],
        }
        resp = await client.post("/wp/api/constraints", json=payload)
        assert resp.status == 201

        resp = await client.get("/wp/api/constraints/light-rules")
        assert resp.status == 200
        data = await resp.json()
        assert data["name"] == "light-rules"
        assert len(data["rules"]) == 1

    async def test_create_missing_rules_returns_400(self, client):
        resp = await client.post("/wp/api/constraints", json={"name": "bad"})
        assert resp.status == 400

    async def test_list_and_delete(self, client):
        payload = {"name": "temp-rule", "rules": []}
        await client.post("/wp/api/constraints", json=payload)
        resp = await client.get("/wp/api/constraints")
        assert len(await resp.json()) == 1

        await client.delete("/wp/api/constraints/temp-rule")
        resp = await client.get("/wp/api/constraints")
        assert len(await resp.json()) == 0


# -- Pipeline CRUD tests (verify same pattern works) --------------------------


@pytest.mark.asyncio
class TestPipelineRoutes:
    @pytest_asyncio.fixture
    async def client(self, tmp_path):
        app, _ = _make_pipeline_app(tmp_path)
        async with TestClient(TestServer(app)) as client:
            yield client

    async def test_create_and_get(self, client):
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
        resp = await client.post("/wp/api/pipelines", json=payload)
        assert resp.status == 201

        resp = await client.get("/wp/api/pipelines/env-pipeline")
        assert resp.status == 200
        data = await resp.json()
        assert data["name"] == "env-pipeline"
        assert len(data["modules"]) == 1

    async def test_create_missing_modules_returns_400(self, client):
        resp = await client.post("/wp/api/pipelines", json={"name": "bad"})
        assert resp.status == 400

    async def test_update_pipeline(self, client):
        payload = {"name": "mypipe", "modules": []}
        await client.post("/wp/api/pipelines", json=payload)
        updated = {
            "name": "mypipe",
            "modules": [{"type": "fixed", "value": "hello", "capture_as": "$greet"}],
        }
        resp = await client.put("/wp/api/pipelines/mypipe", json=updated)
        assert resp.status == 200
        data = await resp.json()
        assert len(data["modules"]) == 1


# -- Validation tests ---------------------------------------------------------


@pytest.mark.asyncio
class TestValidation:
    @pytest_asyncio.fixture
    async def client(self, tmp_path):
        app, _ = _make_app(tmp_path)
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
