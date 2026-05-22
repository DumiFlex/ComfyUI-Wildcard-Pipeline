"""ModuleRepository.create/update stamps snapshot_fingerprint automatically."""
from engine._fingerprint import module_fingerprint
from engine.db.repositories import ModuleRepository


def _expected_fp(row: dict) -> str:
    """Build the fingerprint input from the row as `module_fingerprint` reads it.

    Note: `module_fingerprint` reads `payload_hash` from the row. Repository
    `_row_to_module()` injects `payload_hash` into the returned dict, so the
    fetched row + helper compose cleanly.
    """
    return module_fingerprint(row)


def test_create_stamps_fingerprint(db_conn):
    repo = ModuleRepository(db_conn)
    m = repo.create(
        type="wildcard",
        name="color",
        description="Basic colors",
        category_id=None,
        tags=["palette"],
        payload={"options": [{"id": "r", "value": "red", "weight": 1}]},
    )
    fetched = repo.get(m["id"])
    assert fetched["snapshot_fingerprint"] == _expected_fp(fetched)


def test_update_recomputes_fingerprint(db_conn):
    repo = ModuleRepository(db_conn)
    m = repo.create(
        type="wildcard", name="color", description="", category_id=None,
        tags=[], payload={"options": [{"id": "r", "value": "red", "weight": 1}]},
    )
    fp_before = repo.get(m["id"])["snapshot_fingerprint"]
    repo.update(m["id"], payload={"options": [{"id": "r", "value": "blue", "weight": 1}]})
    fp_after = repo.get(m["id"])["snapshot_fingerprint"]
    assert fp_before != fp_after


def test_fingerprint_stable_under_no_change(db_conn):
    repo = ModuleRepository(db_conn)
    m = repo.create(
        type="combine", name="x", description="", category_id=None,
        tags=[], payload={"template": "$a", "output_var": "out"},
    )
    fp_before = repo.get(m["id"])["snapshot_fingerprint"]
    repo.update(m["id"], payload={"template": "$a", "output_var": "out"})
    fp_after = repo.get(m["id"])["snapshot_fingerprint"]
    assert fp_before == fp_after


def test_create_works_for_all_module_types(db_conn):
    repo = ModuleRepository(db_conn)
    for type_, payload in [
        ("wildcard",     {"options": [{"id": "r", "value": "red", "weight": 1}]}),
        ("fixed_values", {"values": [{"name": "v", "value": "x"}]}),
        ("combine",      {"template": "$a", "output_var": "out"}),
        ("derivation",   {
            "rules": [{"id": "r1", "branches": [{"key": "default", "actions": []}]}],
        }),
        ("constraint",   {
            "source_wildcard_id": "s", "target_wildcard_id": "t",
            "matrix": {}, "exceptions": [],
        }),
    ]:
        m = repo.create(
            type=type_, name=f"{type_}_test", description="",
            category_id=None, tags=[], payload=payload,
        )
        fetched = repo.get(m["id"])
        assert fetched["snapshot_fingerprint"] == _expected_fp(fetched), (
            f"{type_} fingerprint mismatch"
        )
