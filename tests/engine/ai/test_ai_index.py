import pytest

from engine.ai import index as ai_index

pytestmark = pytest.mark.skipif(not ai_index.has_fts5(), reason="SQLite without FTS5")


def wc(id_, name, var, opts, *, tags=(), desc="", updated="2026-10-01"):
    return {"id": id_, "type": "wildcard", "name": name, "tags": list(tags),
            "description": desc, "updated_at": updated,
            "payload": {"var_binding": var, "options": [
                {"id": f"o{i}", "value": v} for i, v in enumerate(opts)]}}


def kind_of(row):
    return "bundle" if "children" in row else row.get("type", "module")


HAIR = wc("aaaa0001", "Hair Color", "hair", ["blonde hair", "black hair", "red hair"],
          tags=["character"])
WEATHER = wc("aaaa0002", "Weather", "weather", ["rain", "snow", "sunny skies"])
DRESS = wc("aaaa0003", "Outfits", "outfit", ["crimson silk dress", "leather armor"])
COMBINE = {"id": "aaaa0004", "type": "combine", "name": "Character", "tags": [],
           "updated_at": "2026-10-01",
           "payload": {"output_var": "character", "template": "$hair, wearing $outfit"}}
CONSTRAINT = {"id": "aaaa0005", "type": "constraint", "name": "No armor in rain",
              "tags": [], "updated_at": "2026-10-01",
              "payload": {"source_wildcard_id": "aaaa0002", "target_wildcard_id": "aaaa0003"}}
BUNDLE = {"id": "bbbb0001", "name": "Portrait", "tags": [], "updated_at": "2026-10-01",
          "children": [{"id": "aaaa0001", "name": "Hair Color"}, {"id": "aaaa0003",
                                                                 "name": "Outfits"}]}
ROWS = [HAIR, WEATHER, DRESS, COMBINE, CONSTRAINT, BUNDLE]


@pytest.fixture
def idx():
    i = ai_index.open_index(None)
    i.sync(ROWS, kind_of)
    yield i
    i.close()


def test_search_ranks_names_and_options(idx):
    hits = idx.search("hair")
    assert hits[0].id == "aaaa0001"
    assert hits[0].strong
    assert "blonde hair" in hits[0].snippets
    dress = idx.search("silk dress")
    assert dress[0].id == "aaaa0003" and not dress[0].strong
    assert dress[0].snippets == ["crimson silk dress"]


def test_search_widens_broad_subjects(idx):
    # "character" widens to hair, outfit, …: the combine named Character
    # wins, the wildcards about hair and outfits still come up.
    ids = [h.id for h in idx.search("characters")]
    assert ids[0] == "aaaa0004"
    assert "aaaa0001" in ids and "aaaa0003" in ids


def test_search_filters_kinds(idx):
    assert [h.kind for h in idx.search("hair", kinds={"combine"})] == ["combine"]


def test_facts_say_what_uses_an_item(idx):
    f = idx.facts("aaaa0003")
    assert f["options"] == 2 and f["var"] == "outfit"
    used = " ".join(f["used_by"])
    assert "Character (aaaa0004, combine)" in used
    assert "No armor in rain (aaaa0005, constraint)" in used
    assert f["in_bundles"] == ["Portrait (bbbb0001)"]
    line = ai_index.facts_line("aaaa0003", f)
    assert line.startswith("Outfits (aaaa0003, wildcard, $outfit, 2 options): ")
    assert "e.g. crimson silk dress | leather armor" in line
    assert ai_index.facts_line("aaaa0003", f, full=False) == \
        "Outfits (aaaa0003, wildcard, $outfit, 2 options)"


def test_sync_only_touches_what_changed(idx):
    assert idx.sync(ROWS, kind_of) == {"added": 0, "changed": 0, "removed": 0}
    hair2 = dict(HAIR, updated_at="2026-10-02",
                 payload={"var_binding": "hair", "options": [{"id": "x", "value": "silver hair"}]})
    new = wc("aaaa0009", "Moods", "mood", ["happy"])
    stats = idx.sync([hair2, WEATHER, DRESS, COMBINE, BUNDLE, new], kind_of)
    assert stats == {"added": 1, "changed": 1, "removed": 1}
    assert idx.search("silver")[0].id == "aaaa0001"
    assert idx.search("blonde") == []
    assert idx.facts("aaaa0005") is None
    assert "constraint" not in " ".join(idx.facts("aaaa0002").get("used_by", []))


def test_retrieve_is_gated(idx):
    block, ids = ai_index.retrieve(idx, "add more hair colors please", seen=set(),
                                   limit=4, full=True)
    assert ids[0] == "aaaa0001"
    assert block.startswith("Possibly relevant items")
    assert "Hair Color (aaaa0001, wildcard, $hair, 3 options)" in block
    # Already shown in this chat: not again.
    assert ai_index.retrieve(idx, "more hair colors", seen={"aaaa0001", "aaaa0004"},
                             limit=4, full=True)[1] == []
    # Replies and request-only words find nothing.
    for msg in ("yes", "ok do it", "make me a new wildcard please", ""):
        assert ai_index.retrieve(idx, msg, seen=set(), limit=4, full=True) == ("", [])
    # Names only for large models.
    short, _ = ai_index.retrieve(idx, "weather", seen=set(), limit=4, full=False)
    assert short.splitlines()[1] == "- Weather (aaaa0002, wildcard, $weather, 3 options)"


def test_index_file_survives_and_rebuilds_on_format_change(tmp_path, monkeypatch):
    path = ai_index.index_path(tmp_path / "wildcard-pipeline.db")
    assert path.name == ai_index.INDEX_FILENAME
    i = ai_index.open_index(path)
    i.sync(ROWS, kind_of)
    i.close()
    i = ai_index.open_index(path)
    assert i.count() == len(ROWS)
    i.close()
    monkeypatch.setattr(ai_index, "FORMAT", ai_index.FORMAT + 1)
    i = ai_index.open_index(path)
    assert i.count() == 0
    i.close()


def test_broken_index_file_is_replaced(tmp_path):
    path = tmp_path / ai_index.INDEX_FILENAME
    path.write_bytes(b"not a database at all" * 100)
    i = ai_index.open_index(path)
    assert i is not None
    i.sync(ROWS, kind_of)
    assert i.search("weather")[0].id == "aaaa0002"
    i.close()


def test_odd_queries_do_not_raise(idx):
    for q in ('"', "AND OR NOT", "near(", "*", "hair:", "{name}: x", "日本語"):
        idx.search(q)


def _vec(*xs):
    return [float(x) for x in xs]


def test_vectors_fuse_with_keywords(idx):
    model = "emb"
    todo = idx.embed_todo(model, 100)
    assert len(todo) == len(ROWS)
    text = dict((i, t) for i, _s, t in todo)
    assert text["aaaa0003"].startswith("wildcard: Outfits. variable outfit")
    assert "options: crimson silk dress, leather armor" in text["aaaa0003"]
    space = {"aaaa0001": _vec(1, 0, 0), "aaaa0002": _vec(0, 1, 0), "aaaa0003": _vec(0, 0, 1)}
    idx.put_vectors(model, [(i, s, space.get(i, _vec(0.1, 0.1, 0.1))) for i, s, _t in todo])
    assert idx.vector_count(model) == len(ROWS)
    assert idx.embed_todo(model, 100) == []
    # "warm clothes" has no keyword in the library; its vector sits near Outfits.
    hits = idx.search("warm clothes", qvec=_vec(0.1, 0, 0.9), model=model)
    assert hits[0].id == "aaaa0003" and hits[0].cosine > 0.9
    block, ids = ai_index.retrieve(idx, "warm clothes", seen=set(), limit=4, full=True,
                                   qvec=_vec(0.1, 0, 0.9), model=model)
    assert ids == ["aaaa0003"]
    # A changed item needs a new vector; another model's vectors don't count.
    assert idx.embed_todo("other", 100) and idx.vector_count("other") == 0
    hair2 = dict(HAIR, updated_at="2026-10-05")
    idx.sync([hair2, *ROWS[1:]], kind_of)
    assert [i for i, _s, _t in idx.embed_todo(model, 100)] == ["aaaa0001"]


def test_meaning_only_hits_need_to_be_close(idx):
    model = "emb"
    todo = idx.embed_todo(model, 100)
    idx.put_vectors(model, [(i, s, _vec(1, 0) if i == "aaaa0002" else _vec(0, 1))
                            for i, s, _t in todo])
    # Far from everything: nothing handed over.
    assert ai_index.retrieve(idx, "spaceships", seen=set(), limit=4, full=True,
                             qvec=_vec(0.3, -1), model=model) == ("", [])


def test_cosine_without_numpy(monkeypatch):
    import sys

    blobs = [ai_index._pack(ai_index._unit(v)) for v in ([1, 0], [0, 2], [1, 1], [1, 0, 0])]
    want = ai_index._dots([1.0, 0.0], blobs)
    monkeypatch.setitem(sys.modules, "numpy", None)
    got = ai_index._dots([1.0, 0.0], blobs[:3])
    assert got == pytest.approx([1.0, 0.0, 0.7071], abs=1e-3)
    assert want is None or want[:3] == pytest.approx(got, abs=1e-5)
