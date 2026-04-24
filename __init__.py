"""ComfyUI-WildcardPipeline — modular procedural prompt generation.

MVP scaffold. Real node registration lands in Plan P3. This stub exists
so ComfyUI's custom-node loader doesn't error on directory load.
"""

from __future__ import annotations

try:
    from comfy_api.latest import ComfyExtension  # pyright: ignore[reportMissingImports]

    class WildcardPipelineExtension(ComfyExtension):
        """Empty scaffold extension — nodes added in P3."""

        async def get_node_list(self):
            return []

    async def comfy_entrypoint() -> WildcardPipelineExtension:
        return WildcardPipelineExtension()

except ImportError:
    # Running outside ComfyUI (e.g. pytest) — nothing to register.
    pass
