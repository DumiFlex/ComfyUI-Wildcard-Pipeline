"""aiohttp route setup for the wildcard pipeline manager SPA and API."""

from aiohttp import web


def setup_routes(app: web.Application) -> None:
    """Register all API routes and the SPA catch-all.

    Called from WildcardPipelineExtension.on_load().
    API routes MUST be registered before the catch-all.
    """
    # API routes will be added in Phase 5
    # _register_api_routes(app)

    # SPA catch-all — MUST be last
    # _register_spa_catchall(app)
    pass
