"""ScenarioRepository — CRUD for saved Test Runner scenarios."""
import pytest

from engine.db.connection import get_connection
from engine.db.migrations import migrate
from engine.db.repositories import ScenarioNotFound, ScenarioRepository


@pytest.fixture
def repo(tmp_path):
    conn = get_connection(tmp_path / "r.db")
    migrate(conn)
    yield ScenarioRepository(conn)
    conn.close()


def test_create_round_trips_every_field(repo):
    row = repo.create(
        name="Portrait", description="d", is_pinned=True,
        stack=[{"module": "aaaa1111"}, {"bundle": "bbbb2222", "enabled": False}],
        pins={"camera": "35mm"}, seeds={"from": 5, "count": 20},
        output_var="scene", baseline={"variables": {}}, last_run={"runs": 20},
    )
    assert len(row["id"]) == 8
    assert repo.get(row["id"]) == row
    assert row["stack"][1] == {"bundle": "bbbb2222", "enabled": False}
    assert row["is_pinned"] is True


def test_create_defaults(repo):
    row = repo.create(name="x")
    assert row["stack"] == [] and row["pins"] == {}
    assert row["seeds"] == {"from": 0, "count": 100}
    assert row["baseline"] is None and row["output_var"] is None


def test_update_patches_and_clears(repo):
    row = repo.create(name="x", baseline={"a": 1}, output_var="p")
    updated = repo.update(row["id"], name="y", baseline=None, output_var=None)
    assert updated["name"] == "y"
    assert updated["baseline"] is None and updated["output_var"] is None
    with pytest.raises(TypeError):
        repo.update(row["id"], nope=1)


def test_list_orders_pinned_first_and_filters(repo):
    a = repo.create(name="Alpha")
    b = repo.create(name="beta", is_pinned=True)
    repo.update(a["id"], description="touched")  # newest, but not pinned
    assert [s["name"] for s in repo.list()] == ["beta", "Alpha"]
    assert [s["name"] for s in repo.list(query="ALP")] == ["Alpha"]
    assert repo.list(query="%") == []
    assert b["id"] in {s["id"] for s in repo.list()}


def test_using_finds_references(repo):
    a = repo.create(name="a", stack=[{"module": "aaaa1111"}])
    repo.create(name="b", stack=[{"bundle": "aaaa1111"}])
    assert repo.using(module_id="aaaa1111") == [a["id"]]
    assert len(repo.using(bundle_id="aaaa1111")) == 1
    assert repo.using() == []


def test_missing_ids_raise(repo):
    with pytest.raises(ScenarioNotFound):
        repo.get("00000000")
    with pytest.raises(ScenarioNotFound):
        repo.update("00000000", name="x")
    with pytest.raises(ScenarioNotFound):
        repo.delete("00000000")
