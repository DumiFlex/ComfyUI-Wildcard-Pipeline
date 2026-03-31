"""
comfyui-wildcard-pipeline
Weighted wildcards, chained pipelines, and context passing for ComfyUI.
"""

try:
    from typing_extensions import override
    from comfy_api.latest import ComfyExtension, io

    from .nodes.pipeline_node import WildcardPipeline
    from .nodes.prompt_assembler import PromptAssembler

    WEB_DIRECTORY = "./js"

    class WildcardPipelineExtension(ComfyExtension):
        @override
        async def get_node_list(self) -> list[type[io.ComfyNode]]:
            return [WildcardPipeline, PromptAssembler]

        @override
        async def on_load(self):
            from server import PromptServer
            from .api.server import setup_routes

            setup_routes(PromptServer.instance.app)

    async def comfy_entrypoint() -> WildcardPipelineExtension:
        return WildcardPipelineExtension()

except ImportError:
    pass
