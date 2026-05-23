"""Tests for cascade undo persistence + restore."""
from engine.cascade.undo import undo_cascade, write_undo_entry
from engine.db.repositories import ModuleRepository


def test_write_undo_returns_8_hex_id(wp_db):
    """write_undo_entry returns a generated 8-char hex id."""
    mod = ModuleRepository(wp_db)
    m = mod.create(
        type="wildcard", name="w", description="", category_id=None,
        tags=[], payload={"options": []},
    )
    before = [mod.get(m["id"])]
    undo_id = write_undo_entry(
        wp_db,
        target_kind="wildcard", target_id=m["id"], action="delete",
        snapshot_before=before, snapshot_after=[],
    )
    assert isinstance(undo_id, str)
    assert len(undo_id) == 16  # secrets.token_hex(8) returns 16 chars
    int(undo_id, 16)


def test_write_undo_defaults_none_to_empty_list(wp_db):
    """Passing None for snapshot_after should not trip NOT NULL constraint."""
    undo_id = write_undo_entry(
        wp_db,
        target_kind="wildcard", target_id="11111111", action="delete",
        snapshot_before=[], snapshot_after=None,  # type: ignore
    )
    assert isinstance(undo_id, str)


def test_undo_restores_mutated_module(wp_db):
    """Mutate then undo restores original payload."""
    mod = ModuleRepository(wp_db)
    m = mod.create(
        type="wildcard", name="w", description="", category_id=None,
        tags=[], payload={"options": [{"id": "o", "value": "before", "weight": 1}]},
    )
    before = [mod.get(m["id"])]
    # Mutate to simulate fixer behaviour.
    mod.update(m["id"], payload={"options": [{"id": "o", "value": "after", "weight": 1}]})

    undo_id = write_undo_entry(
        wp_db,
        target_kind="wildcard", target_id=m["id"], action="delete",
        snapshot_before=before, snapshot_after=[mod.get(m["id"])],
    )
    result = undo_cascade(wp_db, undo_id)
    assert result["ok"] is True

    restored = mod.get(m["id"])
    assert restored["payload"]["options"][0]["value"] == "before"


def test_undo_restores_deleted_module(wp_db):
    """Deleted module is re-created with original id + content."""
    mod = ModuleRepository(wp_db)
    m = mod.create(
        type="wildcard", name="w", description="", category_id=None,
        tags=[], payload={"options": []},
    )
    before = [mod.get(m["id"])]
    mod.delete(m["id"])  # Simulate the orchestrator deleting the target.

    undo_id = write_undo_entry(
        wp_db,
        target_kind="wildcard", target_id=m["id"], action="delete",
        snapshot_before=before, snapshot_after=[],
    )
    result = undo_cascade(wp_db, undo_id)
    assert result["ok"] is True

    restored = mod.get(m["id"])
    assert restored["id"] == m["id"]
    assert restored["name"] == "w"


def test_undo_unknown_id_returns_not_found(wp_db):
    """Unknown undo_id surfaces 'not found' in error string."""
    result = undo_cascade(wp_db, "deadbeef0000")
    assert result["ok"] is False
    assert "not found" in result["error"].lower()


def test_undo_clears_row_after_success(wp_db):
    """After undo_cascade returns ok, the undo row is gone."""
    mod = ModuleRepository(wp_db)
    m = mod.create(
        type="wildcard", name="w", description="", category_id=None,
        tags=[], payload={"options": []},
    )
    undo_id = write_undo_entry(
        wp_db,
        target_kind="wildcard", target_id=m["id"], action="delete",
        snapshot_before=[mod.get(m["id"])], snapshot_after=[],
    )
    undo_cascade(wp_db, undo_id)
    # Calling undo a second time should report not found.
    result_again = undo_cascade(wp_db, undo_id)
    assert result_again["ok"] is False
