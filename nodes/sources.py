"""Source resolution for wildcard and constraint modules.

Reads JSON files and injects their data inline into module configs
before the engine processes them. This keeps the engine pure (no file I/O).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "wildcards"
_DEFAULT_CONSTRAINTS_DIR = (
    Path(__file__).resolve().parent.parent / "data" / "constraints"
)


def resolve_sources(
    modules: list[dict[str, Any]],
    data_dir: Path | None = None,
    constraints_dir: Path | None = None,
) -> list[dict[str, Any]]:
    """Pre-process modules: load ``"source"`` references into inline data.

    For each wildcard module with a ``"source"`` key (e.g. ``"location.json"``),
    read the JSON file from *data_dir* and replace the source with the loaded
    options array. For constrain modules with a ``"source"`` key, load constraint
    rules from *constraints_dir*.

    Returns a new list — original modules are not mutated.
    """
    wc_base = data_dir or _DEFAULT_DATA_DIR
    cs_base = constraints_dir or _DEFAULT_CONSTRAINTS_DIR
    resolved: list[dict[str, Any]] = []

    for module in modules:
        module_type = module.get("type")

        if module_type == "wildcard" and "source" in module:
            resolved.append(_resolve_wildcard_source(module, wc_base))
        elif module_type == "constrain" and "source" in module:
            resolved.append(_resolve_constraint_source(module, cs_base))
        else:
            resolved.append(module)

    return resolved


def _resolve_wildcard_source(module: dict[str, Any], base: Path) -> dict[str, Any]:
    source = module["source"]
    file_path = _find_json_file(source, base)
    if file_path is None:
        msg = f"Wildcard source '{source}' not found in {base} — skipped"
        logger.warning(msg)
        return module

    data = _load_json(file_path, source)
    if data is None:
        return module

    options = data.get("options", [])
    if not options:
        msg = f"Wildcard source '{source}' has no options"
        logger.warning(msg)

    patched = {**module, "options": options}
    patched.pop("source", None)
    return patched


def _resolve_constraint_source(module: dict[str, Any], base: Path) -> dict[str, Any]:
    source = module["source"]
    file_path = _find_json_file(source, base)
    if file_path is None:
        msg = f"Constraint source '{source}' not found in {base} — skipped"
        logger.warning(msg)
        return module

    data = _load_json(file_path, source)
    if data is None:
        return module

    rules = data.get("rules", [])
    if not rules:
        msg = f"Constraint source '{source}' has no rules"
        logger.warning(msg)

    patched = {**module, "rules": rules}
    patched.pop("source", None)
    return patched


def _load_json(file_path: Path, source: str) -> dict[str, Any] | None:
    try:
        with open(file_path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        msg = f"Failed to load source '{source}': {exc}"
        logger.warning(msg)
        return None


def _find_json_file(source: str, base: Path) -> Path | None:
    """Locate a JSON file by UUID or filename in *base* (recursive).

    Resolution order:

    1. Direct: ``base/{source}.json`` (or ``base/{source}`` if already has ``.json``)
    2. Examples subdir: ``base/examples/{source}.json``
    3. Recursive rglob: scan all subdirectories for ``{source}.json``

    The rglob fallback handles category subdirectories (e.g. ``character/anime/``).
    Both UUID references (``"1a2b3c4d"``) and legacy filename references
    (``"location.json"``) are supported.
    """
    name = source if source.endswith(".json") else f"{source}.json"

    # Fast path: check known locations first
    candidates = [
        base / name,
        base / "examples" / name,
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate

    # Fallback: recursive scan (handles category subdirectories)
    for path in base.rglob(name):
        return path

    return None
