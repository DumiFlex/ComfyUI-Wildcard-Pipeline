"""Source resolution for wildcard modules.

Reads wildcard JSON files and injects their options inline into module configs
before the engine processes them. This keeps the engine pure (no file I/O).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_DEFAULT_DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "wildcards"


def resolve_sources(
    modules: list[dict[str, Any]],
    data_dir: Path | None = None,
) -> list[dict[str, Any]]:
    """Pre-process modules: load ``"source"`` references into inline ``"options"``.

    For each wildcard module with a ``"source"`` key (e.g. ``"location.json"``),
    read the JSON file from *data_dir* and replace the source with the loaded
    options array. Modules that already have inline ``"options"`` or are not
    wildcards are passed through unchanged.

    Returns a new list — original modules are not mutated.
    """
    base = data_dir or _DEFAULT_DATA_DIR
    resolved: list[dict[str, Any]] = []

    for module in modules:
        if module.get("type") != "wildcard" or "source" not in module:
            resolved.append(module)
            continue

        source = module["source"]
        file_path = _find_wildcard_file(source, base)
        if file_path is None:
            logger.warning(
                "Wildcard source '%s' not found in %s — skipped", source, base
            )
            resolved.append(module)
            continue

        try:
            with open(file_path, encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Failed to load wildcard source '%s': %s", source, exc)
            resolved.append(module)
            continue

        options = data.get("options", [])
        if not options:
            logger.warning("Wildcard source '%s' has no options", source)

        patched = {**module, "options": options}
        patched.pop("source", None)
        resolved.append(patched)

    return resolved


def _find_wildcard_file(source: str, base: Path) -> Path | None:
    """Locate a wildcard JSON file by name.

    Searches *base* directory and its ``examples/`` subdirectory.
    Appends ``.json`` if not already present.
    """
    name = source if source.endswith(".json") else f"{source}.json"

    candidates = [
        base / name,
        base / "examples" / name,
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate

    return None
