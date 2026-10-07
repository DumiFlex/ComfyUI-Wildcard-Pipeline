"""Content-driven ``schema_version`` stamping. Mirror of TS
``schemaVersionForPayload`` in ``src/manager/import-export/single-row-publish.ts``.

A payload is stamped with the LOWEST catalog version its features need, so
an older consumer can still install everything that doesn't use a newer
feature:

- ``FALLBACK_SCHEMA_VERSION`` (9): a wildcard option is flagged
  ``fallback: true`` (also used when nothing else is left to pick).
- ``NEGATIVES_SCHEMA_VERSION`` (8): a wildcard option, fixed value or
  combine carries a non-empty ``negative``, a derivation action uses the
  ``negative`` ("Add to negative") mode, a derivation branch runs more than
  one action (``extra_actions``), or text reads a variable's negatives
  (``$name.neg``).
- ``DERIVATION_CONDITIONS_SCHEMA_VERSION`` (7): a derivation branch groups
  tests with AND / OR, or a test uses ``is_empty`` / ``is_not_empty``.
- ``CONSTRAINT_ONLY_SCHEMA_VERSION`` (6): a constraint matrix cell,
  exception or instance mode override uses the ``only`` rule.
- ``TAG_AXES_SCHEMA_VERSION`` (5): a wildcard ``tag_group_kinds`` map marks
  any group ``accepts``.
- ``SP3_REACH_SCHEMA_VERSION`` (4): a constraint carries a non-default
  ``target_select`` reach selector.
- ``SP2B_SCHEMA_VERSION`` (3): the payload text uses a range count or the
  ``~`` independent flag in a ``{N$$…}`` multi-pick.
- ``CURRENT_SCHEMA_VERSION`` (2) otherwise.

Each scan walks the whole structure (bundle children, instance overrides,
every export bucket), so the marker is found wherever it lives. Keep the two
sides in step: a new feature stamp lands in both files in the same PR.
"""
from __future__ import annotations

import json
import re
from typing import Any

from engine.migrations import (
    CONSTRAINT_ONLY_SCHEMA_VERSION,
    CURRENT_SCHEMA_VERSION,
    DERIVATION_CONDITIONS_SCHEMA_VERSION,
    FALLBACK_SCHEMA_VERSION,
    NEGATIVES_SCHEMA_VERSION,
    SP2B_SCHEMA_VERSION,
    SP3_REACH_SCHEMA_VERSION,
    TAG_AXES_SCHEMA_VERSION,
)

# SP2b nested-multi-pick marker: a `{N$$…}` whose count is a range (`N-M`)
# or carries the `~` flag. A plain fixed-count `{N$$…}` predates SP2b.
_SP2B_MARKER_RE = re.compile(r"\{\d+(?:-\d+~?|~)\$\$")
# `$name.neg`, `$name.K.neg` (and `$name.neg.K`): reads a variable's negatives.
_NEG_ACCESSOR_RE = re.compile(
    r"\$[A-Za-z_][A-Za-z0-9_]*(?:\.\d+)?\.neg(?![A-Za-z0-9_])"
)


def _is_number(value: Any) -> bool:
    # JSON booleans come back as Python bools, which are ints; TS
    # `typeof x === "number"` is false for them.
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _is_non_default_target_select(sel: Any) -> bool:
    """True when ``sel`` narrows reach. Only an absent selector or a bare
    ``{"mode": "all"}`` is the default; ``{"mode": "pick", "picks": []}``
    still counts because a pre-SP3 consumer can't parse the mode at all."""
    if not isinstance(sel, dict):
        return False
    mode = sel.get("mode")
    if isinstance(mode, str) and mode != "all":
        return True
    if _is_number(sel.get("count")):
        return True
    picks = sel.get("picks")
    return isinstance(picks, list) and len(picks) > 0


def uses_target_select_reach(node: Any) -> bool:
    """Any ``target_select`` at any depth holding a non-default selector."""
    if isinstance(node, list):
        return any(uses_target_select_reach(child) for child in node)
    if not isinstance(node, dict):
        return False
    if _is_non_default_target_select(node.get("target_select")):
        return True
    return any(
        isinstance(value, (dict, list)) and uses_target_select_reach(value)
        for value in node.values()
    )


def uses_accepts_tag_axis(node: Any) -> bool:
    """Any ``tag_group_kinds`` map at any depth marking a group ``accepts``."""
    if isinstance(node, list):
        return any(uses_accepts_tag_axis(child) for child in node)
    if not isinstance(node, dict):
        return False
    kinds = node.get("tag_group_kinds")
    if isinstance(kinds, dict) and any(k == "accepts" for k in kinds.values()):
        return True
    return any(
        isinstance(value, (dict, list)) and uses_accepts_tag_axis(value)
        for value in node.values()
    )


_EXCEPTION_LIST_KEYS = ("exceptions", "extra_exceptions")
_MODE_OVERRIDE_KEYS = ("cell_mode_overrides", "exception_mode_overrides")


def _matrix_uses_only(matrix: Any) -> bool:
    if not isinstance(matrix, dict):
        return False
    return any(
        isinstance(row, dict) and any(
            isinstance(cell, dict) and cell.get("mode") == "only"
            for cell in row.values()
        )
        for row in matrix.values()
    )


def uses_constraint_only_rule(node: Any) -> bool:
    """Any constraint rule at any depth whose mode is ``only``: a library
    matrix cell or exception, an instance extra exception, or an instance mode
    override (a string map)."""
    if isinstance(node, list):
        return any(uses_constraint_only_rule(child) for child in node)
    if not isinstance(node, dict):
        return False
    if _matrix_uses_only(node.get("matrix")):
        return True
    for key in _EXCEPTION_LIST_KEYS:
        excs = node.get(key)
        if isinstance(excs, list) and any(
            isinstance(e, dict) and e.get("mode") == "only" for e in excs
        ):
            return True
    for key in _MODE_OVERRIDE_KEYS:
        overrides = node.get(key)
        if isinstance(overrides, dict) and any(
            m == "only" for m in overrides.values()
        ):
            return True
    return any(
        isinstance(value, (dict, list)) and uses_constraint_only_rule(value)
        for value in node.values()
    )


_V7_CONDITION_OPS = ("is_empty", "is_not_empty")


def _is_v7_condition(cond: Any) -> bool:
    if not isinstance(cond, dict):
        return False
    if "conditions" in cond:
        return True
    return cond.get("op") in _V7_CONDITION_OPS


def uses_derivation_conditions(node: Any) -> bool:
    """Any derivation branch at any depth whose ``condition`` is an AND / OR
    group or a test using ``is_empty`` / ``is_not_empty``."""
    if isinstance(node, list):
        return any(uses_derivation_conditions(child) for child in node)
    if not isinstance(node, dict):
        return False
    branches = node.get("branches")
    if isinstance(branches, list) and any(
        isinstance(b, dict) and _is_v7_condition(b.get("condition"))
        for b in branches
    ):
        return True
    return any(
        isinstance(value, (dict, list)) and uses_derivation_conditions(value)
        for value in node.values()
    )


def uses_negatives(node: Any) -> bool:
    """Any non-empty ``negative`` string, or a derivation action whose mode is
    ``negative``, at any depth. An empty negative is stored as absent and
    never needs v8."""
    if isinstance(node, list):
        return any(uses_negatives(child) for child in node)
    if not isinstance(node, dict):
        return False
    neg = node.get("negative")
    if isinstance(neg, str) and neg.strip():
        return True
    if node.get("mode") in ("negative", "negative_replace") and "target_var" in node:
        return True
    extra = node.get("extra_actions")
    if isinstance(extra, list) and extra:
        return True
    return any(
        (isinstance(value, (dict, list)) and uses_negatives(value))
        or (isinstance(value, str) and _NEG_ACCESSOR_RE.search(value) is not None)
        for value in node.values()
    )


def uses_fallback_option(node: Any) -> bool:
    """Any wildcard option flagged ``fallback: true`` at any depth (library
    payload, bundle child or a node's own copy)."""
    if isinstance(node, list):
        return any(uses_fallback_option(child) for child in node)
    if not isinstance(node, dict):
        return False
    if node.get("fallback") is True and "value" in node:
        return True
    return any(
        isinstance(value, (dict, list)) and uses_fallback_option(value)
        for value in node.values()
    )


def uses_sp2b_grammar(node: Any) -> bool:
    """Range-count or ``~`` multi-pick anywhere in the serialised payload."""
    text = json.dumps(node, ensure_ascii=False, default=str)
    return _SP2B_MARKER_RE.search(text) is not None


def schema_version_for_payload(payload: Any) -> int:
    """The lowest catalog version that covers every feature in ``payload``."""
    if uses_fallback_option(payload):
        return FALLBACK_SCHEMA_VERSION
    if uses_negatives(payload):
        return NEGATIVES_SCHEMA_VERSION
    if uses_derivation_conditions(payload):
        return DERIVATION_CONDITIONS_SCHEMA_VERSION
    if uses_constraint_only_rule(payload):
        return CONSTRAINT_ONLY_SCHEMA_VERSION
    if uses_accepts_tag_axis(payload):
        return TAG_AXES_SCHEMA_VERSION
    if uses_target_select_reach(payload):
        return SP3_REACH_SCHEMA_VERSION
    if uses_sp2b_grammar(payload):
        return SP2B_SCHEMA_VERSION
    return CURRENT_SCHEMA_VERSION
