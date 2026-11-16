"""Content-driven ``schema_version`` stamping. Mirror of TS
``schemaVersionForPayload`` in ``src/manager/import-export/single-row-publish.ts``.

A payload is stamped with the LOWEST catalog version its features need, so
an older consumer can still install everything that doesn't use a newer
feature:

- ``BOOL_ACCESSOR_SCHEMA_VERSION`` (12): text reads ``$name.bool`` or a
  derivation test's ``var`` is ``name.bool`` (WP Toggles' on/off).
- ``FILTER_VARIABLES_SCHEMA_VERSION`` (11): a wildcard use's pool filter
  (``category_filter``) or a ref's ``@{uuid:…}`` filter has a ``$name`` term.
- ``NEGATED_TESTS_SCHEMA_VERSION`` (10): a derivation test uses
  ``not_contains`` or ``not_matches`` (the editor's NOT toggle).
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
    BOOL_ACCESSOR_SCHEMA_VERSION,
    CONSTRAINT_ONLY_SCHEMA_VERSION,
    CURRENT_SCHEMA_VERSION,
    DERIVATION_CONDITIONS_SCHEMA_VERSION,
    FALLBACK_SCHEMA_VERSION,
    FILTER_VARIABLES_SCHEMA_VERSION,
    NEGATED_TESTS_SCHEMA_VERSION,
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

# `$name.bool` (and `$name.K.bool`): reads a WP Toggles variable's on/off
# (schema v12). A condition's `var` holds the same reference without `$`.
_BOOL_ACCESSOR_RE = re.compile(
    r"\$[A-Za-z_][A-Za-z0-9_]*(?:\.\d+)?\.bool(?![A-Za-z0-9_])"
)
_BOOL_VAR_RE = re.compile(r"^\$?[A-Za-z_][A-Za-z0-9_]*(?:\.\d+)?\.bool$")

# A ref whose `:filter` holds a `$name` term (schema v11).
_REF_FILTER_VAR_RE = re.compile(
    r"@\{[0-9a-f]{8}(?:#[^#:}@{!]*)?:[^}]*\$[A-Za-z_]"
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
    """Any non-empty ``negative`` (or a combine instance's
    ``negative_override``) string, or a derivation action whose mode is
    ``negative``, at any depth. An empty negative is stored as absent and
    never needs v8."""
    if isinstance(node, list):
        return any(uses_negatives(child) for child in node)
    if not isinstance(node, dict):
        return False
    for key in ("negative", "negative_override"):
        neg = node.get(key)
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


_V10_CONDITION_OPS = ("not_contains", "not_matches")


def uses_negated_tests(node: Any) -> bool:
    """Any derivation test (at any depth, nested groups included) using
    ``not_contains`` or ``not_matches``."""
    if isinstance(node, list):
        return any(uses_negated_tests(child) for child in node)
    if not isinstance(node, dict):
        return False
    if node.get("op") in _V10_CONDITION_OPS and "var" in node:
        return True
    return any(
        isinstance(value, (dict, list)) and uses_negated_tests(value)
        for value in node.values()
    )


def uses_filter_variables(node: Any) -> bool:
    """A ``$name`` term in any ``category_filter`` (a use's pool filter, at
    any depth) or in any ref's ``@{uuid:…}`` filter text."""
    from engine.syntax.subcat_filter import expr_variables

    if isinstance(node, list):
        return any(uses_filter_variables(child) for child in node)
    if isinstance(node, str):
        return _REF_FILTER_VAR_RE.search(node) is not None
    if not isinstance(node, dict):
        return False
    if expr_variables(node.get("category_filter")):
        return True
    return any(uses_filter_variables(value) for value in node.values())


def uses_bool_accessor(node: Any) -> bool:
    """Any text reading ``$name.bool``, or a derivation test whose ``var``
    is ``name.bool``, at any depth."""
    if isinstance(node, list):
        return any(uses_bool_accessor(child) for child in node)
    if isinstance(node, str):
        return _BOOL_ACCESSOR_RE.search(node) is not None
    if not isinstance(node, dict):
        return False
    var = node.get("var")
    if isinstance(var, str) and _BOOL_VAR_RE.match(var.strip()):
        return True
    return any(uses_bool_accessor(value) for value in node.values())


def uses_sp2b_grammar(node: Any) -> bool:
    """Range-count or ``~`` multi-pick anywhere in the serialised payload."""
    text = json.dumps(node, ensure_ascii=False, default=str)
    return _SP2B_MARKER_RE.search(text) is not None


def _scan_text(text: str, found: set[int], *, dict_value: bool) -> None:
    """The text markers in one string. ``$name.neg`` only counts as a dict
    value, as in ``uses_negatives``; the other three count anywhere."""
    if "$" in text:
        if dict_value and _NEG_ACCESSOR_RE.search(text) is not None:
            found.add(NEGATIVES_SCHEMA_VERSION)
        if _BOOL_ACCESSOR_RE.search(text) is not None:
            found.add(BOOL_ACCESSOR_SCHEMA_VERSION)
        if "@{" in text and _REF_FILTER_VAR_RE.search(text) is not None:
            found.add(FILTER_VARIABLES_SCHEMA_VERSION)
        if "{" in text and _SP2B_MARKER_RE.search(text) is not None:
            found.add(SP2B_SCHEMA_VERSION)


def _scan_dict(node: dict[str, Any], found: set[int]) -> None:
    """The per-dict checks of every ``uses_*`` scan, in one go."""
    from engine.syntax.subcat_filter import expr_variables

    var = node.get("var")
    if isinstance(var, str) and _BOOL_VAR_RE.match(var.strip()):
        found.add(BOOL_ACCESSOR_SCHEMA_VERSION)
    if expr_variables(node.get("category_filter")):
        found.add(FILTER_VARIABLES_SCHEMA_VERSION)
    if node.get("op") in _V10_CONDITION_OPS and "var" in node:
        found.add(NEGATED_TESTS_SCHEMA_VERSION)
    if node.get("fallback") is True and "value" in node:
        found.add(FALLBACK_SCHEMA_VERSION)
    if NEGATIVES_SCHEMA_VERSION not in found:
        for key in ("negative", "negative_override"):
            neg = node.get(key)
            if isinstance(neg, str) and neg.strip():
                found.add(NEGATIVES_SCHEMA_VERSION)
        if node.get("mode") in ("negative", "negative_replace") and "target_var" in node:
            found.add(NEGATIVES_SCHEMA_VERSION)
        extra = node.get("extra_actions")
        if isinstance(extra, list) and extra:
            found.add(NEGATIVES_SCHEMA_VERSION)
    branches = node.get("branches")
    if isinstance(branches, list) and any(
        isinstance(b, dict) and _is_v7_condition(b.get("condition")) for b in branches
    ):
        found.add(DERIVATION_CONDITIONS_SCHEMA_VERSION)
    if CONSTRAINT_ONLY_SCHEMA_VERSION not in found:
        if _matrix_uses_only(node.get("matrix")):
            found.add(CONSTRAINT_ONLY_SCHEMA_VERSION)
        for key in _EXCEPTION_LIST_KEYS:
            excs = node.get(key)
            if isinstance(excs, list) and any(
                isinstance(e, dict) and e.get("mode") == "only" for e in excs
            ):
                found.add(CONSTRAINT_ONLY_SCHEMA_VERSION)
        for key in _MODE_OVERRIDE_KEYS:
            overrides = node.get(key)
            if isinstance(overrides, dict) and any(m == "only" for m in overrides.values()):
                found.add(CONSTRAINT_ONLY_SCHEMA_VERSION)
    kinds = node.get("tag_group_kinds")
    if isinstance(kinds, dict) and any(k == "accepts" for k in kinds.values()):
        found.add(TAG_AXES_SCHEMA_VERSION)
    if _is_non_default_target_select(node.get("target_select")):
        found.add(SP3_REACH_SCHEMA_VERSION)


def _scan(node: Any, found: set[int]) -> None:
    """One walk over ``node`` adding every feature version it uses to
    ``found``. Visits exactly the dicts and strings the ``uses_*`` scans
    above visit (dict values and list items; a tuple or other object is only
    seen by ``uses_sp2b_grammar``'s ``json.dumps``), so the result is the same
    as running each of them."""
    stack: list[Any] = [node]
    while stack:
        item = stack.pop()
        if isinstance(item, dict):
            _scan_dict(item, found)
            for key, value in item.items():
                # json.dumps writes the keys too, so the SP2b marker can sit
                # in one (a non-str key is a number/bool/None: never a match).
                if isinstance(key, str) and "{" in key and _SP2B_MARKER_RE.search(key):
                    found.add(SP2B_SCHEMA_VERSION)
                if isinstance(value, str):
                    _scan_text(value, found, dict_value=True)
                elif isinstance(value, (dict, list)):
                    stack.append(value)
                elif value is not None and not isinstance(value, (bool, int, float)):
                    _scan_other(value, found)
        elif isinstance(item, list):
            for child in item:
                if isinstance(child, str):
                    _scan_text(child, found, dict_value=False)
                elif isinstance(child, (dict, list)):
                    stack.append(child)
                elif child is not None and not isinstance(child, (bool, int, float)):
                    _scan_other(child, found)
        elif isinstance(item, str):
            _scan_text(item, found, dict_value=False)
        elif item is not None and not isinstance(item, (bool, int, float)):
            _scan_other(item, found)


def _scan_other(value: Any, found: set[int]) -> None:
    """A value JSON has no type for (a tuple, a set …): only the serialised
    SP2b check reaches inside it, as ``json.dumps(default=str)`` writes it."""
    text = json.dumps(value, ensure_ascii=False, default=str)
    if _SP2B_MARKER_RE.search(text) is not None:
        found.add(SP2B_SCHEMA_VERSION)


def schema_versions_used(payload: Any) -> set[int]:
    """Every feature version ``payload`` uses (the versions above
    ``CURRENT_SCHEMA_VERSION`` whose ``uses_*`` scan is true), in one walk."""
    found: set[int] = set()
    _scan(payload, found)
    return found


def schema_version_for_payload(payload: Any) -> int:
    """The lowest catalog version that covers every feature in ``payload``.

    One structural walk collecting every feature (``schema_versions_used``)
    rather than one walk per feature: an export of a whole library walked it
    ten times plus a ``json.dumps``. Same answer as ``_schema_version_per_scan``.
    """
    found = schema_versions_used(payload)
    return max(found) if found else CURRENT_SCHEMA_VERSION


def _schema_version_per_scan(payload: Any) -> int:
    """The answer one ``uses_*`` scan at a time, highest version first: the
    reference ``schema_version_for_payload`` is tested against."""
    if uses_bool_accessor(payload):
        return BOOL_ACCESSOR_SCHEMA_VERSION
    if uses_filter_variables(payload):
        return FILTER_VARIABLES_SCHEMA_VERSION
    if uses_negated_tests(payload):
        return NEGATED_TESTS_SCHEMA_VERSION
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
