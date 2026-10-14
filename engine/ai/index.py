"""The chat's library index: SQLite FTS5 over items and their options.

Searching used to rebuild a word index of the whole library on every call
(about a second for 1000 wildcards of 500 options). This keeps one in a
cache database next to the library (`index_path`), brings it up to date
before each use by comparing each item's `updated_at` (`sync`, so every
write path is covered without hooks), and answers in about a millisecond.
See `/pr-drafts/ai-retrieval-index.md`.

The index is a cache: deleting the file only costs one rebuild. A Python
whose SQLite lacks FTS5 gets `None` from `open_index`, and the chat keeps
its in-memory scorer (`search_index`).

It also keeps what each item points at (`refs`), so a search hit or a read
can say what uses an item and which bundles hold it, and `retrieve` finds
the few items a user's message is clearly about, to hand the model before
it starts (gated: wrong but plausible hits hurt a model more than none).
"""
from __future__ import annotations

import hashlib
import json
import math
import operator
import re
import sqlite3
from array import array
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from engine.ai import search_index as words_index
from engine.ai.library_vars import var_names_in
from engine.ai.refs import ref_targets

#: Bump when what is indexed changes; the next open rebuilds.
FORMAT = 1
INDEX_FILENAME = "wildcard-pipeline.ai-index.db"
#: bm25 column weights, in table order (id, opt, kind are unindexed).
_WEIGHTS = (0.0, 0.0, 0.0, 4.0, 3.5, 3.0, 2.0, 1.0)
_STRONG_COLUMNS = "{name var tags descr}"
MAX_SNIPPETS = 3
#: Options of one item whose text is indexed (a pack of 50k lines is rare,
#: and its first options say what it holds).
MAX_OPTIONS = 5000

#: Words that say what to do, not what about. Left out of retrieval
#: queries (and of searches the model writes, where they only add noise).
STOP = frozenset("""
a about above add added adding after again all also am an and any are as at be been
before being below between both but by can could create created did do does doing done
dont down during each edit few find for from further get give go had has have having he
her here hers him his how i if in into is it its itself just let lets like list make
many me more most much my myself new no nor not now of off on once only or other our out over own
please put same set she should show so some such than that the their them then there
these they this those through to too under until up use very want was we were what
when where which while who whom why will with would you your yours
wildcard wildcards option options item items module modules library
""".split())

_FTS_WORD = re.compile(r"[^\W_]+", re.UNICODE)


def index_path(library_db: str | Path | None) -> Path | None:
    """Where the index for a library database lives (None: in memory)."""
    if not library_db or str(library_db) in ("", ":memory:"):
        return None
    return Path(library_db).with_name(INDEX_FILENAME)


def library_path(conn: sqlite3.Connection) -> str:
    """The file a connection's main database is, or "" for memory."""
    for row in conn.execute("PRAGMA database_list").fetchall():
        if row[1] == "main":
            return str(row[2] or "")
    return ""


_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, stamp TEXT NOT NULL, facts TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS refs (src TEXT NOT NULL, target TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS refs_target ON refs(target);
CREATE INDEX IF NOT EXISTS refs_src ON refs(src);
CREATE TABLE IF NOT EXISTS vectors (
    id TEXT PRIMARY KEY, model TEXT NOT NULL, stamp TEXT NOT NULL, vec BLOB NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
    id UNINDEXED, opt UNINDEXED, kind UNINDEXED, name, var, tags, descr, body,
    tokenize = 'porter unicode61 remove_diacritics 2'
);
"""


def has_fts5() -> bool:
    try:
        c = sqlite3.connect(":memory:")
        try:
            c.execute("CREATE VIRTUAL TABLE t USING fts5(x)")
        finally:
            c.close()
    except sqlite3.Error:
        return False
    return True


def open_index(path: str | Path | None) -> Index | None:
    """The index at `path` (in memory when None), created or rebuilt as
    needed; None when SQLite has no FTS5 or the file can't be used."""
    if not has_fts5():
        return None
    target = str(path) if path else ":memory:"
    try:
        if path:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(target, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL;")
        idx = Index(conn)
        idx.prepare()
    except (sqlite3.Error, OSError):
        if not path:
            return None
        # A broken cache file: start over in it once, else run in memory.
        try:
            Path(path).unlink(missing_ok=True)
            conn = sqlite3.connect(target, check_same_thread=False)
            idx = Index(conn)
            idx.prepare()
        except (sqlite3.Error, OSError):
            return open_index(None)
    return idx


def for_library(conn: sqlite3.Connection) -> Index | None:
    return open_index(index_path(library_path(conn)))


# ── what goes into the index ────────────────────────────────────────────


def _payload(row: dict[str, Any]) -> dict[str, Any]:
    p = row.get("payload")
    return p if isinstance(p, dict) else {}


def _var(row: dict[str, Any]) -> str:
    p = _payload(row)
    v = p.get("var_binding") or p.get("output_var") or ""
    return v if isinstance(v, str) else ""


def _options(row: dict[str, Any]) -> list[tuple[str, str]]:
    """(option id, text) of a wildcard's non-null options."""
    if row.get("type") != "wildcard":
        return []
    out: list[tuple[str, str]] = []
    for n, o in enumerate(_payload(row).get("options") or []):
        if (isinstance(o, dict) and not o.get("is_null") and isinstance(o.get("value"), str)
                and o["value"].strip()):
            out.append((str(o.get("id") or n), o["value"]))
        if len(out) >= MAX_OPTIONS:
            break
    return out


def _children(row: dict[str, Any]) -> list[dict[str, Any]]:
    kids = row.get("children")
    return [c for c in kids if isinstance(c, dict)] if isinstance(kids, list) else []


def _body(row: dict[str, Any], kind: str) -> str:
    if kind == "bundle":
        return "\n".join(str(c.get(k)) for c in _children(row)
                         for k in ("name", "description") if c.get(k))
    return "\n".join(words_index.content(row))


def _axes(row: dict[str, Any]) -> list[str]:
    p = _payload(row)
    kinds = p.get("tag_group_kinds") if isinstance(p.get("tag_group_kinds"), dict) else {}
    return [k for k in kinds if isinstance(k, str)]


def _refs_of(row: dict[str, Any], kind: str) -> set[str]:
    """What an item points at: "$var" reads and other items' ids."""
    out: set[str] = set()
    own_var = _var(row)

    def walk(value: Any, key: str = "") -> None:
        if isinstance(value, str):
            if key in ("var", "target_var") and value:
                out.add("$" + value.lstrip("$"))
            elif key in ("source_wildcard_id", "target_wildcard_id") and value:
                out.add(value)
            else:
                out.update("$" + v for v in var_names_in(value))
                out.update(ref_targets(value))
        elif isinstance(value, dict):
            for k, v in value.items():
                if k not in ("history", "id", "_uid"):
                    walk(v, str(k))
        elif isinstance(value, list):
            for v in value:
                walk(v, key)

    if kind == "bundle":
        for c in _children(row):
            if isinstance(c.get("id"), str):
                out.add("in:" + c["id"])
    else:
        walk(row.get("payload"))
        for k in ("template_string", "negative_template"):
            walk(row.get(k), k)
    if own_var and row.get("type") == "wildcard":
        out.discard("$" + own_var)
    out.discard(str(row.get("id")))
    return {t for t in out if len(t) <= 80}


def _facts(row: dict[str, Any], kind: str) -> dict[str, Any]:
    opts = _options(row)
    tags = [t for t in row.get("tags") or [] if isinstance(t, str)]
    out: dict[str, Any] = {"name": str(row.get("name") or ""), "kind": kind}
    if _var(row):
        out["var"] = _var(row)
    if tags:
        out["tags"] = tags[:8]
    if row.get("type") == "wildcard":
        out["options"] = len(opts)
        out["first"] = [t for _, t in opts[:5]]
        if _axes(row):
            out["axes"] = _axes(row)[:6]
    if kind == "bundle":
        out["holds"] = [str(c.get("name") or "") for c in _children(row)][:12]
    if row.get("description"):
        out["about"] = " ".join(str(row["description"]).split())[:160]
    return out


def _stamp(row: dict[str, Any]) -> str:
    stamp = row.get("updated_at")
    if isinstance(stamp, str) and stamp:
        return f"{FORMAT}:{stamp}"
    raw = json.dumps(row, sort_keys=True, default=str).encode("utf-8")
    return f"{FORMAT}#" + hashlib.sha256(raw).hexdigest()[:24]


# ── queries ─────────────────────────────────────────────────────────────


def _quote(word: str) -> str:
    return '"' + word.replace('"', "") + '"'


def query_words(text: str, *, drop_stop: bool = True) -> list[str]:
    """The words of a query worth matching, in order, once each."""
    seen: dict[str, None] = {}
    for w in _FTS_WORD.findall(text.lower()):
        if len(w) < 2 or (drop_stop and w in STOP):
            continue
        seen.setdefault(w, None)
    return list(seen)[:24]


def _match(words: list[str]) -> str:
    return " OR ".join(_quote(w) for w in words)


@dataclass
class Hit:
    id: str
    kind: str
    #: The ranking score: keyword score alone, or the fused rank score when
    #: a query vector was given.
    score: float
    strong: bool = False
    snippets: list[str] = field(default_factory=list)
    facts: dict[str, Any] = field(default_factory=dict)
    #: bm25-based keyword score (0: found by meaning only).
    keyword: float = 0.0
    #: Cosine similarity to the query (None: no vector search).
    cosine: float | None = None


class Index:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def prepare(self) -> None:
        cur = self.conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").fetchone()
        if cur is not None:
            row = self.conn.execute("SELECT value FROM meta WHERE key='format'").fetchone()
            if row is None or row[0] != str(FORMAT):
                with self.conn:
                    for t in ("fts", "items", "refs", "vectors", "meta"):
                        self.conn.execute(f"DROP TABLE IF EXISTS {t}")
        with self.conn:
            self.conn.executescript(_SCHEMA)
            self.conn.execute("INSERT OR REPLACE INTO meta VALUES ('format', ?)", (str(FORMAT),))

    def close(self) -> None:
        self.conn.close()

    # ── keeping it current ──────────────────────────────────────────────

    def sync(self, rows: list[dict[str, Any]],
             kind_of: Callable[[dict[str, Any]], str]) -> dict[str, int]:
        """Bring the index in line with `rows` (every item of the library):
        index new and changed items, drop removed ones."""
        have = dict(self.conn.execute("SELECT id, stamp FROM items").fetchall())
        want: dict[str, tuple[dict[str, Any], str]] = {}
        for r in rows:
            if isinstance(r.get("id"), str):
                want[r["id"]] = (r, _stamp(r))
        gone = [i for i in have if i not in want]
        todo = [(r, s) for i, (r, s) in want.items() if have.get(i) != s]
        if not gone and not todo:
            return {"added": 0, "changed": 0, "removed": 0}
        with self.conn:
            for i in gone + [r["id"] for r, _ in todo]:
                self.conn.execute("DELETE FROM fts WHERE id = ?", (i,))
                self.conn.execute("DELETE FROM refs WHERE src = ?", (i,))
                self.conn.execute("DELETE FROM items WHERE id = ?", (i,))
            for r, stamp in todo:
                self._add(r, kind_of(r), stamp)
        added = sum(1 for r, _ in todo if r["id"] not in have)
        return {"added": added, "changed": len(todo) - added, "removed": len(gone)}

    def _add(self, row: dict[str, Any], kind: str, stamp: str) -> None:
        item_id = row["id"]
        tags = [t for t in row.get("tags") or [] if isinstance(t, str)]
        tags_text = " ".join([*tags, *_axes(row)])
        self.conn.execute(
            "INSERT INTO fts (id, opt, kind, name, var, tags, descr, body) "
            "VALUES (?, '', ?, ?, ?, ?, ?, ?)",
            (item_id, kind, str(row.get("name") or ""), _var(row), tags_text,
             str(row.get("description") or ""), _body(row, kind)))
        self.conn.executemany(
            "INSERT INTO fts (id, opt, kind, name, var, tags, descr, body) "
            "VALUES (?, ?, ?, '', '', '', '', ?)",
            [(item_id, oid, kind, text) for oid, text in _options(row)])
        self.conn.executemany("INSERT INTO refs (src, target) VALUES (?, ?)",
                              [(item_id, t) for t in sorted(_refs_of(row, kind))])
        self.conn.execute("INSERT INTO items (id, kind, stamp, facts) VALUES (?, ?, ?, ?)",
                          (item_id, kind, stamp,
                           json.dumps(_facts(row, kind), ensure_ascii=False, sort_keys=True)))

    # ── reading ─────────────────────────────────────────────────────────

    def count(self) -> int:
        return int(self.conn.execute("SELECT COUNT(*) FROM items").fetchone()[0])

    def facts(self, item_id: str) -> dict[str, Any] | None:
        row = self.conn.execute("SELECT facts FROM items WHERE id = ?", (item_id,)).fetchone()
        if row is None:
            return None
        out: dict[str, Any] = json.loads(row[0])
        targets = [item_id] + ([f"${out['var']}"] if out.get("var") else [])
        marks = ",".join("?" for _ in targets)
        users = self.conn.execute(
            f"SELECT DISTINCT r.src, i.facts FROM refs r JOIN items i ON i.id = r.src "
            f"WHERE r.target IN ({marks}) ORDER BY r.src LIMIT 12", targets).fetchall()
        used = [json.loads(f) for _, f in users]
        if used:
            out["used_by"] = [f"{u['name']} ({src}, {u['kind']})"
                              for (src, _), u in zip(users, used, strict=True)]
        held = self.conn.execute(
            "SELECT r.src, i.facts FROM refs r JOIN items i ON i.id = r.src "
            "WHERE r.target = ? ORDER BY r.src LIMIT 8", ("in:" + item_id,)).fetchall()
        if held:
            out["in_bundles"] = [f"{json.loads(f)['name']} ({src})" for src, f in held]
        return out

    def _ranked(self, match: str, kinds: set[str] | None,
                limit: int) -> list[tuple[str, str, float]]:
        sql = ("SELECT id, kind, bm25(fts, " + ", ".join(str(w) for w in _WEIGHTS) + ") AS s "
               "FROM fts WHERE fts MATCH ? AND opt = '' ORDER BY s LIMIT ?")
        try:
            rows = self.conn.execute(sql, (match, limit * 4 if kinds else limit)).fetchall()
        except sqlite3.OperationalError:
            return []
        return [(i, k, -float(s)) for i, k, s in rows if not kinds or k in kinds][:limit]

    def _option_hits(self, match: str, ids: list[str]) -> dict[str, list[str]]:
        """Up to MAX_SNIPPETS matching option texts for each of `ids`."""
        out: dict[str, list[str]] = {}
        if not ids:
            return out
        marks = ",".join("?" for _ in ids)
        try:
            rows = self.conn.execute(
                f"SELECT id, body FROM fts WHERE fts MATCH ? AND opt != '' AND id IN ({marks}) "
                f"ORDER BY rank LIMIT ?", (f"body: ({match})", *ids, len(ids) * 12)).fetchall()
        except sqlite3.OperationalError:
            return out
        for i, text in rows:
            got = out.setdefault(i, [])
            if len(got) < MAX_SNIPPETS:
                got.append(text)
        return out

    def _strong(self, match: str, ids: list[str]) -> set[str]:
        """Ids whose name, variable, tags or description match."""
        if not ids:
            return set()
        marks = ",".join("?" for _ in ids)
        try:
            rows = self.conn.execute(
                f"SELECT id FROM fts WHERE fts MATCH ? AND opt = '' AND id IN ({marks})",
                (f"{_STRONG_COLUMNS}: ({match})", *ids)).fetchall()
        except sqlite3.OperationalError:
            return set()
        return {r[0] for r in rows}

    def search(self, query: str, *, kinds: set[str] | None = None,
               limit: int = 8, drop_stop: bool = False,
               qvec: list[float] | None = None, model: str = "") -> list[Hit]:
        """Items for a query, best first. The query's own words count fully;
        words its broad subjects widen to ("character" → hair, eye, …) count
        for less. With `qvec` (the query embedded by `model`), items close
        in meaning join in and the two rankings are fused (RRF)."""
        own = query_words(query, drop_stop=drop_stop)
        if not own and qvec is None:
            return []
        widened_set: set[str] = set()
        for w in own:
            _own, wid = words_index.expand(w)
            widened_set |= wid
        widened = [w for w in sorted(widened_set) if w not in own]
        scores: dict[str, float] = {}
        kind_by: dict[str, str] = {}
        if own:
            for i, k, sc in self._ranked(_match(own), kinds, limit * 3):
                scores[i] = scores.get(i, 0.0) + sc
                kind_by[i] = k
        if widened:
            for i, k, sc in self._ranked(_match(widened), kinds, limit * 3):
                scores[i] = scores.get(i, 0.0) + words_index.WIDENED * sc
                kind_by[i] = k
        phrase = " ".join(query.lower().split())
        if len(phrase) > 2 and scores:
            marks = ",".join("?" for _ in scores)
            for i, facts in self.conn.execute(
                    f"SELECT id, facts FROM items WHERE id IN ({marks})", list(scores)):
                if phrase in json.loads(facts).get("name", "").lower():
                    scores[i] += 6.0
        keyword_rank = sorted(scores, key=lambda i: (-scores[i], i))
        cosines: dict[str, float] = {}
        if qvec is not None and model:
            for i, k, c in self.nearest(qvec, model, kinds=kinds, limit=limit * 3):
                cosines[i] = c
                kind_by.setdefault(i, k)
        if cosines:
            fused: dict[str, float] = {}
            for r, i in enumerate(keyword_rank):
                fused[i] = fused.get(i, 0.0) + 1.0 / (RRF_K + r + 1)
            for r, i in enumerate(sorted(cosines, key=lambda i: -cosines[i])):
                fused[i] = fused.get(i, 0.0) + 1.0 / (RRF_K + r + 1)
            ranked = sorted(fused, key=lambda i: (-fused[i], i))[:limit]
            final = fused
        else:
            ranked = keyword_rank[:limit]
            final = scores
        strong = self._strong(_match(own), ranked) if own else set()
        snips = self._option_hits(_match(own + widened), ranked) if own else {}
        return [Hit(i, kind_by[i], final[i], i in strong, snips.get(i, []),
                    self.facts(i) or {}, scores.get(i, 0.0), cosines.get(i))
                for i in ranked]

    # ── meaning (embeddings) ────────────────────────────────────────────

    def embed_todo(self, model: str, limit: int) -> list[tuple[str, str, str]]:
        """(id, stamp, text to embed) of items with no vector from `model`
        for their current version, up to `limit`."""
        rows = self.conn.execute(
            "SELECT i.id, i.stamp, i.facts FROM items i LEFT JOIN vectors v ON v.id = i.id "
            "WHERE v.id IS NULL OR v.model != ? OR v.stamp != i.stamp ORDER BY i.id LIMIT ?",
            (model, limit)).fetchall()
        return [(i, stamp, embed_text(json.loads(facts))) for i, stamp, facts in rows]

    def put_vectors(self, model: str, rows: list[tuple[str, str, list[float]]]) -> None:
        with self.conn:
            self.conn.executemany(
                "INSERT OR REPLACE INTO vectors (id, model, stamp, vec) VALUES (?, ?, ?, ?)",
                [(i, model, stamp, _pack(_unit(v))) for i, stamp, v in rows])
            self.conn.execute("DELETE FROM vectors WHERE id NOT IN (SELECT id FROM items)")

    def vector_count(self, model: str) -> int:
        return int(self.conn.execute(
            "SELECT COUNT(*) FROM vectors v JOIN items i ON i.id = v.id "
            "WHERE v.model = ? AND v.stamp = i.stamp", (model,)).fetchone()[0])

    def nearest(self, qvec: list[float], model: str, *, kinds: set[str] | None = None,
                limit: int = 8) -> list[tuple[str, str, float]]:
        """(id, kind, cosine) of the items closest in meaning, best first."""
        rows = self.conn.execute(
            "SELECT v.id, i.kind, v.vec FROM vectors v JOIN items i ON i.id = v.id "
            "WHERE v.model = ?", (model,)).fetchall()
        rows = [r for r in rows if not kinds or r[1] in kinds]
        if not rows:
            return []
        q = _unit(qvec)
        sims = _dots(q, [r[2] for r in rows])
        if sims is None:
            return []
        order = sorted(range(len(rows)), key=lambda n: -sims[n])[:limit]
        return [(rows[n][0], rows[n][1], float(sims[n])) for n in order]

    def clear(self) -> None:
        with self.conn:
            for t in ("fts", "items", "refs", "vectors"):
                self.conn.execute(f"DELETE FROM {t}")


#: Reciprocal Rank Fusion constant (the usual 60).
RRF_K = 60
#: Characters of an item's description of itself that get embedded.
EMBED_CHARS = 1200


def embed_text(f: dict[str, Any]) -> str:
    """What an item's vector is made from: what it is and what it holds
    (its name and tags give its options their context)."""
    bits = [f"{f.get('kind')}: {f.get('name')}"]
    if f.get("var"):
        bits.append(f"variable {f['var']}")
    if f.get("tags"):
        bits.append("tags " + ", ".join(f["tags"]))
    if f.get("about"):
        bits.append(str(f["about"]))
    if f.get("first"):
        bits.append("options: " + ", ".join(f["first"]))
    if f.get("holds"):
        bits.append("holds: " + ", ".join(f["holds"]))
    return ". ".join(bits)[:EMBED_CHARS]


def _unit(v: list[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / norm for x in v]


def _pack(v: list[float]) -> bytes:
    return array("f", v).tobytes()


def _dots(q: list[float], blobs: list[bytes]) -> list[float] | None:
    """Dot products of the unit query with each stored unit vector (cosine),
    with numpy when it's there (it is inside ComfyUI)."""
    try:
        import numpy as np
    except ImportError:
        np = None
    if np is not None:
        mat = np.frombuffer(b"".join(blobs), dtype=np.float32)
        if mat.size % len(q):
            return None
        mat = mat.reshape(-1, len(q))
        if mat.shape[0] != len(blobs):
            return None
        return (mat @ np.asarray(q, dtype=np.float32)).tolist()
    out: list[float] = []
    for blob in blobs:
        v = array("f")
        v.frombytes(blob)
        if len(v) != len(q):
            out.append(-1.0)
            continue
        out.append(sum(map(operator.mul, q, v)))
    return out


# ── telling the model ───────────────────────────────────────────────────


def facts_line(item_id: str, f: dict[str, Any], *, full: bool = True) -> str:
    """One item as a line: what it is and, with `full`, what it holds and
    what uses it."""
    head = f"{f.get('name') or '(unnamed)'} ({item_id}, {f.get('kind')}"
    if f.get("var"):
        head += f", ${f['var']}"
    if isinstance(f.get("options"), int):
        head += f", {f['options']} option{'s' if f['options'] != 1 else ''}"
    head += ")"
    if not full:
        return head
    bits: list[str] = []
    if f.get("tags"):
        bits.append("tags " + ", ".join(f["tags"]))
    if f.get("axes"):
        bits.append("tag groups " + ", ".join(f["axes"]))
    if f.get("holds"):
        bits.append("holds " + ", ".join(f["holds"]))
    if f.get("used_by"):
        bits.append("used by " + ", ".join(f["used_by"][:6]))
    if f.get("in_bundles"):
        bits.append("in bundles " + ", ".join(f["in_bundles"][:4]))
    line = head + (": " + "; ".join(bits) if bits else "")
    if f.get("first"):
        line += "\n    e.g. " + " | ".join(_short(t, 60) for t in f["first"][:4])
    return line


def _short(text: Any, n: int) -> str:
    s = " ".join(str(text or "").split())
    return s if len(s) <= n else s[:n - 1] + "…"


#: Messages that answer the assistant rather than ask about the library.
_REPLY = re.compile(
    r"^\s*(y(es|eah|ep|up)?|no(pe)?|ok(ay)?|sure|go( ahead)?|do it|please do|thanks?( you)?"
    r"|thx|perfect|great|nice|cool|apply( it)?|continue|next|stop|cancel)\b[\s.!?]*$",
    re.IGNORECASE)

#: Kept when within this share of the best hit's score.
RELATIVE = 0.45


#: A meaning-only hit (no keyword match) is handed over only this close in
#: meaning, and near the best one. Tuned on nomic-embed-text / embeddinggemma
#: scale; the evals calibrate it per model.
VECTOR_MIN = 0.55
VECTOR_NEAR_BEST = 0.05


def retrieve(idx: Index, message: str, *, seen: set[str], limit: int, full: bool,
             qvec: list[float] | None = None, model: str = "") -> tuple[str, list[str]]:
    """A short "possibly relevant" block for the user's message, and the
    ids it names. Only clear matches: a name, variable, tag or description
    hit, or matching options, within RELATIVE of the best keyword score; or
    (with a query vector) an item very close in meaning; never an item the
    chat already showed; nothing for a reply like "yes"."""
    if not message.strip() or _REPLY.match(message) or len(message) > 4000:
        return "", []
    hits = idx.search(message, limit=limit * 3, drop_stop=True, qvec=qvec, model=model)
    if not hits:
        return "", []
    best_kw = max((h.keyword for h in hits), default=0.0)
    best_cos = max((h.cosine for h in hits if h.cosine is not None), default=0.0)

    def clear(h: Hit) -> bool:
        if h.keyword > 0 and h.keyword >= best_kw * RELATIVE and (h.strong or h.snippets):
            return True
        return (h.keyword == 0 and h.cosine is not None and h.cosine >= VECTOR_MIN
                and h.cosine >= best_cos - VECTOR_NEAR_BEST)

    kept = [h for h in hits if h.id not in seen and clear(h)][:limit]
    if not kept:
        return "", []
    lines = ["Possibly relevant items, from a search of this message (they may be unrelated; "
             "search or read if they aren't what the user means):"]
    for h in kept:
        line = "- " + facts_line(h.id, h.facts, full=full)
        if full and h.snippets:
            line += "\n    matches: " + " | ".join(_short(t, 60) for t in h.snippets)
        lines.append(line)
    return "\n".join(lines), [h.id for h in kept]
