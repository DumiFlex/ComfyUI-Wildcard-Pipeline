"""Delete build artefacts left behind by previous versions.

Our frontend chunks are content-hashed, so each release emits new filenames.
ComfyUI Manager updates by extracting the new package over the installed
folder and never removes files the new version dropped. Both behaviours are
reasonable alone; together they leak. Measured on a real 2.13.1 install
(2026-08-06):

    js/    518 files   36.0 MB    179 stale chunk copies
    web/  1256 files   18.6 MB   1120 stale chunk copies

`js/` is the expensive half: ComfyUI requests EVERY `.js` under
``WEB_DIRECTORY`` at page load, so 237 chunks were fetched where 58 were live
— 9.9 MB, which was 42% of all extension bytes on that install.

Local development never sees this because Vite's ``emptyOutDir`` wipes the
output directory on every build. Only installs that update accumulate, which
is why it went unnoticed through a dozen releases.

The build writes ``.wp-assets.json`` into each output directory listing what it
produced; anything hashed and absent from that list is from an older version
and safe to remove.
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path

_MANIFEST_NAME = ".wp-assets.json"

# Rollup/Vite hashed output: `name-B1a2C3d4.js`, `style-XyZ98765.css`, and
# their sourcemaps, which append `.map` to the WHOLE filename rather than
# replacing the extension — `name-B1a2C3d4.js.map`. The optional group is what
# catches those; without it, orphaned maps were the one artefact class the
# prune walked straight past.
#
# Deliberately narrow. Anything that is not obviously a hashed build artefact
# is left alone even when the manifest does not mention it, so a doc, an image
# or a file a user dropped in by hand is never at risk. The cost of missing a
# stale file is disk; the cost of deleting a live one is a broken install.
_HASHED = re.compile(r"-[A-Za-z0-9_-]{8,}\.(?:js|css)(?:\.map)?$")


def _is_build_artefact(name: str) -> bool:
    """Whether a filename is something only the bundler produces.

    Hashed chunks, plus ANY sourcemap. Maps get the wider rule because the
    entry map is unhashed — `main.js.map` — so the pattern above walks past it,
    and no map is ever content a user authored or a doc we ship. Builds stopped
    emitting maps entirely, so on a current install this only ever matches
    leftovers from an older one.
    """
    return name.endswith(".map") or bool(_HASHED.search(name))

_log = logging.getLogger(__name__)


def _load_manifest(root: Path) -> set[str] | None:
    """The file list this build produced, or None when it cannot be trusted."""
    path = root / _MANIFEST_NAME
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    files = data.get("files") if isinstance(data, dict) else None
    if not isinstance(files, list) or not files:
        # An empty list would mean "delete every hashed file", which is exactly
        # what a truncated or half-written manifest looks like. Refuse it.
        return None
    return {f for f in files if isinstance(f, str)}


def prune_stale_assets(root: Path) -> list[str]:
    """Delete hashed artefacts under `root` that this build did not produce.

    Returns the relative paths removed. Never raises: a failure here must not
    stop the plugin loading, and the only consequence of doing nothing is the
    disk usage we already have.

    No manifest means no action. That covers an install predating this
    mechanism, a partial extract, and anyone who points the plugin at a
    directory it did not build.
    """
    removed: list[str] = []
    try:
        if not root.is_dir():
            return removed
        manifest = _load_manifest(root)
        if manifest is None:
            return removed
        for path in root.rglob("*"):
            try:
                if not path.is_file():
                    continue
                if not _is_build_artefact(path.name):
                    continue
                rel = path.relative_to(root).as_posix()
                if rel in manifest:
                    continue
                path.unlink()
                removed.append(rel)
            except OSError:
                # One locked or vanished file must not abandon the rest.
                continue
    except Exception:  # noqa: BLE001 - pruning is best-effort by design
        _log.exception("wildcard-pipeline: asset prune failed")
    return removed


def prune_package_assets(package_dir: Path) -> int:
    """Prune every output directory this package ships. Returns files removed."""
    total = 0
    for name in ("js", "web"):
        removed = prune_stale_assets(package_dir / name)
        total += len(removed)
        if removed:
            _log.info(
                "wildcard-pipeline: removed %d stale file(s) from %s/ "
                "left by a previous version",
                len(removed), name,
            )
    return total
