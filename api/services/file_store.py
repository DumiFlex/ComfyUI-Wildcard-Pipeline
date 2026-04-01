"""Generic JSON file store for CRUD operations on data directories.

Each resource type (wildcards, constraints, pipelines) lives in its own
subdirectory of ``data/``.  Files are stored as ``{uuid}.json`` where
*uuid* is an 8-character hex identifier generated at creation time.

Categories are expressed as directory structure (max 2 levels deep).
A category string like ``"character > anime"`` maps to the subdirectory
``base_dir/character/anime/``.  Root-level documents have ``category=""``.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any
from uuid import uuid4

logger = logging.getLogger(__name__)


class FileStore:
    """Read/write JSON documents in a directory tree.

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
        """Return all JSON documents in the directory tree.

        Each document is enriched with a ``"category"`` field derived from
        its path relative to ``base_dir`` (max 2 directory levels).
        """
        items: list[dict[str, Any]] = []
        if not self._base.is_dir():
            return items

        for path in sorted(self._base.rglob("*.json")):
            data = self._read_file(path)
            if data is not None:
                rel = path.relative_to(self._base)
                parts = rel.parts[:-1]  # exclude filename
                parts = parts[:2]  # max 2 levels
                data["category"] = " > ".join(parts) if parts else ""
                items.append(data)
        return items

    def get(self, id: str) -> dict[str, Any] | None:
        """Return a single document by id, or *None* if not found."""
        path = self._find_by_id(id)
        if path is None:
            return None
        return self._read_file(path)

    def list_categories(self) -> list[str]:
        """Return unique category strings derived from directory structure.

        Scans subdirectories up to 2 levels deep. Root-level documents
        (no subdirectory) are excluded — they have ``category=""``.
        """
        categories: set[str] = set()
        if not self._base.is_dir():
            return []
        for path in self._base.rglob("*.json"):
            rel = path.relative_to(self._base)
            parts = rel.parts[:-1]  # exclude filename
            if not parts:
                continue
            parts = parts[:2]
            categories.add(" > ".join(parts))
        return sorted(categories)

    def list_tags(self) -> list[str]:
        """Return all unique tags across all documents (sorted)."""
        tags: set[str] = set()
        for item in self.list_all():
            for tag in item.get("tags", []):
                if isinstance(tag, str):
                    tags.add(tag)
        return sorted(tags)

    def list_filtered(
        self,
        category: str | None = None,
        tag: str | None = None,
    ) -> list[dict[str, Any]]:
        """Filter ``list_all()`` by category and/or tag.

        Parameters
        ----------
        category:
            Exact category string to match (e.g. ``"character > anime"``).
            Pass ``""`` to match root-level documents.  Pass ``None`` to
            skip category filtering.
        tag:
            A single tag string that must appear in the document's
            ``"tags"`` list.  Pass ``None`` to skip tag filtering.
        """
        items = self.list_all()
        if category is not None:
            items = [i for i in items if i.get("category") == category]
        if tag is not None:
            items = [i for i in items if tag in i.get("tags", [])]
        return items

    # -- Write ----------------------------------------------------------------

    def create(self, data: dict[str, Any], category: str = "") -> dict[str, Any]:
        """Write a new document with a generated UUID id.

        Parameters
        ----------
        data:
            Document payload (must not include ``"id"``).
        category:
            Optional ``"a"`` or ``"a > b"`` string (max 2 levels).
            Defaults to root level (``""``).

        Returns the full data dict including the injected ``"id"``.
        """
        target_dir = self._resolve_category_dir(category)
        target_dir.mkdir(parents=True, exist_ok=True)
        new_id = self._generate_id_in(target_dir)
        record = dict(data)
        record["id"] = new_id
        path = target_dir / f"{new_id}.json"
        self._write_file(path, record)
        return record

    def update(self, id: str, data: dict[str, Any]) -> dict[str, Any]:
        """Overwrite an existing document.  Raises ``FileNotFoundError``.

        The ``id`` field is always preserved from the URL parameter.
        No rename logic — UUID filenames never change.
        """
        path = self._find_by_id(id)
        if path is None:
            raise FileNotFoundError(f"Resource '{id}' not found")
        record = dict(data)
        record["id"] = id  # ensure id field is preserved
        self._write_file(path, record)
        return record

    def delete(self, id: str) -> bool:
        """Delete a document.  Returns True if deleted, raises ``FileNotFoundError`` if not found."""
        path = self._find_by_id(id)
        if path is None:
            raise FileNotFoundError(f"Resource '{id}' not found")
        path.unlink()
        return True

    # -- Helpers --------------------------------------------------------------

    def _find_by_id(self, id: str) -> Path | None:
        """Find a file by id anywhere in the store (including subdirectories)."""
        for path in self._base.rglob(f"{id}.json"):
            return path  # return first match
        return None

    def _resolve_category_dir(self, category: str) -> Path:
        """Return the target directory for a category string (max 2 levels)."""
        if not category:
            return self._base
        parts = [p.strip() for p in category.split(" > ") if p.strip()]
        parts = parts[:2]  # enforce max 2 levels
        result = self._base
        for part in parts:
            result = result / part
        return result

    def _generate_id(self) -> str:
        """Generate a unique 8-char hex UUID in base_dir (backward compat)."""
        return self._generate_id_in(self._base)

    def _generate_id_in(self, target_dir: Path) -> str:
        """Generate a unique 8-char hex UUID in the given directory."""
        while True:
            new_id = uuid4().hex[:8]
            if not (target_dir / f"{new_id}.json").exists():
                return new_id

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
