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

from engine._fingerprint import module_fingerprint
from engine._utils import now_iso as _now
from engine.modules.snapshot import payload_hash

_VALID_TYPES: frozenset[str] = frozenset({
    "wildcard", "fixed_values", "combine", "derivation", "constraint",
})
# Module ids are 8-hex short uuids — same shape the tokenizer's
# `@{8hex}` ref token captures and the engine catalog keys by. Slug
# prefixes (e.g. `wc_outfit_a1b2c3d4`) were removed in migration 004
# to collapse the two-identifier model down to one canonical form.
_ID_HEX_LEN = 8

# Categories keep slug-based ids (`subjects`, `style`, …) — human
# readable and never need to be embedded in a tokenizer regex, so
# the unification doesn't apply to them.
_CATEGORY_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _category_slug(name: str) -> str:
    s = _CATEGORY_SLUG_RE.sub("_", name.lower()).strip("_")
    return s[:24] or "module"


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


def _row_to_module(row: sqlite3.Row) -> dict[str, Any]:
    payload = json.loads(row["payload"])
    return {
        "id": row["id"],
        "type": row["type"],
        "name": row["name"],
        "description": row["description"],
        "category_id": row["category_id"],
        "tags": json.loads(row["tags"]),
        "is_favorite": bool(row["is_favorite"]),
        "payload": payload,
        "payload_hash": payload_hash(payload),
        "snapshot_fingerprint": row["snapshot_fingerprint"],  # NULL for pre-006 rows
        "version": row["version"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


class ModuleRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def _gen_id(self) -> str:
        """Generate a fresh 8-hex module id.

        Post migration 004 the id IS the only identifier — we no
        longer carry a separate slugged form. Collisions are rejected
        by the PRIMARY KEY constraint on `modules.id`; `secrets.token_hex(4)`
        gives 4 bytes (~4.3B values), so the birthday-paradox 50% mark
        sits around 65k modules — well past the expected single-user
        library size.
        """
        return secrets.token_hex(_ID_HEX_LEN // 2)

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
        id: str | None = None,
    ) -> dict[str, Any]:
        """Insert a new module row.

        ``id`` is normally generated; pass an explicit id to import
        a workflow-resident snapshot back into the library at the
        SAME uuid (so a freshly-saved row immediately matches the
        workflow's existing references — no broken `@{uuid}` refs).
        Validates the supplied id is 8-hex to prevent the workflow
        from injecting arbitrary primary-key shapes.
        """
        if type not in _VALID_TYPES:
            raise ValueError(
                f"unknown module type {type!r}; expected one of {sorted(_VALID_TYPES)}"
            )
        if id is None:
            mid = self._gen_id()
        else:
            if not isinstance(id, str) or len(id) != _ID_HEX_LEN or not all(
                c in "0123456789abcdef" for c in id
            ):
                raise ValueError(
                    f"id must be a {_ID_HEX_LEN}-char lowercase-hex string"
                )
            mid = id
        fp = module_fingerprint({
            "type": type,
            "name": name,
            "description": description,
            "tags": tags,
            "payload_hash": payload_hash(payload),
        })
        now = _now()
        with self._conn:
            self._conn.execute(
                "INSERT INTO modules("
                "id, type, name, description, category_id, tags, "
                "is_favorite, payload, snapshot_fingerprint, version, created_at, updated_at"
                ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?);",
                (
                    mid, type, name, description, category_id,
                    json.dumps(tags), int(is_favorite),
                    json.dumps(payload), fp, now, now,
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

    # Back-compat aliases — `id == uuid` after migration 004, so the
    # uuid-named lookups are now thin wrappers around `get` / a bulk
    # `get` variant. Kept so external callers (test runner, embed-
    # bundle endpoint, future drift-hash endpoint) don't need code
    # changes; new code should prefer `get` / the new `get_many`.
    def get_by_uuid(self, uuid: str) -> dict[str, Any]:
        return self.get(uuid)

    def get_many(self, ids: list[str]) -> list[dict[str, Any]]:
        """Bulk lookup. Dedups input and returns rows in the same order
        as the (deduped) input. Silently skips ids that aren't present —
        callers needing explicit miss-detection should compare returned
        ids against the input set.

        Note on input size: callers (test-runner walker, embed-bundle)
        pass at most a few dozen ids in practice, so we don't chunk.
        SQLite's `SQLITE_LIMIT_VARIABLE_NUMBER` defaults to 32766 on
        modern builds (3.32+) and 999 on older ones — well above any
        expected upper bound."""
        if not ids:
            return []
        unique = list(dict.fromkeys(ids))  # dedup, preserve input order
        placeholders = ",".join("?" for _ in unique)
        cur = self._conn.execute(
            f"SELECT * FROM modules WHERE id IN ({placeholders});",
            unique,
        )
        # SQLite makes no order guarantee for IN-predicate results, so
        # re-order against the input list to honor the docstring.
        by_id = {r["id"]: r for r in cur.fetchall()}
        return [_row_to_module(by_id[u]) for u in unique if u in by_id]

    def get_by_uuids(self, uuids: list[str]) -> list[dict[str, Any]]:
        return self.get_many(uuids)

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
        new_payload_hash = payload_hash(new["payload"])
        new_fp = module_fingerprint({
            "type": existing["type"],
            "name": new["name"],
            "description": new["description"],
            "tags": new["tags"],
            "payload_hash": new_payload_hash,
        })
        now = _now()
        with self._conn:
            self._conn.execute(
                "UPDATE modules SET "
                "name = ?, description = ?, category_id = ?, tags = ?, "
                "is_favorite = ?, payload = ?, snapshot_fingerprint = ?, "
                "version = version + 1, updated_at = ? "
                "WHERE id = ?;",
                (
                    new["name"], new["description"], new["category_id"],
                    json.dumps(new["tags"]), int(new["is_favorite"]),
                    json.dumps(new["payload"]), new_fp, now, module_id,
                ),
            )
        return self.get(module_id)

    def delete(self, module_id: str) -> None:
        with self._conn:
            cur = self._conn.execute("DELETE FROM modules WHERE id = ?;", (module_id,))
        if cur.rowcount == 0:
            raise ModuleNotFound(module_id)

    def _build_filter_clause(
        self,
        *,
        type: str | None,
        category_id: str | None,
        query: str | None,
        favorites_only: bool,
    ) -> tuple[str, list[Any]]:
        """Build the WHERE-clause fragment + bound params shared by list/count.

        Extracted so list() (paginated rows) and count() (total ignoring
        pagination) apply the same filters bit-for-bit. Mismatched filters
        between the two paths is the kind of bug that silently makes
        Dashboard counts wrong — the helper closes that loop."""
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
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        return where, params

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
        where, params = self._build_filter_clause(
            type=type, category_id=category_id, query=query,
            favorites_only=favorites_only,
        )
        sql = "SELECT * FROM modules" + where + " ORDER BY updated_at DESC, id DESC"
        if limit is not None:
            sql += " LIMIT ? OFFSET ?"
            params.extend([limit, offset])
        elif offset:
            # SQLite uses LIMIT -1 to mean "unlimited" while still honoring OFFSET.
            sql += " LIMIT -1 OFFSET ?"
            params.append(offset)
        rows = self._conn.execute(sql, params).fetchall()
        return [_row_to_module(r) for r in rows]

    def count(
        self,
        *,
        type: str | None = None,
        category_id: str | None = None,
        query: str | None = None,
        favorites_only: bool = False,
    ) -> int:
        """Total rows matching the same filters as list(), ignoring limit
        and offset. Used by the API to populate `ModuleListResponse.total`
        accurately even when the client passed `limit=1` for cheap polling
        (Dashboard count cards do exactly this)."""
        where, params = self._build_filter_clause(
            type=type, category_id=category_id, query=query,
            favorites_only=favorites_only,
        )
        sql = "SELECT COUNT(*) AS n FROM modules" + where
        row = self._conn.execute(sql, params).fetchone()
        return int(row["n"]) if row is not None else 0


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
        cid = _category_slug(name)
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


class BundleNotFound(LookupError):
    """Raised when a requested bundle id does not exist."""


def _row_to_bundle(row: sqlite3.Row) -> dict[str, Any]:
    """Materialize a bundles row into the SPA-facing dict shape.

    `children` is stored as a JSON array of full module snapshots
    (deep-cloned at save time). The repository deserializes it on
    read so callers don't have to. `payload_hash` lives in the row
    rather than being recomputed on demand because bundles are
    intentionally frozen — the saved hash is the source of truth for
    insert-time `inserted_at_hash` capture + library-drift detection.
    """
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "color": row["color"],
        "category_id": row["category_id"],
        "tags": json.loads(row["tags"]),
        "is_favorite": bool(row["is_favorite"]),
        "children": json.loads(row["children"]),
        "payload_hash": row["payload_hash"],
        "version": row["version"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


class BundleRepository:
    """Library-side store for bundle entries. Mirrors `ModuleRepository`
    shape (list / get / create / update / delete / count + favorite
    toggle) so the SPA Library page can re-use its existing fetch
    patterns.

    Bundles intentionally do NOT support the embed-bundle / snapshot
    endpoints modules expose — bundles are themselves the snapshot
    package, so re-snapshotting is a no-op."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def _gen_id(self) -> str:
        """Generate a fresh 8-hex bundle id. Same scheme as modules so
        `@{<id>}` ref syntax could theoretically reference a bundle in
        the future (not currently used — bundles aren't `$variable`
        producers themselves; their children are). Birthday-paradox
        50% mark at ~65k bundles, well past expected library size."""
        return secrets.token_hex(_ID_HEX_LEN // 2)

    def create(
        self,
        *,
        name: str,
        description: str = "",
        color: str | None = None,
        category_id: str | None = None,
        tags: list[str] | None = None,
        children: list[dict[str, Any]] | None = None,
        is_favorite: bool = False,
        id: str | None = None,
    ) -> dict[str, Any]:
        if id is None:
            bid = self._gen_id()
        else:
            if not isinstance(id, str) or len(id) != _ID_HEX_LEN or not all(
                c in "0123456789abcdef" for c in id
            ):
                raise ValueError(
                    f"id must be a {_ID_HEX_LEN}-char lowercase-hex string"
                )
            bid = id
        children_blob = list(children) if children else []
        # `payload_hash` is computed off the children blob — the only
        # field whose change should signal "library has a newer
        # version" to inserted instances.
        ph = payload_hash({"children": children_blob})
        now = _now()
        with self._conn:
            self._conn.execute(
                "INSERT INTO bundles("
                "id, name, description, color, category_id, tags, "
                "is_favorite, children, payload_hash, version, "
                "created_at, updated_at"
                ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?);",
                (
                    bid, name, description, color, category_id,
                    json.dumps(tags or []), int(is_favorite),
                    json.dumps(children_blob), ph, now, now,
                ),
            )
        return self.get(bid)

    def get(self, bundle_id: str) -> dict[str, Any]:
        row = self._conn.execute(
            "SELECT * FROM bundles WHERE id = ?;", (bundle_id,),
        ).fetchone()
        if row is None:
            raise BundleNotFound(bundle_id)
        return _row_to_bundle(row)

    def update(
        self,
        bundle_id: str,
        *,
        name: str | _Unset = _UNSET,
        description: str | _Unset = _UNSET,
        color: str | None | _Unset = _UNSET,
        category_id: str | None | _Unset = _UNSET,
        tags: list[str] | _Unset = _UNSET,
        children: list[dict[str, Any]] | _Unset = _UNSET,
        is_favorite: bool | _Unset = _UNSET,
    ) -> dict[str, Any]:
        existing = self.get(bundle_id)
        new = {
            "name": existing["name"] if isinstance(name, _Unset) else name,
            "description": (
                existing["description"] if isinstance(description, _Unset) else description
            ),
            "color": existing["color"] if isinstance(color, _Unset) else color,
            "category_id": (
                existing["category_id"] if isinstance(category_id, _Unset) else category_id
            ),
            "tags": existing["tags"] if isinstance(tags, _Unset) else tags,
            "children": (
                existing["children"] if isinstance(children, _Unset) else children
            ),
            "is_favorite": (
                existing["is_favorite"] if isinstance(is_favorite, _Unset) else is_favorite
            ),
        }
        # Recompute payload_hash whenever children change. Other field
        # edits (rename, recolor, retag) don't affect runtime behavior
        # so they don't bump the hash — inserted instances stay clean
        # on a pure-cosmetic library update.
        ph = (
            existing["payload_hash"]
            if isinstance(children, _Unset)
            else payload_hash({"children": new["children"]})
        )
        now = _now()
        with self._conn:
            self._conn.execute(
                "UPDATE bundles SET "
                "name = ?, description = ?, color = ?, category_id = ?, "
                "tags = ?, is_favorite = ?, children = ?, payload_hash = ?, "
                "version = version + 1, updated_at = ? "
                "WHERE id = ?;",
                (
                    new["name"], new["description"], new["color"],
                    new["category_id"], json.dumps(new["tags"]),
                    int(new["is_favorite"]),
                    json.dumps(new["children"]), ph, now, bundle_id,
                ),
            )
        return self.get(bundle_id)

    def delete(self, bundle_id: str) -> None:
        with self._conn:
            cur = self._conn.execute(
                "DELETE FROM bundles WHERE id = ?;", (bundle_id,),
            )
        if cur.rowcount == 0:
            raise BundleNotFound(bundle_id)

    def _build_filter_clause(
        self,
        *,
        category_id: str | None,
        query: str | None,
        favorites_only: bool,
    ) -> tuple[str, list[Any]]:
        clauses: list[str] = []
        params: list[Any] = []
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
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        return where, params

    def list(
        self,
        *,
        category_id: str | None = None,
        query: str | None = None,
        favorites_only: bool = False,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        where, params = self._build_filter_clause(
            category_id=category_id, query=query,
            favorites_only=favorites_only,
        )
        sql = "SELECT * FROM bundles" + where + " ORDER BY updated_at DESC, id DESC"
        if limit is not None:
            sql += " LIMIT ? OFFSET ?"
            params.extend([limit, offset])
        elif offset:
            sql += " LIMIT -1 OFFSET ?"
            params.append(offset)
        rows = self._conn.execute(sql, params).fetchall()
        return [_row_to_bundle(r) for r in rows]

    def count(
        self,
        *,
        category_id: str | None = None,
        query: str | None = None,
        favorites_only: bool = False,
    ) -> int:
        where, params = self._build_filter_clause(
            category_id=category_id, query=query,
            favorites_only=favorites_only,
        )
        sql = "SELECT COUNT(*) AS n FROM bundles" + where
        row = self._conn.execute(sql, params).fetchone()
        return int(row["n"]) if row is not None else 0
