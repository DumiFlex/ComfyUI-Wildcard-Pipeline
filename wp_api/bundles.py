"""/wp/api/bundles CRUD + favorite endpoints.

Mirrors `wp_api.modules` shape so SPA Library code (fetchers,
filters, sorts) can reuse its existing patterns. Bundles intentionally
do NOT expose snapshot / embed-bundle / match endpoints — bundles are
themselves the frozen snapshot package, so re-snapshotting at insert
time is a no-op."""
from __future__ import annotations

import sqlite3

from aiohttp import web

from engine.db.repositories import BundleNotFound, BundleRepository
from engine.modules.dispatcher import get_handler
from wp_api._helpers import db_session, json_error, json_ok
from wp_api._validators import validate_body_size, validate_meta

_UPDATABLE_FIELDS = (
    "name", "description", "color", "category_id", "tags",
    "children", "is_favorite",
)


def _dedupe_children(children: list[dict]) -> list[dict]:
    """Drop second+ occurrences of any child sharing an ``id`` with an
    earlier child in the same list.

    Without this guard the same module could appear twice (or three,
    four) times in ``children[]`` and every propagation pass would
    rewrite every copy identically — harmless but bloats the bundle
    payload and confuses the SPA bundle preview (two "framing" cards,
    same id). Order is preserved; the first occurrence wins.
    """
    seen: set[str] = set()
    out: list[dict] = []
    for child in children:
        if not isinstance(child, dict):
            out.append(child)
            continue
        cid = child.get("id")
        if isinstance(cid, str) and cid in seen:
            continue
        if isinstance(cid, str):
            seen.add(cid)
        out.append(child)
    return out


def _auto_suffix_bundle_name(repo: BundleRepository, name: str) -> str:
    """If ``name`` is already taken by another bundle in the library,
    append ``" (copy)"`` / ``" (copy 2)"`` / etc. until a free name is
    found. Mirrors ``forkModule``'s collision rule on the modules side
    so the two surfaces feel the same.

    Walks every bundle once (library volumes are dozens, not thousands).
    """
    existing = {b["name"] for b in repo.list()}
    if name not in existing:
        return name
    candidate = f"{name} (copy)"
    i = 2
    while candidate in existing:
        candidate = f"{name} (copy {i})"
        i += 1
    return candidate


def _validate_children_payloads(children: object) -> str | None:
    """Run ``handler.validate_payload`` against every child's payload.

    Bundles ship a frozen ``children`` array; without this guard the
    bundle endpoint is a side door that bypasses the per-module
    validation enforced on POST/PUT ``/wp/api/modules``. Returns an
    error string when any child is malformed, ``None`` when every
    payload passes. Children without a registered handler are skipped
    silently (mirrors the module-side behavior for unknown types).
    """
    if children is None:
        return None
    if not isinstance(children, list):
        return "children must be a list"
    for i, child in enumerate(children):
        if not isinstance(child, dict):
            return f"children[{i}] must be an object"
        type_id = child.get("type")
        payload = child.get("payload")
        if type_id is None or payload is None:
            # Children may legitimately omit `payload` for inline
            # entries; only validate when both fields are present.
            continue
        handler = get_handler(type_id)
        if handler is None:
            continue
        try:
            handler.validate_payload(payload)
        except ValueError as exc:
            return f"children[{i}].payload: {exc}"
    return None


async def list_bundles(request: web.Request) -> web.Response:
    """GET /wp/api/bundles — paginated listing with optional filters.

    Filters mirror modules: `category`, `q` (name search), `favorites=1`.
    Additionally accepts `contains_module=<id>` which restricts the result
    to bundles whose ``children[]`` snapshot references that module id —
    used by the save-to-library modal to show which bundles a save would
    affect.

    Returns `{items, total}` so the Dashboard count cards work the same
    way they do for modules."""
    category_id = request.query.get("category")
    query = request.query.get("q")
    favorites = request.query.get("favorites") == "1"
    contains_module = request.query.get("contains_module")
    try:
        limit = int(request.query["limit"]) if "limit" in request.query else None
        offset = int(request.query.get("offset", 0))
    except ValueError:
        return json_error("limit/offset must be integers", status=400)
    if limit is not None and limit < 0:
        return json_error("limit must be non-negative", status=400)
    if offset < 0:
        return json_error("offset must be non-negative", status=400)

    with db_session(request) as conn:
        repo = BundleRepository(conn)
        items = repo.list(
            category_id=category_id, query=query,
            favorites_only=favorites, limit=limit, offset=offset,
        )
        total = repo.count(
            category_id=category_id, query=query,
            favorites_only=favorites,
        )
    if contains_module:
        # Children are stored as JSON; SQLite has no efficient nested-array
        # contains. Library volumes are dozens of bundles — Python filter
        # is fast enough and keeps the SQL portable.
        items = [
            b for b in items
            if any(
                isinstance(c, dict) and c.get("id") == contains_module
                for c in (b.get("children") or [])
            )
        ]
        total = len(items)
    return json_ok({"items": items, "total": total})


async def create_bundle(request: web.Request) -> web.Response:
    """POST /wp/api/bundles — author a new bundle in the library.

    Required: `name` (display name). Optional: `description`, `color`
    (user-picked hex), `category_id`, `tags`, `children` (deep-cloned
    module snapshots), `is_favorite`.

    Children are stored verbatim except for id-dedup — caller
    (typically the SPA bundle editor) is responsible for ensuring each
    child is a self-contained snapshot the frontend `remapBundleUuids`
    helper can consume at insert time. Duplicate ids are silently
    dropped (first occurrence wins).

    Name collisions are auto-suffixed with `(copy)` / `(copy N)` so
    library picker dropdowns stay unambiguous.
    """
    err = validate_body_size(request.content_length)
    if err is not None:
        return json_error(err, status=400)
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    if "name" not in body:
        return json_error("missing field: name", status=400)
    err = validate_meta(body)
    if err is not None:
        return json_error(err, status=400)

    children_raw = body.get("children")
    err = _validate_children_payloads(children_raw)
    if err is not None:
        return json_error(err, status=400)
    children = _dedupe_children(children_raw) if isinstance(children_raw, list) else []

    try:
        with db_session(request) as conn:
            repo = BundleRepository(conn)
            unique_name = _auto_suffix_bundle_name(repo, body["name"])
            row = repo.create(
                name=unique_name,
                description=body.get("description", ""),
                color=body.get("color"),
                category_id=body.get("category_id"),
                tags=body.get("tags", []),
                children=children,
                is_favorite=bool(body.get("is_favorite", False)),
            )
    except ValueError as e:
        return json_error(str(e), status=400)
    except sqlite3.IntegrityError as e:
        return json_error(f"foreign-key constraint failed: {e}", status=400)
    return json_ok(row, status=201)


async def get_bundle(request: web.Request) -> web.Response:
    """GET /wp/api/bundles/{id} — full bundle row including the
    `children` JSON array. SPA bundle picker uses this to populate
    the right-pane preview when a row is focused."""
    bundle_id = request.match_info["id"]
    with db_session(request) as conn:
        try:
            row = BundleRepository(conn).get(bundle_id)
        except BundleNotFound:
            return json_error(f"bundle {bundle_id!r} not found", status=404)
    return json_ok(row)


async def update_bundle(request: web.Request) -> web.Response:
    """PUT /wp/api/bundles/{id} — partial update. Body must be a JSON
    object containing any subset of {name, description, color,
    category_id, tags, children, is_favorite}. Unknown fields are
    ignored.

    Optional ``If-Match: <version>`` request header enables optimistic
    concurrency. See `wp_api.modules.update_module` for the contract.

    Children changes recompute `payload_hash`; pure-cosmetic field
    changes (rename, recolor) leave the hash unchanged so inserted
    instances don't flag a spurious "library updated" hint."""
    bundle_id = request.match_info["id"]
    err = validate_body_size(request.content_length)
    if err is not None:
        return json_error(err, status=400)
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    err = validate_meta(body)
    if err is not None:
        return json_error(err, status=400)
    patch = {k: body[k] for k in _UPDATABLE_FIELDS if k in body}
    if "children" in patch:
        err = _validate_children_payloads(patch["children"])
        if err is not None:
            return json_error(err, status=400)
        if isinstance(patch["children"], list):
            patch["children"] = _dedupe_children(patch["children"])

    expected_version_raw = request.headers.get("If-Match")
    expected_version: int | None = None
    if expected_version_raw is not None:
        try:
            expected_version = int(expected_version_raw.strip().strip('"'))
        except ValueError:
            return json_error("If-Match must be an integer version", status=400)

    with db_session(request) as conn:
        repo = BundleRepository(conn)
        if expected_version is not None:
            try:
                current = repo.get(bundle_id)
            except BundleNotFound:
                return json_error(f"bundle {bundle_id!r} not found", status=404)
            if current["version"] != expected_version:
                return json_error(
                    f"version mismatch: If-Match={expected_version} but "
                    f"current version is {current['version']}",
                    status=409,
                )
        # Auto-suffix rename collisions only when the new name actually
        # changed AND collides with a DIFFERENT row. PUTting a row with
        # its own current name must be a no-op for the suffix logic.
        if "name" in patch and isinstance(patch["name"], str):
            others = {b["name"] for b in repo.list() if b["id"] != bundle_id}
            if patch["name"] in others:
                patch["name"] = _auto_suffix_bundle_name(repo, patch["name"])
        try:
            row = repo.update(bundle_id, **patch)
        except BundleNotFound:
            return json_error(f"bundle {bundle_id!r} not found", status=404)
        except sqlite3.IntegrityError as e:
            return json_error(f"foreign-key constraint failed: {e}", status=400)
    return json_ok(row)


async def delete_bundle(request: web.Request) -> web.Response:
    """DELETE /wp/api/bundles/{id} — remove from library.

    Inserted instances of this bundle in any saved workflow stay
    functional (children are frozen copies) — but their `library_id`
    will fail to resolve, surfacing the "library entry deleted" state
    on the bundle header."""
    bundle_id = request.match_info["id"]
    with db_session(request) as conn:
        try:
            BundleRepository(conn).delete(bundle_id)
        except BundleNotFound:
            return json_error(f"bundle {bundle_id!r} not found", status=404)
    return json_ok({"deleted": bundle_id})


async def toggle_favorite(request: web.Request) -> web.Response:
    """POST /wp/api/bundles/{id}/favorite — flip the is_favorite flag.
    Body optional; takes `{is_favorite: bool}` for explicit set,
    otherwise toggles."""
    bundle_id = request.match_info["id"]
    explicit: bool | None = None
    if request.body_exists:
        try:
            body = await request.json()
            if isinstance(body, dict) and "is_favorite" in body:
                explicit = bool(body["is_favorite"])
        except Exception:
            pass
    with db_session(request) as conn:
        repo = BundleRepository(conn)
        try:
            cur = repo.get(bundle_id)
        except BundleNotFound:
            return json_error(f"bundle {bundle_id!r} not found", status=404)
        new_state = (
            explicit if explicit is not None else not bool(cur["is_favorite"])
        )
        row = repo.update(bundle_id, is_favorite=new_state)
    return json_ok(row)


async def list_hashes(request: web.Request) -> web.Response:
    """GET /wp/api/bundles/hashes — bulk hash fetch for bundle-drift
    detection. Mirrors `/wp/api/modules/hashes` shape so the SPA's
    drift-store can poll both endpoints with the same handler. Used
    by the in-graph WP_Context widget to compare each BundleInstance's
    `inserted_at_hash` against the library's current `payload_hash`,
    surfacing a "library updated" indicator on bundle headers whose
    library entry has changed since insert."""
    with db_session(request) as conn:
        rows = BundleRepository(conn).list()
    return json_ok({
        "hashes": {row["id"]: row["payload_hash"] for row in rows},
    })


def register(router) -> None:
    router.add_get("/wp/api/bundles/hashes", list_hashes)
    router.add_get("/wp/api/bundles", list_bundles)
    router.add_post("/wp/api/bundles", create_bundle)
    router.add_get("/wp/api/bundles/{id}", get_bundle)
    router.add_put("/wp/api/bundles/{id}", update_bundle)
    router.add_delete("/wp/api/bundles/{id}", delete_bundle)
    router.add_post("/wp/api/bundles/{id}/favorite", toggle_favorite)
