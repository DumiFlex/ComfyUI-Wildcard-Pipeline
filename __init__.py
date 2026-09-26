"""ComfyUI-Wildcard-Pipeline — modular procedural prompt generation."""

import os
import sys

# Tells ComfyUI to serve files from this folder under
# /extensions/<package-name>/ and auto-load any `*.js` it finds. Only the
# entry `main.js` uses that extension; lazy chunks are `.mjs` so ComfyUI does
# not import them all up front (vite.config.mts).
#
# "any *.js it finds" is load-bearing: ComfyUI fetches EVERY file it lists
# here on page load, so a chunk left behind by an older version is not merely
# dead weight on disk — it is a request and a parse on every visit. Hence the
# prune below.
WEB_DIRECTORY = "./js"

# Expose engine/ and wp_nodes/ as top-level packages so internal absolute imports
# (``from engine.X import ...``, ``from wp_nodes.X import ...``) resolve the same
# whether ComfyUI's custom-node loader or pytest invokes us. ComfyUI sets up
# ``submodule_search_locations`` on this package but does not add the package
# dir to ``sys.path``, so absolute imports to ``engine``/``wp_nodes`` would fail
# without this shim. ``wp_nodes`` (not ``nodes``) avoids collision with
# ComfyUI's top-level ``nodes.py`` module.
_PKG_DIR = os.path.dirname(os.path.abspath(__file__))
if _PKG_DIR not in sys.path:
    sys.path.insert(0, _PKG_DIR)

# pyright: reportMissingImports=false
# ruff: noqa: E402 — imports must follow the sys.path shim above
from comfy_api.latest import ComfyExtension

# Remove chunks left by previous versions BEFORE ComfyUI scans WEB_DIRECTORY.
# Manager updates extract over the installed folder without deleting what the
# new version dropped, and our filenames are content-hashed, so every update
# leaves the previous build behind. Self-healing on the next start; see
# `wp_api/web_assets.py` for the measurements that motivated it.
#
# Wrapped because nothing here is worth failing a plugin load over — the
# fallback is the disk usage that already exists.
try:
    from pathlib import Path as _Path

    from wp_api.web_assets import prune_package_assets as _prune_package_assets

    _prune_package_assets(_Path(_PKG_DIR))
except Exception:  # noqa: BLE001 - never crash ComfyUI over housekeeping
    import logging as _logging

    _logging.getLogger(__name__).exception(
        "wildcard-pipeline: stale-asset prune failed",
    )

# Move our files into `<ComfyUI>/user/wildcard-pipeline/` if a previous version
# left them loose in the user directory.
#
# Placement is load-bearing: this must run BEFORE anything opens the database.
# SQLite keeps `-wal` and `-shm` sidecars beside the main file, and moving that
# set out from under an open connection corrupts it. Node imports below can
# reach the DB, so the migration goes above them.
#
# Wrapped for the same reason as the prune above: the fallback is "keep using
# the old location", which is strictly better than failing to load.
try:
    from engine.db.relocate import migrate_user_data as _migrate_user_data

    _report = _migrate_user_data()
    if _report.did_anything:
        import logging as _logging

        _log = _logging.getLogger(__name__)
        if _report.moved:
            _log.info(
                "wildcard-pipeline: moved into user/wildcard-pipeline/: %s",
                ", ".join(_report.moved),
            )
        # Skips and failures are warnings: in both cases a file the user cares
        # about is not where the extension will now look for it.
        for _note in _report.skipped:
            _log.warning("wildcard-pipeline: left in place — %s", _note)
        for _note in _report.failed:
            _log.warning("wildcard-pipeline: could not move %s", _note)
except Exception:  # noqa: BLE001 - never crash ComfyUI over housekeeping
    import logging as _logging

    _logging.getLogger(__name__).exception(
        "wildcard-pipeline: user-data relocation failed",
    )

from wp_nodes.assembler_node import WPPromptAssembler
from wp_nodes.context_loop import WPContextLoop
from wp_nodes.context_node import WPContext
from wp_nodes.debug_node import WPDebug
from wp_nodes.injector_node import WPContextInjector
from wp_nodes.prompt_cleaner import WPPromptCleaner
from wp_nodes.seed_list import WPSeedList
from wp_nodes.var_to_bool import WPVarToBool
from wp_nodes.var_to_float import WPVarToFloat
from wp_nodes.var_to_int import WPVarToInt


class WildcardPipelineExtension(ComfyExtension):
    """Registers all WP nodes with ComfyUI."""

    async def get_node_list(self):
        return [
            WPContext,
            WPContextLoop,
            WPPromptAssembler,
            WPDebug,
            WPContextInjector,
            WPPromptCleaner,
            WPSeedList,
            WPVarToInt,
            WPVarToFloat,
            WPVarToBool,
        ]


async def comfy_entrypoint() -> WildcardPipelineExtension:
    return WildcardPipelineExtension()


# Register SPA + REST API routes on ComfyUI's aiohttp app.
# Imported lazily inside the try-block so static analysis tools that
# don't have ComfyUI's `server` module on the path don't fail.
try:
    from server import PromptServer  # type: ignore[import-not-found]

    from wp_api import register_routes as _register_wp_routes

    _register_wp_routes(PromptServer.instance.app)
except Exception:  # noqa: BLE001 - never crash ComfyUI on route registration failure
    import logging

    logging.getLogger(__name__).exception(
        "wildcard-pipeline: route registration failed",
    )
