"""Repository classes wrapping SQL access to library tables.

Repositories take a ``sqlite3.Connection``. Each public method opens a
transaction via ``with conn:`` so callers don't need explicit commit
calls. Rows are returned as plain dicts (sqlite3.Row converted).
"""
from __future__ import annotations

import datetime as _dt
import json
import re
import secrets
import sqlite3
from typing import Any

_TYPE_PREFIX = {"wildcard": "wc", "fixed_values": "fv"}
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


def _now() -> str:
    return _dt.datetime.now(_dt.UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _row_to_module(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "type": row["type"],
        "name": row["name"],
        "description": row["description"],
        "category_id": row["category_id"],
        "tags": json.loads(row["tags"]),
        "is_favorite": bool(row["is_favorite"]),
        "payload": json.loads(row["payload"]),
        "version": row["version"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


class ModuleRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def _gen_id(self, type: str, name: str) -> str:
        prefix = _TYPE_PREFIX.get(type, "mod")
        return f"{prefix}_{_slug(name)}_{secrets.token_hex(4)}"

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
        mid = self._gen_id(type, name)
        now = _now()
        with self._conn:
            self._conn.execute(
                "INSERT INTO modules("
                "id, type, name, description, category_id, tags, "
                "is_favorite, payload, version, created_at, updated_at"
                ") VALUES(?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?);",
                (
                    mid, type, name, description, category_id,
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

    def update(
        self,
        module_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
        category_id: str | None | _Unset = _UNSET,
        tags: list[str] | None = None,
        payload: dict[str, Any] | None = None,
        is_favorite: bool | None = None,
    ) -> dict[str, Any]:
        existing = self.get(module_id)
        new = {
            "name": existing["name"] if name is None else name,
            "description": existing["description"] if description is None else description,
            "category_id": (
                existing["category_id"] if isinstance(category_id, _Unset) else category_id
            ),
            "tags": existing["tags"] if tags is None else tags,
            "payload": existing["payload"] if payload is None else payload,
            "is_favorite": existing["is_favorite"] if is_favorite is None else is_favorite,
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
        self.get(module_id)  # raises ModuleNotFound if absent
        with self._conn:
            self._conn.execute("DELETE FROM modules WHERE id = ?;", (module_id,))

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
        try:
            with self._conn:
                self._conn.execute(
                    "INSERT INTO module_categories("
                    "id, name, color, icon, sort_order"
                    ") VALUES(?, ?, ?, ?, ?);",
                    (cid, name, color, icon, sort_order),
                )
        except sqlite3.IntegrityError as e:
            raise ValueError(f"category name not unique: {name}") from e
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
        name: str | None = None,
        color: str | None | _Unset = _UNSET,
        icon: str | None | _Unset = _UNSET,
        sort_order: int | None = None,
    ) -> dict[str, Any]:
        existing = self.get(category_id)
        new = {
            "name": existing["name"] if name is None else name,
            "color": existing["color"] if isinstance(color, _Unset) else color,
            "icon": existing["icon"] if isinstance(icon, _Unset) else icon,
            "sort_order": (
                existing["sort_order"] if sort_order is None else sort_order
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
