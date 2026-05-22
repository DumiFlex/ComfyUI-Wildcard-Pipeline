"""ModuleRepository.create/update stamps snapshot_fingerprint automatically."""
from engine._fingerprint import module_fingerprint
from engine.db.repositories import ModuleRepository
from engine.modules.snapshot import payload_hash


def test_create_stamps_fingerprint(db_conn):
    repo = ModuleRepository(db_conn)
    payload = {"options": [{"id": "r", "value": "red", "weight": 1}]}
    m = repo.create(
        type="wildcard",
        name="color",
        description="Basic colors",
        category_id=None,
        tags=["palette"],
        payload=payload,
    )
    fetched = repo.get(m["id"])
    # Compute expected independently from the inputs we passed to create().
    expected = module_fingerprint({
        "type": "wildcard",
        "name": "color",
        "description": "Basic colors",
        "tags": ["palette"],
        "payload_hash": payload_hash(payload),
    })
    assert fetched["snapshot_fingerprint"] == expected


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


def test_update_name_only_changes_fingerprint(db_conn):
    """Sanity guard against accidentally dropping payload_hash from the
    update fp inputs: a name-only update should still produce a different
    fingerprint."""
    repo = ModuleRepository(db_conn)
    m = repo.create(
        type="wildcard", name="original", description="", category_id=None,
        tags=[], payload={"options": [{"id": "r", "value": "red", "weight": 1}]},
    )
    fp_before = repo.get(m["id"])["snapshot_fingerprint"]
    repo.update(m["id"], name="renamed")
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
    cases = [
        ("wildcard", {"options": [{"id": "r", "value": "red", "weight": 1}]}),
        ("fixed_values", {"values": [{"name": "v", "value": "x"}]}),
        ("combine", {"template": "$a", "output_var": "out"}),
        ("derivation", {"rules": [{"id": "r1", "branches": [
            {"key": "default", "actions": []},
        ]}]}),
        ("constraint", {
            "source_wildcard_id": "s",
            "target_wildcard_id": "t",
            "matrix": {},
            "exceptions": [],
        }),
    ]
    for type_, payload in cases:
        m = repo.create(
            type=type_, name=f"{type_}_test", description="",
            category_id=None, tags=[], payload=payload,
        )
        fetched = repo.get(m["id"])
        expected = module_fingerprint({
            "type": type_,
            "name": f"{type_}_test",
            "description": "",
            "tags": [],
            "payload_hash": payload_hash(payload),
        })
        assert fetched["snapshot_fingerprint"] == expected, \
            f"{type_} fingerprint mismatch"
