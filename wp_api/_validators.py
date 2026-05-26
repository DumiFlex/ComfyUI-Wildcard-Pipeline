"""Shared API-level validators for meta + identifier shape.

Centralises the "between-the-handler-and-the-engine" guards so both
modules and bundles enforce the same name / description / tag rules,
and so the engine-level ``validate_payload`` calls aren't responsible
for the API-layer concerns (length caps, tag-element types, etc).

Caps are deliberately generous — the goal is "block obvious abuse"
(megabyte names, non-string tag entries, runaway identifiers) without
constraining real authoring. Bump these if a real workflow needs more.
"""
from __future__ import annotations

import re
from typing import Any

# ─── Length caps ─────────────────────────────────────────────────────
MAX_NAME_LEN = 200
MAX_DESC_LEN = 4000
MAX_TAG_LEN = 64
MAX_TAGS = 50
MAX_IDENT_LEN = 64
MAX_TEMPLATE_LEN = 8000
# Hard cap on the raw POST/PUT body size. Real bundles serialise to a
# few hundred KB at most; the largest realistic payload is a wildcard
# with a couple hundred options. 5 MB is roughly 100× the realistic
# upper bound — enough headroom for unusual library entries without
# letting a 50k-option DoS slip through.
MAX_BODY_BYTES = 5 * 1024 * 1024

# Identifier rule: Python-style ident, no leading underscore-underscore
# (those collide with the engine's `__wp_*__` internal-key convention —
# see CLAUDE.md and engine/modules/types.py:strip_internals).
_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")

# Characters reserved by the nested-ref grammar `@{uuid[#name][:subcat[,subcat...]]}`.
# Wildcard `name` becomes the `#name` segment and subcategory names sit
# in the comma-separated `:subcat` list. Letting either contain these
# chars would let users author refs the regex can't parse back
# unambiguously. Mirror in `engine/modules/wildcard_handler.py` and
# the SPA validator so editor + API + engine agree.
REF_GRAMMAR_FORBIDDEN_CHARS = frozenset("{}:#@,")


def validate_wildcard_name(name: str) -> str | None:
    """Wildcard-only name guard. Returns an error string when the name
    contains characters reserved by the nested-ref grammar, ``None``
    otherwise. Generic shape checks live in :func:`validate_meta`."""
    bad = sorted(set(name) & REF_GRAMMAR_FORBIDDEN_CHARS)
    if bad:
        return (
            f"wildcard name must not contain {bad!r} — these characters "
            f"are reserved by the @{{uuid#name:subcat}} ref grammar"
        )
    return None


def validate_wildcard_subcats(payload: Any) -> str | None:
    """Wildcard payload `sub_categories[]` guard — mirrors the engine
    handler's per-entry check ``engine/modules/wildcard_handler.py`` so
    the import boundary rejects forbidden chars BEFORE the engine
    importer commits the row. Lets the import-commit endpoint enforce
    the same grammar contract the live editor enforces."""
    if not isinstance(payload, dict):
        return None
    subs = payload.get("sub_categories")
    if not isinstance(subs, list):
        return None
    for i, sc in enumerate(subs):
        if not isinstance(sc, str):
            return f"sub_categories[{i}] must be a string"
        if sc == "null":
            return (
                f"sub_categories[{i}] 'null' is reserved by the "
                f"@{{uuid:subcat}} filter syntax"
            )
        bad = sorted(set(sc) & REF_GRAMMAR_FORBIDDEN_CHARS)
        if bad:
            return (
                f"sub_categories[{i}] {sc!r} must not contain {bad!r} — "
                f"reserved by the @{{uuid#name:subcat}} ref grammar"
            )
    return None


def validate_identifier(value: Any, where: str) -> None:
    """Raise ``ValueError`` when ``value`` is not a usable engine identifier.

    Stricter than the engine handler's own regex check: also rejects
    empty strings (the handler check guards with ``if value and …`` so
    empty falls through), rejects ``__dunder`` prefixes (would collide
    with engine-internal key stripping), and caps length.
    """
    if not isinstance(value, str):
        raise ValueError(f"{where} must be a string")
    if not value:
        raise ValueError(f"{where} must not be empty")
    if len(value) > MAX_IDENT_LEN:
        raise ValueError(
            f"{where} must be at most {MAX_IDENT_LEN} chars (got {len(value)})"
        )
    if value.startswith("__"):
        raise ValueError(
            f"{where} must not start with '__' (reserved for engine-internal keys)"
        )
    if not _IDENT_RE.match(value):
        raise ValueError(f"{where} {value!r} is not a valid identifier")


def validate_meta(body: dict[str, Any]) -> str | None:
    """Validate the meta fields shared between modules and bundles.

    Returns an error string when something's off, ``None`` when every
    present field passes. Missing fields are skipped — this validates
    shape/length, not required-field presence (POST handlers separately
    enforce ``required = {"type", "name", "payload"}`` etc).

    Tags receive the strictest treatment: the SPA's TypeScript declares
    ``tags: string[]`` and the manager UI renders chips with naive
    coercion (``null`` collapses to an empty label, objects stringify
    to ``[object Object]``). Catching non-string entries here preserves
    the type contract end-to-end.
    """
    if "name" in body:
        name = body["name"]
        if not isinstance(name, str):
            return "name must be a string"
        if not name.strip():
            return "name must not be empty"
        if len(name) > MAX_NAME_LEN:
            return f"name must be at most {MAX_NAME_LEN} chars (got {len(name)})"
    if "description" in body:
        desc = body["description"]
        if desc is not None and not isinstance(desc, str):
            return "description must be a string"
        if isinstance(desc, str) and len(desc) > MAX_DESC_LEN:
            return f"description must be at most {MAX_DESC_LEN} chars (got {len(desc)})"
    if "tags" in body:
        tags = body["tags"]
        if not isinstance(tags, list):
            return "tags must be a list"
        if len(tags) > MAX_TAGS:
            return f"tags must contain at most {MAX_TAGS} entries (got {len(tags)})"
        for i, t in enumerate(tags):
            if not isinstance(t, str):
                return f"tags[{i}] must be a string"
            if len(t) > MAX_TAG_LEN:
                return f"tags[{i}] must be at most {MAX_TAG_LEN} chars (got {len(t)})"
    if "category_id" in body:
        cat = body["category_id"]
        if cat is not None and not isinstance(cat, str):
            return "category_id must be a string or null"
    return None


def validate_body_size(content_length: int | None) -> str | None:
    """Reject requests whose ``Content-Length`` exceeds the API cap.

    Pre-flight guard; the aiohttp ``client_max_size`` setting backs
    this up at the transport layer, but we want a clean ``400`` JSON
    error instead of aiohttp's stock 413 HTML.
    """
    if content_length is not None and content_length > MAX_BODY_BYTES:
        return (
            f"request body too large ({content_length} bytes); "
            f"limit is {MAX_BODY_BYTES} bytes"
        )
    return None
