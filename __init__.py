"""ComfyUI-WildcardPipeline — modular procedural prompt generation."""

import os
import sys

# Tells ComfyUI to serve files from this folder under
# /extensions/<package-name>/ and auto-load any `*.js` it finds.
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

from wp_nodes.assembler_node import WPPromptAssembler
from wp_nodes.context_node import WPContext
from wp_nodes.debug_node import WPDebug


class WildcardPipelineExtension(ComfyExtension):
    """Registers all WP nodes with ComfyUI."""

    async def get_node_list(self):
        return [WPContext, WPPromptAssembler, WPDebug]


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
