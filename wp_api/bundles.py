"""/wp/api/bundles CRUD + favorite endpoints.

Mirrors `wp_api.modules` shape so SPA Library code (fetchers,
filters, sorts) can reuse its existing patterns. Bundles intentionally
do NOT expose snapshot / embed-bundle / match endpoints — bundles are
themselves the frozen snapshot package, so re-snapshotting at insert
time is a no-op."""
from __future__ import annotations

from aiohttp import web

from engine.db.repositories import BundleNotFound, BundleRepository
from engine.modules.dispatcher import get_handler
from wp_api._helpers import db_session, json_error, json_ok

_UPDATABLE_FIELDS = (
    "name", "description", "color", "category_id", "tags",
    "children", "is_favorite",
)


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
    Returns `{items, total}` so the Dashboard count cards work the same
    way they do for modules."""
    category_id = request.query.get("category")
    query = request.query.get("q")
    favorites = request.query.get("favorites") == "1"
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
    return json_ok({"items": items, "total": total})


async def create_bundle(request: web.Request) -> web.Response:
    """POST /wp/api/bundles — author a new bundle in the library.

    Required: `name` (display name). Optional: `description`, `color`
    (user-picked hex), `category_id`, `tags`, `children` (deep-cloned
    module snapshots), `is_favorite`.

    Children are stored verbatim — caller (typically the SPA bundle
    editor) is responsible for ensuring each child is a self-contained
    snapshot the frontend `remapBundleUuids` helper can consume at
    insert time."""
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    if "name" not in body:
        return json_error("missing field: name", status=400)

    err = _validate_children_payloads(body.get("children"))
    if err is not None:
        return json_error(err, status=400)

    try:
        with db_session(request) as conn:
            row = BundleRepository(conn).create(
                name=body["name"],
                description=body.get("description", ""),
                color=body.get("color"),
                category_id=body.get("category_id"),
                tags=body.get("tags", []),
                children=body.get("children", []),
                is_favorite=bool(body.get("is_favorite", False)),
            )
    except ValueError as e:
        return json_error(str(e), status=400)
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

    Children changes recompute `payload_hash`; pure-cosmetic field
    changes (rename, recolor) leave the hash unchanged so inserted
    instances don't flag a spurious "library updated" hint."""
    bundle_id = request.match_info["id"]
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    patch = {k: body[k] for k in _UPDATABLE_FIELDS if k in body}
    if "children" in patch:
        err = _validate_children_payloads(patch["children"])
        if err is not None:
            return json_error(err, status=400)
    with db_session(request) as conn:
        try:
            row = BundleRepository(conn).update(bundle_id, **patch)
        except BundleNotFound:
            return json_error(f"bundle {bundle_id!r} not found", status=404)
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
