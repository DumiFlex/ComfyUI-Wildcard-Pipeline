"""End-of-run constraint warnings for ``PipelineEngine.run``.

After every module has run, the pipeline looks at the registered
constraints (``ctx["__wp_constraints__"]``) and their SP3 hit counts
(``ctx["__wp_constraint_hits__"]``) and emits the advisory runtime
warnings `constraint_never_applied`, `constraint_source_missing` and
`constraint_partial_reach`. Split out of ``engine/pipeline.py``; the
helpers stay importable from there too.
"""
from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

# `@{uuid}` ref matcher — mirror of engine.syntax.tokenize._REF_RE
# (4-segment: uuid + optional #name / :expr / !null; only the uuid is
# captured here). Used by the never_applied warning classifier to tell
# "target has a carrier/instance somewhere in the chain" apart from
# "target uuid is nowhere to be found".
_PIPELINE_REF_RE = re.compile(
    r"@\{([0-9a-f]{8})(?:#[^#:}@{!]*)?(?::[^}!]*)?(?:![^}]*)?\}"
)


def _module_field(module: Any, key: str) -> Any:
    """Read a field from a module that may be a dict or an object."""
    if isinstance(module, dict):
        return module.get(key)
    return getattr(module, key, None)


def _target_present_in_chain(
    target_uuid: str,
    modules: list[Any],
    catalog: dict[str, Any] | None,
) -> bool:
    """True when `target_uuid` has SOME representation in the chain —
    either a direct wildcard instance (a module whose id == target) or a
    carrier (any wildcard, in the module list OR the catalog, with an
    `@{target}` ref in one of its option values).

    Used purely to pick the right never_applied warning wording: if the
    target is present-but-unclaimed the cause is ordering / a skipped
    roll; if it's absent the cause is a wrong uuid. Best-effort + cheap
    (library volumes are dozens of modules, single-digit refs each)."""
    def _options_of(payload: Any) -> list:
        if isinstance(payload, dict):
            opts = payload.get("options")
            return opts if isinstance(opts, list) else []
        return []

    def _carries(payload: Any) -> bool:
        for opt in _options_of(payload):
            val = opt.get("value") if isinstance(opt, dict) else None
            if isinstance(val, str) and any(
                m.group(1) == target_uuid for m in _PIPELINE_REF_RE.finditer(val)
            ):
                return True
        return False

    for m in modules:
        if _module_field(m, "type") != "wildcard":
            continue
        if _module_field(m, "id") == target_uuid:
            return True
        if _carries(_module_field(m, "payload")):
            return True
    if isinstance(catalog, dict):
        for entry in catalog.values():
            payload = entry.get("payload") if isinstance(entry, dict) else None
            if _carries(payload):
                return True
    return False


def _target_direct_in_chain(target_uuid: str, modules: list[Any]) -> bool:
    """True when `target_uuid` runs as a wildcard of its own in the chain
    (not only through `@{…}` refs in other options)."""
    return any(
        _module_field(m, "type") == "wildcard" and _module_field(m, "id") == target_uuid
        for m in modules
    )


# Characters that break the engine ref tokenizer's `#name` segment
# (`[^#:}@{]*`). Anything in this set gets replaced with a space when
# embedding a cached name into a `@{uuid#name}` ref so a stray apostrophe
# or curly brace can't shatter the warning's parse on the frontend.
_REF_NAME_FORBIDDEN = re.compile(r"[#:}@{]")


def _build_ref_name_suffix(name: Any) -> str:
    """Return the `#name` suffix for a cached ref token, or `""` when no
    usable name was provided. Used by the `constraint_never_applied`
    warning emitter so chips render a readable label even when the
    workflow is imported on a machine whose library lacks the referenced
    modules — the cached `#name` is the only fallback RefChip has in
    that scenario."""
    if not isinstance(name, str):
        return ""
    cleaned = _REF_NAME_FORBIDDEN.sub(" ", name).strip()
    return f"#{cleaned}" if cleaned else ""


def _catalog_name(catalog: Any, uuid: str) -> str:
    """The cached display name of `uuid` in the per-run catalog, or ``""``."""
    if isinstance(catalog, dict):
        row = catalog.get(uuid)
        if isinstance(row, dict):
            return row.get("name", "") or ""
    return ""


def _append_warning(ctx: dict[str, Any], warning: dict[str, Any]) -> None:
    bucket = ctx.setdefault("__wp_warnings__", [])
    if isinstance(bucket, list):
        bucket.append(warning)


def _never_applied_message(
    library_cid: str,
    cid_suffix: str,
    target_uuid: str,
    tgt_suffix: str,
    present: bool,
    ref_only: bool,
) -> str:
    """Word the never_applied warning by its cause.

    Reach is downstream-relative: a constraint only applies to target
    occurrences that resolve AFTER it registers. So a never-applied
    constraint whose target IS present in the chain means every occurrence
    ran BEFORE this constraint registered (ordering), or sits in a
    branch/Context this run didn't reach. Absent target = a wrong/stale
    uuid."""
    if ref_only:
        return (
            f"constraint @{{{library_cid}{cid_suffix}}} had nothing to do this "
            f"run — its target @{{{target_uuid}{tgt_suffix}}} is only reached "
            f"through @{{…}} refs, and none of them was drawn."
        )
    if present:
        # Target IS in the chain but the selector covered no firing
        # occurrence — every appearance resolved BEFORE this constraint
        # registered (e.g. a source wildcard that nests its own @{target}),
        # or lives in a branch / Context this run didn't execute, or is
        # disabled. Deliberately NOT prescribing "move the constraint up" —
        # that's wrong when the target's carrier is also the constraint's
        # source (the source must stay upstream of the constraint).
        return (
            f"constraint @{{{library_cid}{cid_suffix}}} did not apply — its target "
            f"@{{{target_uuid}{tgt_suffix}}} is in the chain but every appearance "
            f"resolved before this constraint registered, or is "
            f"disabled / in a branch this run skipped."
        )
    return (
        f"constraint @{{{library_cid}{cid_suffix}}} did not apply — "
        f"no @{{{target_uuid}{tgt_suffix}}} wildcard instance or "
        f"nested-ref carrier found in this chain "
        f"(check the constraint's target uuid)."
    )


def _warn_never_applied(
    ctx: dict[str, Any],
    modules: list[Any],
    constraints_bucket: Any,
    hits: dict[str, Any],
    catalog: Any,
) -> None:
    """SP3 reach selector finalisation: emit `constraint_never_applied` for
    every registered constraint whose selector covered ZERO firing target
    instances (hit count 0), plus `constraint_source_missing` when its
    source is absent from the chain too. Surfaces in WP_Debug so the user
    sees "you put a constraint here but nothing downstream took it" — the
    chain still succeeds.

    Dedup by cid — sibling instances of the same library entry share
    `__constraint_module_id__`, so they show up as two entries in the
    bucket. Without the dedup the user sees the same warning twice for the
    same logical constraint (2026-05-26)."""
    if not isinstance(constraints_bucket, list):
        return
    warned_cids: set[str] = set()
    for c in constraints_bucket:
        if not isinstance(c, dict):
            continue
        cid = c.get("__constraint_module_id__")
        if not cid or hits.get(cid, 0) != 0:
            continue
        if cid in warned_cids:
            continue
        warned_cids.add(cid)
        # `cid` keys the dedup bookkeeping (per-instance `_uid` so two
        # canvas instances of the same library constraint are independent).
        # The message text, on the other hand, must reference the LIBRARY
        # id — that's the 8-hex uuid the SPA/Debug chip resolver looks up in
        # the module catalog to render the constraint's name. Falling back
        # to `cid` only when the library id is missing (legacy / hand-built
        # constraints) keeps the warning informative either way.
        library_cid = c.get("__constraint_library_id__") or cid
        target_uuid = c.get("target_wildcard_id", "")
        # Build `#name` cache suffixes so the chip survives a
        # library-missing import (RefChip.vue's unresolved-with-cached-name
        # path). The constraint's name was stashed by its handler; the
        # target's name is read from the per-run catalog. Sanitised against
        # the engine's ref tokenizer so stray punctuation can't break the
        # warning's parse.
        target_name = _catalog_name(catalog, target_uuid)
        cid_suffix = _build_ref_name_suffix(c.get("__constraint_library_name__"))
        tgt_suffix = _build_ref_name_suffix(target_name)
        present = _target_present_in_chain(target_uuid, modules, catalog)
        # Reached only through `@{…}` refs: a run that didn't draw any of
        # those refs (a recipe wildcard picked another recipe) is normal,
        # not a mistake.
        ref_only = present and not _target_direct_in_chain(target_uuid, modules)
        message = _never_applied_message(
            library_cid, cid_suffix, target_uuid, tgt_suffix, present, ref_only,
        )
        _append_warning(ctx, {
            "type": "constraint_never_applied",
            # `warn` (not `info`): an authored constraint that silently
            # never fires is almost always either a misconfiguration (wrong
            # target uuid, missing source/target wildcard in the chain) or a
            # disabled / dead branch the user forgot about. Either way it
            # deserves the yellow advisory chip, not the blue informational
            # one — the constraint is doing nothing, and the user should
            # see it.
            "severity": "info" if ref_only else "warn",
            "module_id": cid,
            "source_field": "",
            "position": 0,
            "token_index": None,
            "detail": {
                "constraint_id": cid,
                "target_wildcard_id": target_uuid,
                "source_wildcard_id": c.get("source_wildcard_id", ""),
                # Only reached through refs, none drawn this run.
                "ref_only": ref_only,
                # `target_present` lets the DebugViewer pick a distinct
                # icon/severity later without re-parsing the message string.
                "target_present": present,
            },
            # Ids wrapped as `@{uuid}` so the DebugViewer's RichTextPreview
            # resolves them to display names via the library cache (raw
            # short-uuids would otherwise render as plain text).
            "message": message,
        })
        # Source-side companion warning. The `never_applied` message above
        # is target-focused; when the constraint's SOURCE wildcard is ALSO
        # absent from the chain, surface that distinctly so the Debug viewer
        # shows BOTH ends (mirrors the editor's separate "source missing" /
        # "target missing" row badges). A constraint registers by its own
        # module position, so it can sit in the bucket with neither end
        # present.
        source_uuid = c.get("source_wildcard_id", "")
        if source_uuid and not _target_present_in_chain(
            source_uuid, modules, catalog,
        ):
            src_suffix = _build_ref_name_suffix(_catalog_name(catalog, source_uuid))
            _append_warning(ctx, {
                "type": "constraint_source_missing",
                "severity": "warn",
                "module_id": cid,
                "source_field": "",
                "position": 0,
                "token_index": None,
                "detail": {
                    "constraint_id": cid,
                    "source_wildcard_id": source_uuid,
                },
                "message": (
                    f"constraint @{{{library_cid}{cid_suffix}}} did not apply — "
                    f"its source @{{{source_uuid}{src_suffix}}} wildcard isn't in "
                    f"this chain, so it never registers a source pick."
                ),
            })


def _requested_reach(sel: dict[str, Any]) -> int | None:
    """How many target instances a `next N` / `pick` selector asks for;
    None for `all` / `first`, which can't be partial."""
    mode = sel.get("mode", "all")
    if mode == "next":
        try:
            return int(sel.get("count", 1))
        except (TypeError, ValueError):
            return 1
    if mode == "pick":
        return len(sel.get("picks") or [])
    return None


def _warn_partial_reach(
    ctx: dict[str, Any],
    constraints_bucket: Any,
    hits: dict[str, Any],
) -> None:
    """SP3 partial-reach finalisation: a constraint that DID fire but whose
    `next N` / `pick` selector matched FEWER occurrences than requested.
    Distinct from never_applied (which fired zero times) — this is "the
    selector asked for more than the chain offered downstream". Deduped by
    cid, same as never_applied."""
    if not isinstance(constraints_bucket, list):
        return
    partial_warned: set[str] = set()
    for c in constraints_bucket:
        if not isinstance(c, dict):
            continue
        cid = c.get("__constraint_module_id__")
        seen = hits.get(cid, 0) if cid else 0
        if not cid or seen == 0 or cid in partial_warned:
            continue
        sel = c.get("target_select") or {"mode": "all"}
        mode = sel.get("mode", "all")
        want = _requested_reach(sel)
        if want is None:
            continue
        # LIMITATION (holistic-review L1): `seen` is the per-cid TOTAL
        # target-encounter count (`hits[cid]`, bumped on every firing in
        # apply_constraints_for_target), NOT the count of picks that
        # actually MATCHED. So a `pick` partial signal is imprecise: it
        # compares encounters to `len(picks)` rather than matched-vs-listed.
        # A precise count would need a separate ctx-threaded matched-pick
        # counter (new bookkeeping across the _constraints apply boundary)
        # — deferred to avoid over-plumbing. `next` is exact (it covers the
        # first N encounters by construction).
        if seen >= want:
            continue
        partial_warned.add(cid)
        _append_warning(ctx, {
            # Spec: partial reach is INFO, not warn — the selector simply
            # found fewer downstream targets than requested this run (not an
            # error condition). `constraint_never_applied` stays `warn` (a
            # constraint that fired zero times is worth a louder signal).
            # DebugViewer maps `info` → blue/accent.
            "type": "constraint_partial_reach",
            "severity": "info",
            "module_id": cid,
            "source_field": "",
            "position": 0,
            "token_index": None,
            "detail": {
                "constraint_id": cid,
                "target_wildcard_id": c.get("target_wildcard_id"),
                "requested": want,
                "reached": seen,
            },
            "message": (
                f"constraint reach selector ({mode}) asked for "
                f"{want} target instance(s) but only {seen} "
                f"resolved downstream this run."
            ),
        })


def finalize_constraint_warnings(ctx: dict[str, Any], modules: Sequence[Any]) -> None:
    """Emit the end-of-run constraint warnings (never_applied /
    source_missing, then partial_reach) into ``ctx["__wp_warnings__"]``."""
    constraints_bucket = ctx.get("__wp_constraints__") or []
    hits = ctx.get("__wp_constraint_hits__") or {}
    catalog = ctx.get("__wp_catalog__")
    _warn_never_applied(ctx, modules, constraints_bucket, hits, catalog)
    _warn_partial_reach(ctx, constraints_bucket, hits)
