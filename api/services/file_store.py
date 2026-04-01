"""Generic JSON file store for CRUD operations on data directories.

Each resource type (wildcards, constraints, pipelines) lives in its own
subdirectory of ``data/``.  Files are stored as ``{name}.json`` where
*name* is the slugified resource name.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def _slugify(name: str) -> str:
    """Convert a human name to a filesystem-safe slug.

    ``"Lighting Weather"`` → ``"lighting-weather"``
    """
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    return slug or "unnamed"


class FileStore:
    """Read/write JSON documents in a single directory.

    Parameters
    ----------
    base_dir:
        Root directory for this resource type (e.g. ``data/wildcards``).
    """

    def __init__(self, base_dir: Path) -> None:
        self._base = base_dir
        self._base.mkdir(parents=True, exist_ok=True)

    @property
    def base_dir(self) -> Path:
        return self._base

    # -- Read -----------------------------------------------------------------

    def list_all(self) -> list[dict[str, Any]]:
        """Return all JSON documents in the directory (non-recursive)."""
        items: list[dict[str, Any]] = []
        if not self._base.is_dir():
            return items

        for path in sorted(self._base.glob("*.json")):
            data = self._read_file(path)
            if data is not None:
                items.append(data)
        return items

    def get(self, name: str) -> dict[str, Any] | None:
        """Return a single document by name, or *None* if not found."""
        path = self._path_for(name)
        if not path.is_file():
            return None
        return self._read_file(path)

    # -- Write ----------------------------------------------------------------

    def create(self, data: dict[str, Any]) -> Path:
        """Write a new document.  Raises ``FileExistsError`` if duplicate."""
        name = data.get("name", "unnamed")
        path = self._path_for(name)
        if path.is_file():
            raise FileExistsError(f"Resource '{name}' already exists")
        self._write_file(path, data)
        return path

    def update(self, name: str, data: dict[str, Any]) -> Path:
        """Overwrite an existing document.  Raises ``FileNotFoundError``."""
        path = self._path_for(name)
        if not path.is_file():
            raise FileNotFoundError(f"Resource '{name}' not found")

        new_name = data.get("name", name)
        new_path = self._path_for(new_name)

        # If name changed, rename the file
        if new_path != path:
            if new_path.is_file():
                raise FileExistsError(f"Resource '{new_name}' already exists")
            path.unlink()

        self._write_file(new_path, data)
        return new_path

    def delete(self, name: str) -> None:
        """Delete a document.  Raises ``FileNotFoundError``."""
        path = self._path_for(name)
        if not path.is_file():
            raise FileNotFoundError(f"Resource '{name}' not found")
        path.unlink()

    # -- Helpers --------------------------------------------------------------

    def _path_for(self, name: str) -> Path:
        return self._base / f"{_slugify(name)}.json"

    def _read_file(self, path: Path) -> dict[str, Any] | None:
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Failed to read %s: %s", path, exc)
            return None

    def _write_file(self, path: Path, data: dict[str, Any]) -> None:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
