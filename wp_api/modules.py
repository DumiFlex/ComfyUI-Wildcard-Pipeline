"""/wp/api/modules CRUD + snapshot + match + duplicate + favorite endpoints."""
from __future__ import annotations

import sqlite3

from aiohttp import web

from engine.db.repositories import BundleRepository, ModuleNotFound, ModuleRepository
from engine.modules.dispatcher import get_handler
from engine.modules.snapshot import freeze_snapshot, payload_hash
from wp_api._helpers import db_session, json_error, json_ok
from wp_api._validators import validate_body_size, validate_meta, validate_wildcard_name


def _hydrate_constraint_exceptions(conn, payload: dict) -> None:
    """Fill missing ``source`` / ``target`` value strings on a constraint
    payload's exceptions from the referenced wildcards' option ids.

    Older saves stored exceptions with only ``source_id`` / ``target_id``
    (no string field), which the engine's ``validate_payload`` rejects
    because the runtime resolver still keys instance-override lookups
    by ``(source_value, target_value)`` pairs. Hydrating server-side
    means clients can keep sending id-only exceptions without every
    save endpoint duplicating the wildcard-option lookup.

    Mutates *payload* in place. Skips exceptions that already have a
    non-empty ``source``/``source_value`` (and same for target). Skips
    silently if the referenced wildcard is missing or the option id no
    longer exists — the engine validator will surface a clearer error
    than a half-applied hydration would.
    """
    if not isinstance(payload, dict):
        return
    excs = payload.get("exceptions")
    if not isinstance(excs, list) or not excs:
        return
    repo = ModuleRepository(conn)

    def _opt_value(wid: object, oid: object) -> str | None:
        if not isinstance(wid, str) or not isinstance(oid, str):
            return None
        try:
            row = repo.get(wid)
        except ModuleNotFound:
            return None
        if row.get("type") != "wildcard":
            return None
        for opt in (row.get("payload") or {}).get("options") or []:
            if opt.get("id") == oid:
                v = opt.get("value")
                return v if isinstance(v, str) else None
        return None

    src_wid = payload.get("source_wildcard_id")
    tgt_wid = payload.get("target_wildcard_id")
    # Per-(wid, oid) cache so a constraint with N exceptions referencing
    # the same option doesn't refetch the wildcard row N times.
    cache: dict[tuple[str, str], str | None] = {}

    def _lookup(wid: object, oid: object) -> str | None:
        if not isinstance(wid, str) or not isinstance(oid, str):
            return None
        key = (wid, oid)
        if key in cache:
            return cache[key]
        v = _opt_value(wid, oid)
        cache[key] = v
        return v

    for exc in excs:
        if not isinstance(exc, dict):
            continue
        # Skip exceptions that already carry a usable source/target.
        # Mirror the engine's "legacy or tier-2" check so we only fill
        # the field the validator would otherwise reject.
        if not (exc.get("source") or exc.get("source_value")):
            v = _lookup(src_wid, exc.get("source_id"))
            if v:
                exc["source_value"] = v
        if not (exc.get("target") or exc.get("target_value")):
            v = _lookup(tgt_wid, exc.get("target_id"))
            if v:
                exc["target_value"] = v


def _validate_payload_for_type(type_id: str, payload: dict) -> str | None:
    """Run the registered ``validate_payload`` for this module type.

    Returns the error string when the payload is malformed, or ``None``
    when it passes. Unknown types skip validation (the create/PUT path
    rejects unknown types separately via the repository layer).
    """
    handler = get_handler(type_id)
    if handler is None:
        return None
    try:
        handler.validate_payload(payload)
    except ValueError as exc:
        return str(exc)
    return None

_UPDATABLE_FIELDS = (
    "name", "description", "tags", "payload", "is_favorite", "category_id",
)


def _propagate_module_to_bundles(conn, module_row: dict) -> list[str]:
    """Rewrite every bundle's child snapshot whose id matches the updated
    module so the bundle's frozen ``children[]`` reflects the new payload
    + meta. Returns the list of bundle ids whose children were rewritten.

    Bundles store children as a JSON blob; SQLite has no efficient
    contains-key query for nested arrays. Library volumes are dozens of
    bundles, not thousands — Python-side filter is fine.
    """
    mid = module_row["id"]
    bundle_repo = BundleRepository(conn)
    affected: list[str] = []
    for bundle in bundle_repo.list():
        children = bundle.get("children") or []
        if not isinstance(children, list):
            continue
        rewritten = False
        new_children: list[dict] = []
        for child in children:
            if isinstance(child, dict) and child.get("id") == mid:
                # Overwrite payload + meta but preserve any per-bundle
                # fields the snapshot carries (enabled/collapsed flags,
                # bundle-scope instance overrides, etc).
                next_child = dict(child)
                next_child["payload"] = module_row["payload"]
                next_child["payload_hash"] = module_row["payload_hash"]
                meta = next_child.get("meta")
                if not isinstance(meta, dict):
                    meta = {}
                # Library name/description/tags become the authoritative
                # source for the child snapshot too — keeps drift detection
                # honest when the user later opens this bundle elsewhere.
                meta["name"] = module_row["name"]
                meta["library_name"] = module_row["name"]
                if module_row.get("description") is not None:
                    meta["description"] = module_row["description"]
                if module_row.get("tags") is not None:
                    meta["tags"] = list(module_row["tags"])
                next_child["meta"] = meta
                new_children.append(next_child)
                rewritten = True
            else:
                new_children.append(child)
        if rewritten:
            bundle_repo.update(bundle["id"], children=new_children)
            affected.append(bundle["id"])
    return affected


async def list_modules(request: web.Request) -> web.Response:
    type_ = request.query.get("type")
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
        repo = ModuleRepository(conn)
        items = repo.list(
            type=type_, category_id=category_id, query=query,
            favorites_only=favorites, limit=limit, offset=offset,
        )
        # `total` is the unpaginated count so the SPA Dashboard can show
        # "Wildcards: 15" even when limit=1 was passed for cheap polling.
        total = repo.count(
            type=type_, category_id=category_id, query=query,
            favorites_only=favorites,
        )
    return json_ok({"items": items, "total": total})


async def create_module(request: web.Request) -> web.Response:
    err = validate_body_size(request.content_length)
    if err is not None:
        return json_error(err, status=400)
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    required = {"type", "name", "payload"}
    missing = required - body.keys()
    if missing:
        return json_error(f"missing fields: {sorted(missing)}", status=400)
    err = validate_meta(body)
    if err is not None:
        return json_error(err, status=400)
    # Wildcard names become the `#name` segment of nested refs — block
    # ref-grammar-reserved chars here so the engine never stores a name
    # the regex can't parse back.
    if body["type"] == "wildcard":
        err = validate_wildcard_name(body["name"])
        if err is not None:
            return json_error(err, status=400)

    try:
        with db_session(request) as conn:
            if body["type"] == "constraint":
                _hydrate_constraint_exceptions(conn, body["payload"])
            err = _validate_payload_for_type(body["type"], body["payload"])
            if err is not None:
                return json_error(err, status=400)
            row = ModuleRepository(conn).create(
                type=body["type"], name=body["name"],
                description=body.get("description", ""),
                category_id=body.get("category_id"),
                tags=body.get("tags", []),
                payload=body["payload"],
                is_favorite=bool(body.get("is_favorite", False)),
            )
    except ValueError as e:
        return json_error(str(e), status=400)
    except sqlite3.IntegrityError as e:
        # Most common: caller passed a `category_id` that doesn't exist
        # in the categories table. Pre-fix this surfaced as a 500 with
        # a stack trace; surface it as a clean 400 instead so the
        # client can act on the error.
        return json_error(f"foreign-key constraint failed: {e}", status=400)
    return json_ok(row, status=201)


async def import_from_workflow(request: web.Request) -> web.Response:
    """Insert a workflow-resident module snapshot into the library at
    its existing 8-hex uuid. Used by the ContextWidget's
    "Save to library" action when a loaded workflow contains a module
    not present in this user's library.

    Differs from `create_module` in that the caller supplies the id;
    we preserve it so existing `@{uuid}` refs in other workflows /
    modules don't break. Returns 409 if the id is already taken
    (the indicator dot would already be cleared, so this should
    only fire on race).
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
    required = {"id", "type", "name", "payload"}
    missing = required - body.keys()
    if missing:
        return json_error(f"missing fields: {sorted(missing)}", status=400)
    err = validate_meta(body)
    if err is not None:
        return json_error(err, status=400)
    if body["type"] == "wildcard":
        err = validate_wildcard_name(body["name"])
        if err is not None:
            return json_error(err, status=400)

    try:
        with db_session(request) as conn:
            if body["type"] == "constraint":
                _hydrate_constraint_exceptions(conn, body["payload"])
            err = _validate_payload_for_type(body["type"], body["payload"])
            if err is not None:
                return json_error(err, status=400)
            repo = ModuleRepository(conn)
            try:
                repo.get(body["id"])
                return json_error(f"module {body['id']} already exists", status=409)
            except ModuleNotFound:
                pass  # expected — that's the whole point of the endpoint
            row = repo.create(
                id=body["id"],
                type=body["type"], name=body["name"],
                description=body.get("description", ""),
                category_id=body.get("category_id"),
                tags=body.get("tags", []),
                payload=body["payload"],
                is_favorite=bool(body.get("is_favorite", False)),
            )
    except ValueError as e:
        return json_error(str(e), status=400)
    except sqlite3.IntegrityError as e:
        return json_error(f"foreign-key constraint failed: {e}", status=400)
    return json_ok(row, status=201)


async def get_module(request: web.Request) -> web.Response:
    mid = request.match_info["id"]
    with db_session(request) as conn:
        try:
            row = ModuleRepository(conn).get(mid)
        except ModuleNotFound:
            return json_error(f"module not found: {mid}", status=404)
    return json_ok(row)


async def update_module(request: web.Request) -> web.Response:
    """PUT /wp/api/modules/{id} — partial update.

    Accepts any subset of {name, description, tags, payload, is_favorite,
    category_id} plus an optional ``propagate_to_bundles`` boolean (default
    true) that controls whether saved bundles containing this module get
    their child snapshots refreshed in lockstep.

    When ``payload`` is present the new value is validated via the
    registered module handler before write — same guard as POST and
    import-from-workflow.

    Optional ``If-Match: <version>`` request header enables optimistic
    concurrency: if the row's current ``version`` no longer matches
    the value the client last saw, the PUT is rejected with ``409``
    instead of silently overwriting another writer's work. Header is
    opt-in — omitting it preserves the legacy last-write-wins behavior.

    Response shape on success:
      {<module fields>, "bundles_updated": ["bundle_id_1", ...]}
    """
    mid = request.match_info["id"]
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
    # PUT body may rename without re-stating `type` — the wildcard name
    # guard needs the existing row's type. Defer the actual check until
    # we have the existing row in hand (next db_session below).
    kwargs: dict = {k: body[k] for k in _UPDATABLE_FIELDS if k in body}
    propagate = bool(body.get("propagate_to_bundles", True))

    # Optional optimistic-concurrency guard. Two-window edits previously
    # raced silently — both PUTs returned 200, last writer won. With
    # If-Match the second writer gets a 409 and can re-fetch.
    expected_version_raw = request.headers.get("If-Match")
    expected_version: int | None = None
    if expected_version_raw is not None:
        try:
            expected_version = int(expected_version_raw.strip().strip('"'))
        except ValueError:
            return json_error("If-Match must be an integer version", status=400)

    # If the caller is rewriting the payload, validate it against the
    # row's existing module type — same guard as POST/import-from-workflow.
    # Same lookup also feeds the wildcard-name char guard for renames.
    existing_type: str | None = None
    if "payload" in kwargs or "name" in kwargs:
        with db_session(request) as conn:
            try:
                existing = ModuleRepository(conn).get(mid)
            except ModuleNotFound:
                return json_error(f"module not found: {mid}", status=404)
            existing_type = existing["type"]
            if "payload" in kwargs and existing_type == "constraint":
                _hydrate_constraint_exceptions(conn, kwargs["payload"])
        if "payload" in kwargs and existing_type is not None:
            err = _validate_payload_for_type(existing_type, kwargs["payload"])
            if err is not None:
                return json_error(err, status=400)
    if "name" in kwargs and existing_type == "wildcard":
        err = validate_wildcard_name(kwargs["name"])
        if err is not None:
            return json_error(err, status=400)

    bundles_updated: list[str] = []
    with db_session(request) as conn:
        repo = ModuleRepository(conn)
        if expected_version is not None:
            try:
                current = repo.get(mid)
            except ModuleNotFound:
                return json_error(f"module not found: {mid}", status=404)
            if current["version"] != expected_version:
                return json_error(
                    f"version mismatch: If-Match={expected_version} but "
                    f"current version is {current['version']}",
                    status=409,
                )
        # Capture the row's pre-update name so we can detect renames
        # AFTER the update succeeds. Without this we'd need a second
        # repo.get() inside the rename branch — wasteful.
        pre_name: str | None = None
        if "name" in kwargs and existing_type == "wildcard":
            try:
                pre_name = repo.get(mid)["name"]
            except ModuleNotFound:
                pass
        try:
            row = repo.update(mid, **kwargs)
        except ModuleNotFound:
            return json_error(f"module not found: {mid}", status=404)
        except sqlite3.IntegrityError as e:
            return json_error(f"foreign-key constraint failed: {e}", status=400)
        # Wildcard rename: rewrite the `#name` segment of every
        # @{uuid...} ref in the library so workflows render the new
        # name everywhere. Runs inside the same transaction as the
        # update for atomicity. Skips when only the name CASE changed
        # and the engine considers them equivalent — cheapest skip is
        # "string equal".
        if (
            existing_type == "wildcard"
            and "name" in kwargs
            and pre_name is not None
            and pre_name != kwargs["name"]
        ):
            from engine.cascade.fixers import fix_wildcard_rename_name
            fix_wildcard_rename_name(conn, mid, kwargs["name"])
        # Bundle propagation runs in the same transaction so an update is
        # atomic across modules + bundles tables. Only fires when payload
        # or library-facing meta (name/description/tags) changed and the
        # caller hasn't opted out.
        propagatable_keys = {"payload", "name", "description", "tags"}
        if propagate and propagatable_keys & kwargs.keys():
            bundles_updated = _propagate_module_to_bundles(conn, row)

    out = dict(row)
    out["bundles_updated"] = bundles_updated
    return json_ok(out)


def _flag_orphaned_in_bundles(conn, module_id: str) -> list[str]:
    """Mark every bundle child snapshot whose ``id`` matches ``module_id``
    as orphaned so the SPA can surface a "library entry gone" badge.

    Bundles are deliberately self-contained — children stay as frozen
    payload snapshots even after the source module is deleted, so a
    user can still pull a working bundle into a workflow. The downside
    is that the bundle now references a phantom module with no live
    library ancestor. Stamping ``meta.orphaned = true`` (plus a
    timestamp) is the smallest structural change that keeps the
    snapshot intact while giving the UI something to filter on.

    Returns the list of bundle ids that had at least one child stamped.
    """
    from datetime import datetime, timezone

    bundle_repo = BundleRepository(conn)
    stamped_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    affected: list[str] = []
    for bundle in bundle_repo.list():
        children = bundle.get("children") or []
        if not isinstance(children, list):
            continue
        rewritten = False
        new_children: list[dict] = []
        for child in children:
            if isinstance(child, dict) and child.get("id") == module_id:
                next_child = dict(child)
                meta = next_child.get("meta")
                if not isinstance(meta, dict):
                    meta = {}
                if not meta.get("orphaned"):
                    meta = {**meta, "orphaned": True, "orphaned_at": stamped_at}
                    next_child["meta"] = meta
                    rewritten = True
                new_children.append(next_child)
            else:
                new_children.append(child)
        if rewritten:
            bundle_repo.update(bundle["id"], children=new_children)
            affected.append(bundle["id"])
    return affected


async def delete_module(request: web.Request) -> web.Response:
    mid = request.match_info["id"]
    with db_session(request) as conn:
        try:
            ModuleRepository(conn).delete(mid)
        except ModuleNotFound:
            return json_error(f"module not found: {mid}", status=404)
        # After the row's gone, flag any bundle children whose snapshot
        # pointed at this id so the SPA can render a "stale snapshot"
        # badge. Same transaction means the bundles never see a window
        # where the module is missing but children aren't flagged.
        _flag_orphaned_in_bundles(conn, mid)
    return web.Response(status=204)


async def snapshot_module(request: web.Request) -> web.Response:
    mid = request.match_info["id"]
    with db_session(request) as conn:
        try:
            row = ModuleRepository(conn).get(mid)
        except ModuleNotFound:
            return json_error(f"module not found: {mid}", status=404)
    return json_ok(freeze_snapshot(row))


async def match_module(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)
    required = {"type", "name", "payload_hash"}
    missing = required - body.keys()
    if missing:
        return json_error(f"missing fields: {sorted(missing)}", status=400)

    with db_session(request) as conn:
        rows = ModuleRepository(conn).list(type=body["type"], query=body["name"])
        for row in rows:
            if row["name"] != body["name"]:
                continue
            if payload_hash(row["payload"]) == body["payload_hash"]:
                return json_ok({
                    "matched": True, "id": row["id"], "version": row["version"],
                })
    return json_ok({"matched": False})


async def duplicate_module(request: web.Request) -> web.Response:
    mid = request.match_info["id"]
    with db_session(request) as conn:
        repo = ModuleRepository(conn)
        try:
            src = repo.get(mid)
        except ModuleNotFound:
            return json_error(f"module not found: {mid}", status=404)
        copy = repo.create(
            type=src["type"], name=f"{src['name']} (copy)",
            description=src["description"], category_id=src["category_id"],
            tags=list(src["tags"]), payload=src["payload"],
            is_favorite=False,
        )
    return json_ok(copy, status=201)


async def toggle_favorite(request: web.Request) -> web.Response:
    mid = request.match_info["id"]
    with db_session(request) as conn:
        repo = ModuleRepository(conn)
        try:
            row = repo.get(mid)
        except ModuleNotFound:
            return json_error(f"module not found: {mid}", status=404)
        updated = repo.update(mid, is_favorite=not row["is_favorite"])
    return json_ok(updated)


async def list_hashes(request: web.Request) -> web.Response:
    """Lightweight bulk hash fetch for drift detection.

    Returns hashes for every module kind in the library. Used by the
    SPA Manager AND by the in-graph WP_Context widget to drive the
    drift / missing dots — both surfaces need the full set since
    post-5.5.6 a WP_Context can embed any kind (wildcard, fixed_values,
    combine, derivation, constraint). The pre-5.5.6 endpoint
    filtered to wildcards-only because that was the only embeddable
    kind; lifting the filter fixes the false-positive missing dot on
    every non-wildcard card.

    Lightweight (no payload, no metadata) so the SPA can poll on every
    workflow load without measurable cost."""
    with db_session(request) as conn:
        rows = ModuleRepository(conn).list()
    # Post-migration-004 the row's `id` IS the 8-hex uuid that the
    # tokenizer's `@{8hex}` ref captures; the published `hashes` map
    # keys remain `uuid`-named on the wire so existing SPA consumers
    # don't need to relabel.
    return json_ok({
        "hashes": {row["id"]: row["payload_hash"] for row in rows},
    })


async def embed_bundle(request: web.Request) -> web.Response:
    """Per-pick snapshot fetch for the SPA library picker.

    Body: {"uuids": [str, ...]}. Server returns one SnapshotEntry per
    picked uuid — NO transitive `@{}` walk. Nested wildcard refs
    inside an option value resolve at run time against the live
    library on the executing machine. The workflow JSON only
    embeds what the user explicitly picked; the referenced wildcards
    only enter the catalog if (and when) the picked option happens
    to surface them at run time.

    Trade-off: workflow JSON is no longer self-contained. Reproducing
    a graph on a different machine requires the same wildcard
    library (or at least the wildcards the picked options happen to
    resolve into). The user explicitly asked for this trim — it
    matches their mental model of "I picked outfit, I expect outfit
    to be embedded; color is a library detail".

    Response shape kept stable so the SPA client doesn't need to
    branch:
      - modules: list of picked payloads in input order (drops misses)
      - snapshots: dict[uuid, SnapshotEntry] of the picks (no deps)
      - pickOrder: input uuid list
      - walkOverflow: always [] (kept for shape compatibility)
    """
    try:
        body = await request.json()
    except Exception:
        return json_error("invalid JSON body", status=400)
    if not isinstance(body, dict):
        return json_error("body must be a JSON object", status=400)

    uuids = body.get("uuids")
    if not isinstance(uuids, list) or not all(isinstance(u, str) for u in uuids):
        return json_error("uuids must be a list of strings", status=400)

    snapshots: dict[str, dict] = {}
    picks: list[dict] = []
    with db_session(request) as conn:
        repo = ModuleRepository(conn)
        for uuid in uuids:
            try:
                row = repo.get(uuid)
            except Exception:
                continue
            entry = {
                "snapshot_version": 1,
                "uuid": row["id"],
                "type": row["type"],
                "name": row["name"],
                "payload": row["payload"],
                "payload_hash": row["payload_hash"],
                "source": {"kind": "user"},
            }
            snapshots[row["id"]] = entry
            picks.append(row["payload"])

    return json_ok({
        "modules": picks,
        "snapshots": snapshots,
        "pickOrder": uuids,
        "walkOverflow": [],
    })


def register(router) -> None:
    router.add_get("/wp/api/modules", list_modules)
    router.add_post("/wp/api/modules", create_module)
    router.add_post("/wp/api/modules/import-from-workflow", import_from_workflow)
    router.add_get("/wp/api/modules/hashes", list_hashes)
    router.add_post("/wp/api/modules/match", match_module)
    router.add_post("/wp/api/modules/embed-bundle", embed_bundle)
    router.add_get("/wp/api/modules/{id}", get_module)
    router.add_put("/wp/api/modules/{id}", update_module)
    router.add_delete("/wp/api/modules/{id}", delete_module)
    router.add_post("/wp/api/modules/{id}/snapshot", snapshot_module)
    router.add_post("/wp/api/modules/{id}/duplicate", duplicate_module)
    router.add_post("/wp/api/modules/{id}/favorite", toggle_favorite)
