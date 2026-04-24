"""Root conftest — lets pytest import engine/nodes without installing the package.

Also collects-ignores ComfyUI-dependent directories when comfy_api is absent.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

collect_ignore: list[str] = []

# Tests for node wrappers require comfy_api; skip them when it's unavailable
# (e.g. running pytest outside ComfyUI's Python environment).
if importlib.util.find_spec("comfy_api") is None:
    collect_ignore.append("tests/test_nodes.py")
