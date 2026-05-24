"""Tests for ModuleRepository CRUD + filtering."""
import pytest

from engine.db.repositories import ModuleNotFound, ModuleRepository


def _new_payload() -> dict:
    return {"options": [{"id": "opt_1", "value": "red", "weight": 1}]}


def test_create_assigns_id_and_timestamps(wp_db):
    """Post migration 004 every module's `id` is an 8-hex short uuid —
    the slug-prefixed form (`wc_colors_<8hex>`) is gone."""
    repo = ModuleRepository(wp_db)
    row = repo.create(
        type="wildcard", name="colors", description="",
        category_id=None, tags=["a", "b"], payload=_new_payload(),
    )
    assert len(row["id"]) == 8
    assert all(c in "0123456789abcdef" for c in row["id"])
    assert row["version"] == 1
    assert row["created_at"]
    assert row["updated_at"] == row["created_at"]
    assert row["tags"] == ["a", "b"]
    assert row["payload"] == _new_payload()


def test_create_wildcard_backfills_option_ids(wp_db):
    """Wildcard options missing `id` get 8-hex backfilled before insert."""
    repo = ModuleRepository(wp_db)
    row = repo.create(
        type="wildcard", name="t", description="",
        category_id=None, tags=[],
        payload={
            "sub_categories": [],
            "options": [
                {"value": "buzz", "weight": 1, "sub_category": None, "probability": 1.0},
                {"value": "crew", "weight": 1, "sub_category": None, "probability": 1.0},
            ],
        },
    )
    ids = [o["id"] for o in row["payload"]["options"]]
    assert all(isinstance(i, str) and len(i) == 8 for i in ids)
    assert ids[0] != ids[1]


def test_create_wildcard_preserves_existing_option_ids(wp_db):
    """If option already has id, leave it alone."""
    repo = ModuleRepository(wp_db)
    row = repo.create(
        type="wildcard", name="t", description="",
        category_id=None, tags=[],
        payload={
            "sub_categories": [],
            "options": [
                {
                    "id": "deadbeef",
                    "value": "x",
                    "weight": 1,
                    "sub_category": None,
                    "probability": 1.0,
                },
            ],
        },
    )
    assert row["payload"]["options"][0]["id"] == "deadbeef"


def test_update_wildcard_backfills_missing_option_ids(wp_db):
    """Updating a wildcard with options missing `id` backfills them."""
    repo = ModuleRepository(wp_db)
    row = repo.create(
        type="wildcard", name="t", description="",
        category_id=None, tags=[], payload={"sub_categories": [], "options": []},
    )
    repo.update(
        row["id"],
        payload={
            "sub_categories": [],
            "options": [
                {"value": "x", "weight": 1, "sub_category": None, "probability": 1.0}
            ],
        },
    )
    updated = repo.get(row["id"])
    assert "id" in updated["payload"]["options"][0]
    assert len(updated["payload"]["options"][0]["id"]) == 8


def test_get_returns_existing_row(wp_db):
    repo = ModuleRepository(wp_db)
    created = repo.create(
        type="fixed_values", name="lens", description="",
        category_id=None, tags=[], payload={"values": []},
    )
    got = repo.get(created["id"])
    assert got["id"] == created["id"]
    assert got["type"] == "fixed_values"


def test_get_raises_module_not_found(wp_db):
    repo = ModuleRepository(wp_db)
    with pytest.raises(ModuleNotFound):
        repo.get("does_not_exist")


def test_update_bumps_version_and_updated_at(wp_db):
    repo = ModuleRepository(wp_db)
    created = repo.create(
        type="wildcard", name="colors", description="",
        category_id=None, tags=[], payload=_new_payload(),
    )
    updated = repo.update(created["id"], name="palette", payload=_new_payload())
    assert updated["name"] == "palette"
    assert updated["version"] == 2
    assert updated["updated_at"] > created["updated_at"]


def test_delete_removes_row(wp_db):
    repo = ModuleRepository(wp_db)
    created = repo.create(
        type="wildcard", name="x", description="",
        category_id=None, tags=[], payload=_new_payload(),
    )
    repo.delete(created["id"])
    with pytest.raises(ModuleNotFound):
        repo.get(created["id"])


def test_delete_missing_raises(wp_db):
    repo = ModuleRepository(wp_db)
    with pytest.raises(ModuleNotFound):
        repo.delete("ghost")


def test_list_filters_by_type(wp_db):
    repo = ModuleRepository(wp_db)
    repo.create(type="wildcard", name="a", description="",
                category_id=None, tags=[], payload=_new_payload())
    repo.create(type="fixed_values", name="b", description="",
                category_id=None, tags=[], payload={"values": []})
    wcs = repo.list(type="wildcard")
    assert len(wcs) == 1
    assert wcs[0]["type"] == "wildcard"


def test_list_filters_by_category(wp_db):
    wp_db.execute(
        "INSERT INTO module_categories(id, name) VALUES('style', 'Style');"
    )
    wp_db.commit()
    repo = ModuleRepository(wp_db)
    repo.create(type="wildcard", name="a", description="",
                category_id="style", tags=[], payload=_new_payload())
    repo.create(type="wildcard", name="b", description="",
                category_id=None, tags=[], payload=_new_payload())
    rows = repo.list(category_id="style")
    assert len(rows) == 1
    assert rows[0]["name"] == "a"


def test_list_search_matches_name_case_insensitive(wp_db):
    repo = ModuleRepository(wp_db)
    repo.create(type="wildcard", name="ColorPalette", description="",
                category_id=None, tags=[], payload=_new_payload())
    repo.create(type="wildcard", name="lighting", description="",
                category_id=None, tags=[], payload=_new_payload())
    rows = repo.list(query="color")
    assert len(rows) == 1
    assert rows[0]["name"] == "ColorPalette"


def test_list_orders_by_updated_at_desc(wp_db):
    repo = ModuleRepository(wp_db)
    a = repo.create(type="wildcard", name="a", description="",
                    category_id=None, tags=[], payload=_new_payload())
    b = repo.create(type="wildcard", name="b", description="",
                    category_id=None, tags=[], payload=_new_payload())
    rows = repo.list()
    assert [r["id"] for r in rows] == [b["id"], a["id"]]


def test_list_favorites_only(wp_db):
    repo = ModuleRepository(wp_db)
    repo.create(type="wildcard", name="a", description="",
                category_id=None, tags=[], payload=_new_payload(), is_favorite=True)
    repo.create(type="wildcard", name="b", description="",
                category_id=None, tags=[], payload=_new_payload())
    rows = repo.list(favorites_only=True)
    assert len(rows) == 1
    assert rows[0]["name"] == "a"


def test_list_limit_offset(wp_db):
    repo = ModuleRepository(wp_db)
    for n in ["a", "b", "c"]:
        repo.create(type="wildcard", name=n, description="",
                    category_id=None, tags=[], payload=_new_payload())
    rows = repo.list(limit=1, offset=1)
    assert len(rows) == 1
    assert rows[0]["name"] == "b"


def test_update_keeps_unchanged_fields(wp_db):
    repo = ModuleRepository(wp_db)
    created = repo.create(
        type="wildcard", name="x", description="hello",
        category_id=None, tags=["t1"], payload=_new_payload(),
    )
    updated = repo.update(created["id"], name="y")  # only name changes
    assert updated["description"] == "hello"
    assert updated["tags"] == ["t1"]
    assert updated["payload"] == _new_payload()


def test_create_fixed_values_id_is_eight_hex(wp_db):
    """Fixed-values modules used to carry an `fv_<slug>_` prefix; post
    migration 004 they share the same plain 8-hex shape as every other
    kind. Type discrimination lives in the `type` column."""
    repo = ModuleRepository(wp_db)
    row = repo.create(
        type="fixed_values", name="lens", description="",
        category_id=None, tags=[], payload={"values": []},
    )
    assert row["type"] == "fixed_values"
    assert len(row["id"]) == 8
    assert all(c in "0123456789abcdef" for c in row["id"])


def test_list_search_treats_percent_literally(wp_db):
    repo = ModuleRepository(wp_db)
    repo.create(type="wildcard", name="50%_off", description="",
                category_id=None, tags=[], payload=_new_payload())
    repo.create(type="wildcard", name="other", description="",
                category_id=None, tags=[], payload=_new_payload())
    rows = repo.list(query="50%")
    assert len(rows) == 1
    assert rows[0]["name"] == "50%_off"


def test_list_search_treats_underscore_literally(wp_db):
    repo = ModuleRepository(wp_db)
    repo.create(type="wildcard", name="my_module", description="",
                category_id=None, tags=[], payload=_new_payload())
    repo.create(type="wildcard", name="myXmodule", description="",
                category_id=None, tags=[], payload=_new_payload())
    rows = repo.list(query="my_")
    assert len(rows) == 1
    assert rows[0]["name"] == "my_module"


def test_list_offset_without_limit(wp_db):
    repo = ModuleRepository(wp_db)
    for n in ["a", "b", "c"]:
        repo.create(type="wildcard", name=n, description="",
                    category_id=None, tags=[], payload=_new_payload())
    rows = repo.list(offset=1)
    # offset=1 skips the first (most-recent) row → expect 2 rows back
    assert len(rows) == 2


@pytest.mark.parametrize(
    "type_",
    ["combine", "derivation", "constraint"],
)
def test_create_accepts_new_module_types(wp_db, type_):
    """All module kinds get the same 8-hex `id` shape — the type
    discriminator lives in the `type` column, not the id prefix."""
    repo = ModuleRepository(wp_db)
    row = repo.create(
        type=type_, name="thing", description="",
        category_id=None, tags=[], payload={},
    )
    assert row["type"] == type_
    assert len(row["id"]) == 8
    assert all(c in "0123456789abcdef" for c in row["id"])


def test_create_rejects_unknown_type(wp_db):
    repo = ModuleRepository(wp_db)
    with pytest.raises(ValueError, match="unknown module type"):
        repo.create(
            type="bogus", name="x", description="",
            category_id=None, tags=[], payload={},
        )


def test_create_id_is_eight_hex(wp_db):
    """create() generates ids that are exactly 8 hex chars — the
    canonical short uuid the tokenizer's `@{8hex}` ref captures.
    Migration 004 dropped the slug-prefixed form."""
    repo = ModuleRepository(wp_db)
    row = repo.create(
        type="wildcard", name="color", description="",
        category_id=None, tags=[], payload={"options": []},
    )
    assert len(row["id"]) == 8
    assert all(c in "0123456789abcdef" for c in row["id"])
    # No separate uuid field — id IS the uuid.
    assert "uuid" not in row


def test_row_to_module_includes_payload_hash(wp_db):
    """API responses (and drift detection) need payload_hash on every row.
    Sourced from engine.modules.snapshot.payload_hash so drift comparison
    is bit-identical to embedded snapshot hashes."""
    repo = ModuleRepository(wp_db)
    row = repo.create(
        type="wildcard", name="x", description="",
        category_id=None, tags=[], payload={"options": [{"value": "a"}]},
    )
    assert "payload_hash" in row
    # 64-char SHA-256 hex
    assert len(row["payload_hash"]) == 64
    assert all(c in "0123456789abcdef" for c in row["payload_hash"])


def test_get_by_uuid_alias_returns_row(wp_db):
    """`get_by_uuid` is a back-compat alias for `get` — `id IS uuid`
    after migration 004."""
    repo = ModuleRepository(wp_db)
    created = repo.create(
        type="wildcard", name="color", description="",
        category_id=None, tags=[], payload={"options": []},
    )
    fetched = repo.get_by_uuid(created["id"])
    assert fetched["id"] == created["id"]


def test_get_by_uuid_alias_raises_when_missing(wp_db):
    repo = ModuleRepository(wp_db)
    with pytest.raises(ModuleNotFound):
        repo.get_by_uuid("00000000")


def test_get_many_dedups_and_skips_missing(wp_db):
    """Bulk lookup feeds the embed-bundle endpoint and the test-runner
    lazy catalog. Returns rows in the same order callers passed ids in;
    missing ids are silently skipped (caller decides how to surface)."""
    repo = ModuleRepository(wp_db)
    a = repo.create(type="wildcard", name="a", description="",
                   category_id=None, tags=[], payload={"options": []})
    b = repo.create(type="wildcard", name="b", description="",
                   category_id=None, tags=[], payload={"options": []})
    rows = repo.get_many([a["id"], "deadbeef", b["id"], a["id"]])
    # Dedups (returns each id at most once), skips missing
    assert len(rows) == 2
    found = {r["id"] for r in rows}
    assert found == {a["id"], b["id"]}


def test_get_many_empty_input_returns_empty_list(wp_db):
    repo = ModuleRepository(wp_db)
    assert repo.get_many([]) == []


def test_get_many_returns_rows_in_input_order(wp_db):
    """The docstring promises input-order preservation. SQLite's IN
    predicate makes no order guarantee, so the implementation must
    re-order results against the (deduped) input list. Pin that
    contract explicitly so a future contributor doesn't drop the
    re-order step thinking it's redundant."""
    repo = ModuleRepository(wp_db)
    rows = []
    for n in ("alpha", "bravo", "charlie", "delta"):
        rows.append(repo.create(
            type="wildcard", name=n, description="",
            category_id=None, tags=[], payload={"options": []},
        ))
    requested = [rows[3]["id"], rows[1]["id"], rows[2]["id"], rows[0]["id"]]
    fetched = repo.get_many(requested)
    assert [r["id"] for r in fetched] == requested
