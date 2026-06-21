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
from wp_api.modules import _hydrate_constraint_exceptions

_UPDATABLE_FIELDS = (
    "name", "description", "color", "category_id", "tags",
    "children", "is_favorite", "content_rating",
)


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


# Fields kept on a bundle-typed child entry. Bundle children are stored
# as REFERENCES, not snapshots — only the pointer fields survive. The
# actual inner-bundle contents are resolved at read time via
# `_expand_bundle_children` so the SPA always sees current state.
_BUNDLE_REF_FIELDS = ("id", "type", "name", "color")


def _strip_bundle_ref(child: dict) -> dict:
    """Reduce a bundle-typed child entry to its reference fields.

    SPA editors may forward the server-expanded `children` array back on
    save (round-trip the GET shape verbatim); stripping it here keeps the
    database row free of stale snapshots that would diverge from the
    referenced bundle's actual state. Display fields (`name`, `color`)
    are preserved as a cache so the parent renders something sensible if
    the referenced bundle is later deleted.
    """
    return {k: child[k] for k in _BUNDLE_REF_FIELDS if k in child}


def _normalise_bundle_children(children: list) -> list:
    """Walk children and rewrite any bundle-typed entry to its reference
    form. Leaf children pass through unchanged."""
    out: list = []
    for child in children:
        if isinstance(child, dict) and child.get("type") == "bundle":
            out.append(_strip_bundle_ref(child))
        else:
            out.append(child)
    return out


def _validate_bundle_refs(
    children: object,
    repo: BundleRepository,
    self_id: str | None,
) -> str | None:
    """Enforce the Tier-2 bundle reference rule.

    A bundle ``A`` may reference another bundle ``B`` as a child *only
    if* ``B`` itself has no bundle children of its own. References are
    resolved against the live ``BundleRepository`` (not the request
    body), so a stale snapshot embedded in the request can't slip a
    tier-3 structure past the validator.

    Rejected cases:

    - Self-include (``A → A``): a child references the parent's own id.
      PUT only — POST creates a new id so this can't happen.
    - Missing target: the referenced bundle id doesn't exist in the
      library. Refuse rather than store a dangling pointer.
    - Tier 3+: the referenced bundle's children already contain a
      bundle entry. ``A → B → C`` is out of scope.

    Returns an error string on rejection, ``None`` otherwise.
    """
    if not isinstance(children, list):
        return None
    for i, child in enumerate(children):
        if not isinstance(child, dict) or child.get("type") != "bundle":
            continue
        ref_id = child.get("id")
        if not isinstance(ref_id, str):
            return f"children[{i}]: bundle reference must have an `id` string"
        if self_id and ref_id == self_id:
            return f"children[{i}]: bundle cannot include itself"
        try:
            target = repo.get(ref_id)
        except BundleNotFound:
            return f"children[{i}]: referenced bundle {ref_id!r} not found"
        target_children = target.get("children") or []
        if not isinstance(target_children, list):
            continue
        for j, gc in enumerate(target_children):
            if isinstance(gc, dict) and gc.get("type") == "bundle":
                return (
                    f"children[{i}]: referenced bundle {ref_id!r} already "
                    f"contains a bundle child at children[{j}] — bundle "
                    f"nesting is limited to tier 2"
                )
    return None


def _find_parents_referencing(
    repo: BundleRepository,
    bundle_id: str,
) -> list[dict]:
    """Return every bundle row whose children include a bundle reference
    pointing at ``bundle_id``. Library volumes are small, so a full scan
    is acceptable.

    Used by the bilateral tier-2 integrity check: a bundle that other
    bundles reference may not gain bundle children of its own, because
    doing so would silently turn every parent's reference into a tier-3
    structure on read.
    """
    out: list[dict] = []
    for candidate in repo.list():
        children = candidate.get("children") or []
        if not isinstance(children, list):
            continue
        for child in children:
            if (
                isinstance(child, dict)
                and child.get("type") == "bundle"
                and child.get("id") == bundle_id
            ):
                out.append(candidate)
                break
    return out


def _validate_parents_compatible(
    new_children: object,
    repo: BundleRepository,
    bundle_id: str,
) -> str | None:
    """Bilateral tier-2 integrity check.

    The ``_validate_bundle_refs`` rule rejects building ``A → B → C`` at
    A's write time, but B can later add a bundle child *unilaterally*
    and silently demote every parent A's view to tier 3. To keep the
    tier-2 ceiling honest from both sides, reject B's update when B is
    referenced by another bundle AND the new children introduce a
    bundle entry.

    Renames / recolors / leaf-only edits pass through untouched: only
    the act of adding (or keeping) a bundle child while parents exist
    is the violation.
    """
    if not isinstance(new_children, list):
        return None
    has_bundle_child = any(
        isinstance(c, dict) and c.get("type") == "bundle"
        for c in new_children
    )
    if not has_bundle_child:
        return None
    parents = _find_parents_referencing(repo, bundle_id)
    if not parents:
        return None
    # Be concrete about which parents would break — the SPA can route
    # the user to break the reference first.
    parent_summary = ", ".join(f"{p['name']!r} ({p['id']})" for p in parents[:3])
    if len(parents) > 3:
        parent_summary += f", … {len(parents) - 3} more"
    return (
        f"cannot add a bundle child: this bundle is already referenced "
        f"by {len(parents)} parent bundle(s) — {parent_summary} — and "
        f"the tier-2 nesting cap forbids the resulting tier-3 structure"
    )


def _expand_bundle_children(
    children: list,
    repo: BundleRepository,
) -> list:
    """Server-side resolve every bundle-typed reference inline.

    The DB stores bundle children as references (id-only pointers); on
    read we attach the referenced bundle's *current* ``children`` array
    under the same key so the SPA pre-flatten path (which inlines a
    bundle child's grandchildren at insert time) keeps working without
    knowing the difference. Missing references survive as the bare
    reference shape so the SPA can flag a stale parent.
    """
    out: list = []
    for child in children:
        if not isinstance(child, dict) or child.get("type") != "bundle":
            out.append(child)
            continue
        ref_id = child.get("id")
        expanded = dict(child)
        if isinstance(ref_id, str):
            try:
                target = repo.get(ref_id)
                expanded["children"] = target.get("children") or []
                # Refresh display fields off the live target so renames
                # propagate. The cached values on the parent only matter
                # when the target is missing.
                if "name" in target:
                    expanded["name"] = target["name"]
                if "color" in target:
                    expanded["color"] = target["color"]
                expanded["_resolved_from"] = ref_id
            except BundleNotFound:
                expanded["_missing_ref"] = True
        out.append(expanded)
    return out


def _validate_children_payloads(children: object, conn=None) -> str | None:
    """Run ``handler.validate_payload`` against every child's payload.

    Bundles ship a frozen ``children`` array; without this guard the
    bundle endpoint is a side door that bypasses the per-module
    validation enforced on POST/PUT ``/wp/api/modules``. Returns an
    error string when any child is malformed, ``None`` when every
    payload passes. Children without a registered handler are skipped
    silently (mirrors the module-side behavior for unknown types).

    When *conn* is provided, constraint children get the same exception
    hydration as the modules endpoint runs — id-only exceptions (e.g.
    ``{"source_id": "opt_4"}`` with no ``source`` string) get their
    ``source_value`` / ``target_value`` filled in from the referenced
    wildcard's option list before validation. Without this, bundle
    save would surface ``constraint payload.exceptions[0].source must
    be a non-empty string`` for the same legacy library rows that the
    modules path already heals.
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
        if type_id == "constraint" and conn is not None:
            _hydrate_constraint_exceptions(conn, payload)
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

    try:
        with db_session(request) as conn:
            # Validation runs inside the session so constraint children
            # can hydrate `source_value` / `target_value` strings from
            # their referenced wildcard's option list before the per-
            # kind validator runs — see `_validate_children_payloads`.
            err = _validate_children_payloads(children_raw, conn)
            if err is not None:
                return json_error(err, status=400)
            repo = BundleRepository(conn)
            # Bundle references resolved against live repo state — must
            # happen inside the session so the check sees committed rows.
            err = _validate_bundle_refs(children_raw, repo, self_id=None)
            if err is not None:
                return json_error(err, status=400)
            if isinstance(children_raw, list):
                # Keep duplicate child ids — multi-instance bundles
                # (e.g. one wildcard used 3×) repeat an id on purpose;
                # per-instance `_uid` is stamped at Context-insert time.
                children = _normalise_bundle_children(children_raw)
            else:
                children = []
            unique_name = _auto_suffix_bundle_name(repo, body["name"])
            row = repo.create(
                name=unique_name,
                description=body.get("description", ""),
                color=body.get("color"),
                category_id=body.get("category_id"),
                tags=body.get("tags", []),
                children=children,
                is_favorite=bool(body.get("is_favorite", False)),
                content_rating=body.get("content_rating", "safe"),
            )
            row["children"] = _expand_bundle_children(row.get("children") or [], repo)
    except ValueError as e:
        return json_error(str(e), status=400)
    except sqlite3.IntegrityError as e:
        return json_error(f"foreign-key constraint failed: {e}", status=400)
    return json_ok(row, status=201)


async def get_bundle(request: web.Request) -> web.Response:
    """GET /wp/api/bundles/{id} — full bundle row including the
    `children` JSON array. SPA bundle picker uses this to populate
    the right-pane preview when a row is focused.

    Bundle-typed children are stored as references; this endpoint
    resolves each one against the current library state and attaches
    the inner bundle's children inline, so consumers always see fresh
    nested contents. Missing references survive as the bare reference
    shape so callers can flag a stale parent."""
    bundle_id = request.match_info["id"]
    with db_session(request) as conn:
        repo = BundleRepository(conn)
        try:
            row = repo.get(bundle_id)
        except BundleNotFound:
            return json_error(f"bundle {bundle_id!r} not found", status=404)
        row["children"] = _expand_bundle_children(row.get("children") or [], repo)
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

    expected_version_raw = request.headers.get("If-Match")
    expected_version: int | None = None
    if expected_version_raw is not None:
        try:
            expected_version = int(expected_version_raw.strip().strip('"'))
        except ValueError:
            return json_error("If-Match must be an integer version", status=400)

    with db_session(request) as conn:
        if "children" in patch:
            # Hydration + validation inside the session so constraint
            # children can fill `source_value` / `target_value` from
            # the referenced wildcards' options before the per-kind
            # validator runs (matches the create path).
            err = _validate_children_payloads(patch["children"], conn)
            if err is not None:
                return json_error(err, status=400)
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
        if "children" in patch:
            # Bundle references resolved against live repo state — must
            # run inside the session so self_id (the bundle being PUT)
            # is checked against the same view of the world that the
            # write will commit against.
            err = _validate_bundle_refs(
                patch["children"], repo, self_id=bundle_id,
            )
            if err is not None:
                return json_error(err, status=400)
            # Bilateral tier-2 check: if this bundle is referenced by
            # any other bundle, it cannot gain bundle children of its
            # own (would turn every parent's reference into a tier-3
            # structure). Refuse the write rather than letting a stale
            # ceiling slip through.
            err = _validate_parents_compatible(
                patch["children"], repo, bundle_id=bundle_id,
            )
            if err is not None:
                return json_error(err, status=409)
            if isinstance(patch["children"], list):
                # Preserve duplicates (see create path) — no dedupe.
                patch["children"] = _normalise_bundle_children(patch["children"])
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
        row["children"] = _expand_bundle_children(row.get("children") or [], repo)
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


async def set_community_origin(request: web.Request) -> web.Response:
    """POST /wp/api/bundles/{id}/community-origin -- stamp the bundle
    row as published. See modules.set_community_origin for rationale."""
    bundle_id = request.match_info["id"]
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    slug = body.get("post_slug")
    version = body.get("version_number")
    if not isinstance(slug, str) or not slug:
        return json_error("post_slug must be a non-empty string", status=400)
    if not isinstance(version, int) or isinstance(version, bool):
        return json_error("version_number must be an integer", status=400)
    with db_session(request) as conn:
        repo = BundleRepository(conn)
        try:
            row = repo.set_community_origin(
                bundle_id, post_slug=slug, version_number=version,
            )
        except BundleNotFound:
            return json_error(f"bundle {bundle_id!r} not found", status=404)
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
    router.add_post(
        "/wp/api/bundles/{id}/community-origin", set_community_origin,
    )
