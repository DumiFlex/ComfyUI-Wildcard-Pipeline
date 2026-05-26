"""Unit test for the extension's comfy_entrypoint wiring."""

import asyncio
import importlib.util
import sys
from pathlib import Path


def _load_root_init():
    """Load the project-root __init__.py as a package-aware module."""
    project_root = Path(__file__).parent.parent
    init_path = project_root / "__init__.py"
    spec = importlib.util.spec_from_file_location(
        "wildcard_pipeline_root",
        init_path,
        submodule_search_locations=[str(project_root)],
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["wildcard_pipeline_root"] = module
    spec.loader.exec_module(module)
    return module


def test_entrypoint_exposes_all_node_classes():
    ext = _load_root_init()
    extension = asyncio.run(ext.comfy_entrypoint())
    node_list = asyncio.run(extension.get_node_list())

    ids = sorted(cls.define_schema().node_id for cls in node_list)
    assert ids == [
        "WP_Context",
        "WP_ContextInjector",
        "WP_Debug",
        "WP_PromptAssembler",
        "WP_PromptCleaner",
        "WP_VarToBool",
        "WP_VarToFloat",
        "WP_VarToInt",
    ]
