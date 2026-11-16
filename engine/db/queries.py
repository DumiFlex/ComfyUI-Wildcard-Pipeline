"""Lightweight library reads for the graph-run hot path.

`ModuleRepository.get` builds the whole API row: it decodes the payload and
the tags and re-hashes the payload with SHA-256. A WP Context run only needs
the raw row (to follow `@{uuid}` refs) or an option count (pool provenance),
so these read just that. Read-only; they never write.
"""
from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable
from typing import Any

#: Raw library row as stored: (type, name, payload JSON text).
RawModule = tuple[str, str, str]

# Far below SQLite's bound-parameter limit (999 on old builds).
_CHUNK = 500


def _chunks(ids: Iterable[str]) -> list[list[str]]:
    unique = list(dict.fromkeys(i for i in ids if isinstance(i, str)))
    return [unique[i:i + _CHUNK] for i in range(0, len(unique), _CHUNK)]


def module_row(conn: sqlite3.Connection, module_id: str) -> RawModule | None:
    """`(type, name, payload_text)` of one module, or None when absent."""
    row = conn.execute(
        "SELECT type, name, payload FROM modules WHERE id = ?;", (module_id,),
    ).fetchone()
    if row is None:
        return None
    return (row[0], row[1], row[2])


def module_rows(conn: sqlite3.Connection, ids: Iterable[str]) -> dict[str, RawModule]:
    """`module_row` for many ids in one query per chunk; absent ids are
    simply missing from the result."""
    out: dict[str, RawModule] = {}
    for chunk in _chunks(ids):
        marks = ",".join("?" * len(chunk))
        for row in conn.execute(
            f"SELECT id, type, name, payload FROM modules WHERE id IN ({marks});", chunk,
        ):
            out[row[0]] = (row[1], row[2], row[3])
    return out


def decode_payload(text: Any) -> dict[str, Any] | None:
    """A stored payload as a dict, or None when it isn't one."""
    try:
        payload = json.loads(text)
    except (TypeError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def _count_in_python(text: Any) -> int | None:
    payload = decode_payload(text)
    options = payload.get("options") if payload is not None else None
    return len(options) if isinstance(options, list) else None


def option_counts(conn: sqlite3.Connection, ids: Iterable[str]) -> dict[str, int | None]:
    """How many options each module's stored payload has, by id.

    None when the payload has no `options` list (or does not decode); absent
    ids are missing from the result. SQLite's JSON functions count without
    building the payload in Python; a payload SQLite rejects is decoded in
    Python instead, so the answer is what `json.loads` would give.
    """
    out: dict[str, int | None] = {}
    for chunk in _chunks(ids):
        marks = ",".join("?" * len(chunk))
        try:
            rows = conn.execute(
                "SELECT id, CASE WHEN json_valid(payload) THEN "
                "CASE WHEN json_type(payload, '$.options') = 'array' "
                "THEN json_array_length(payload, '$.options') END END, "
                "json_valid(payload) "
                f"FROM modules WHERE id IN ({marks});",
                chunk,
            ).fetchall()
        except sqlite3.OperationalError:
            # A SQLite built without JSON support.
            rows = None
        if rows is None:
            for row in conn.execute(
                f"SELECT id, payload FROM modules WHERE id IN ({marks});", chunk,
            ):
                out[row[0]] = _count_in_python(row[1])
            continue
        invalid = []
        for mid, count, valid in rows:
            if valid:
                out[mid] = count
            else:
                invalid.append(mid)
        if invalid:
            for mid, (_t, _n, text) in module_rows(conn, invalid).items():
                out[mid] = _count_in_python(text)
    return out
