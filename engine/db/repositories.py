"""Repository classes wrapping SQL access to library tables.

Repositories take a ``sqlite3.Connection``. Each public method opens a
transaction via ``with conn:`` so callers don't need explicit commit
calls. Rows are returned as plain dicts (sqlite3.Row converted).
"""
from __future__ import annotations

import json
import re
import secrets
import sqlite3
from typing import Any

from engine._utils import now_iso as _now
from engine.modules.snapshot import payload_hash

_TYPE_PREFIX = {
    "wildcard": "wc",
    "fixed_values": "fv",
    "combine": "cb",
    "derivation": "dr",
    "constraint": "ct",
    "pipeline": "pl",
}
_VALID_TYPES: frozenset[str] = frozenset(_TYPE_PREFIX.keys())
_SLUG_RE = re.compile(r"[^a-z0-9]+")


class _Unset:
    """Sentinel for 'argument not provided' where ``None`` is a valid value."""
    _instance: _Unset | None = None

    def __new__(cls) -> _Unset:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance


_UNSET = _Unset()


class ModuleNotFound(LookupError):
    """Raised when a requested module id does not exist."""


def _slug(name: str) -> str:
    s = _SLUG_RE.sub("_", name.lower()).strip("_")
    return s[:24] or "module"


def _row_to_module(row: sqlite3.Row) -> dict[str, Any]:
    payload = json.loads(row["payload"])
    return {
        "id": row["id"],
        "uuid": row["uuid"],
        "type": row["type"],
        "name": row["name"],
        "description": row["description"],
        "category_id": row["category_id"],
        "tags": json.loads(row["tags"]),
        "is_favorite": bool(row["is_favorite"]),
        "payload": payload,
        "payload_hash": payload_hash(payload),
        "version": row["version"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


class ModuleRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def _gen_id(self, type: str, name: str) -> tuple[str, str]:
        """Generate `(id, uuid)` for a new row. id = `<prefix>_<slug>_<uuid>`."""
        prefix = _TYPE_PREFIX.get(type, "mod")
        uuid = secrets.token_hex(4)
        return f"{prefix}_{_slug(name)}_{uuid}", uuid

    def create(
        self,
        *,
        type: str,
        name: str,
        description: str,
        category_id: str | None,
        tags: list[str],
        payload: dict[str, Any],
        is_favorite: bool = False,
    ) -> dict[str, Any]:
        if type not in _VALID_TYPES:
            raise ValueError(
                f"unknown module type {type!r}; expected one of {sorted(_VALID_TYPES)}"
            )
        mid, uuid = self._gen_id(type, name)
        now = _now()
        with self._conn:
            self._conn.execute(
                "INSERT INTO modules("
                "id, uuid, type, name, description, category_id, tags, "
                "is_favorite, payload, version, created_at, updated_at"
                ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?);",
                (
                    mid, uuid, type, name, description, category_id,
                    json.dumps(tags), int(is_favorite),
                    json.dumps(payload), now, now,
                ),
            )
        return self.get(mid)

    def get(self, module_id: str) -> dict[str, Any]:
        row = self._conn.execute(
            "SELECT * FROM modules WHERE id = ?;", (module_id,),
        ).fetchone()
        if row is None:
            raise ModuleNotFound(module_id)
        return _row_to_module(row)

    def get_by_uuid(self, uuid: str) -> dict[str, Any]:
        """Lookup by indexed uuid. Raises ModuleNotFound on miss."""
        cur = self._conn.execute(
            "SELECT * FROM modules WHERE uuid = ?;", (uuid,),
        )
        row = cur.fetchone()
        if row is None:
            raise ModuleNotFound(uuid)
        return _row_to_module(row)

    def get_by_uuids(self, uuids: list[str]) -> list[dict[str, Any]]:
        """Bulk indexed lookup. Dedups input and returns rows in the same
        order as the (deduped) input. Silently skips missing uuids —
        callers that need explicit miss-detection should compare returned
        uuids against the input set.

        Note on input size: callers (Test Runner request walker, embed-
        bundle endpoint) pass at most a few dozen uuids in practice, so
        we do not chunk. SQLite's `SQLITE_LIMIT_VARIABLE_NUMBER` defaults
        to 32766 on modern builds (3.32+) and 999 on older ones — well
        above the expected upper bound."""
        if not uuids:
            return []
        unique = list(dict.fromkeys(uuids))  # dedup, preserve input order
        placeholders = ",".join("?" for _ in unique)
        cur = self._conn.execute(
            f"SELECT * FROM modules WHERE uuid IN ({placeholders});",
            unique,
        )
        # SQLite makes no order guarantee for IN-predicate results, so we
        # re-order against the input list to honor the docstring contract.
        by_uuid = {r["uuid"]: r for r in cur.fetchall()}
        return [_row_to_module(by_uuid[u]) for u in unique if u in by_uuid]

    def update(
        self,
        module_id: str,
        *,
        name: str | _Unset = _UNSET,
        description: str | _Unset = _UNSET,
        category_id: str | None | _Unset = _UNSET,
        tags: list[str] | _Unset = _UNSET,
        payload: dict[str, Any] | _Unset = _UNSET,
        is_favorite: bool | _Unset = _UNSET,
    ) -> dict[str, Any]:
        existing = self.get(module_id)
        new = {
            "name": existing["name"] if isinstance(name, _Unset) else name,
            "description": (
                existing["description"] if isinstance(description, _Unset) else description
            ),
            "category_id": (
                existing["category_id"] if isinstance(category_id, _Unset) else category_id
            ),
            "tags": existing["tags"] if isinstance(tags, _Unset) else tags,
            "payload": existing["payload"] if isinstance(payload, _Unset) else payload,
            "is_favorite": (
                existing["is_favorite"] if isinstance(is_favorite, _Unset) else is_favorite
            ),
        }
        now = _now()
        with self._conn:
            self._conn.execute(
                "UPDATE modules SET "
                "name = ?, description = ?, category_id = ?, tags = ?, "
                "is_favorite = ?, payload = ?, version = version + 1, "
                "updated_at = ? "
                "WHERE id = ?;",
                (
                    new["name"], new["description"], new["category_id"],
                    json.dumps(new["tags"]), int(new["is_favorite"]),
                    json.dumps(new["payload"]), now, module_id,
                ),
            )
        return self.get(module_id)

    def delete(self, module_id: str) -> None:
        with self._conn:
            cur = self._conn.execute("DELETE FROM modules WHERE id = ?;", (module_id,))
        if cur.rowcount == 0:
            raise ModuleNotFound(module_id)

    def list(
        self,
        *,
        type: str | None = None,
        category_id: str | None = None,
        query: str | None = None,
        favorites_only: bool = False,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if type is not None:
            clauses.append("type = ?")
            params.append(type)
        if category_id is not None:
            clauses.append("category_id = ?")
            params.append(category_id)
        if query:
            escaped = (
                query.replace("\\", "\\\\")
                     .replace("%", "\\%")
                     .replace("_", "\\_")
            )
            clauses.append("name LIKE ? ESCAPE '\\' COLLATE NOCASE")
            params.append(f"%{escaped}%")
        if favorites_only:
            clauses.append("is_favorite = 1")
        sql = "SELECT * FROM modules"
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY updated_at DESC, id DESC"
        if limit is not None:
            sql += " LIMIT ? OFFSET ?"
            params.extend([limit, offset])
        elif offset:
            # SQLite uses LIMIT -1 to mean "unlimited" while still honoring OFFSET.
            sql += " LIMIT -1 OFFSET ?"
            params.append(offset)
        rows = self._conn.execute(sql, params).fetchall()
        return [_row_to_module(r) for r in rows]


class CategoryNotFound(LookupError):
    """Raised when a requested category id does not exist."""


def _row_to_category(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "color": row["color"],
        "icon": row["icon"],
        "sort_order": row["sort_order"],
    }


class CategoryRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def create(
        self,
        *,
        name: str,
        color: str | None,
        icon: str | None,
        sort_order: int = 0,
    ) -> dict[str, Any]:
        cid = _slug(name)
        if cid == "module":
            # _slug returned its fallback because `name` had no alphanumeric chars.
            raise ValueError(
                f"name {name!r} has no alphanumeric characters; "
                f"category name must produce a usable slug"
            )
        try:
            with self._conn:
                self._conn.execute(
                    "INSERT INTO module_categories("
                    "id, name, color, icon, sort_order"
                    ") VALUES(?, ?, ?, ?, ?);",
                    (cid, name, color, icon, sort_order),
                )
        except sqlite3.IntegrityError as e:
            err = str(e).lower()
            if "module_categories.id" in err:
                raise ValueError(
                    f"category id collision: {name!r} produces slug {cid!r} "
                    f"which is already taken"
                ) from e
            raise ValueError(f"category name not unique: {name!r}") from e
        return self.get(cid)

    def get(self, category_id: str) -> dict[str, Any]:
        row = self._conn.execute(
            "SELECT * FROM module_categories WHERE id = ?;",
            (category_id,),
        ).fetchone()
        if row is None:
            raise CategoryNotFound(category_id)
        return _row_to_category(row)

    def update(
        self,
        category_id: str,
        *,
        name: str | _Unset = _UNSET,
        color: str | None | _Unset = _UNSET,
        icon: str | None | _Unset = _UNSET,
        sort_order: int | _Unset = _UNSET,
    ) -> dict[str, Any]:
        existing = self.get(category_id)
        new = {
            "name": existing["name"] if isinstance(name, _Unset) else name,
            "color": existing["color"] if isinstance(color, _Unset) else color,
            "icon": existing["icon"] if isinstance(icon, _Unset) else icon,
            "sort_order": (
                existing["sort_order"] if isinstance(sort_order, _Unset) else sort_order
            ),
        }
        with self._conn:
            self._conn.execute(
                "UPDATE module_categories SET "
                "name = ?, color = ?, icon = ?, sort_order = ? "
                "WHERE id = ?;",
                (
                    new["name"], new["color"], new["icon"],
                    new["sort_order"], category_id,
                ),
            )
        return self.get(category_id)

    def delete(self, category_id: str) -> None:
        with self._conn:
            cur = self._conn.execute(
                "DELETE FROM module_categories WHERE id = ?;",
                (category_id,),
            )
        if cur.rowcount == 0:
            raise CategoryNotFound(category_id)

    def list(self) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            "SELECT * FROM module_categories "
            "ORDER BY sort_order ASC, name COLLATE NOCASE ASC;"
        ).fetchall()
        return [_row_to_category(r) for r in rows]
