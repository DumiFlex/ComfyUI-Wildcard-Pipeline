"""Root conftest — lets pytest import engine/nodes without installing the package.

Also collects-ignores ComfyUI-dependent directories when comfy_api is absent.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

collect_ignore: list[str] = []

try:
    import comfy_api  # noqa: F401
except ImportError:
    # Tests for node wrappers require comfy_api; skip them when unavailable.
    collect_ignore.append("tests/test_nodes.py")
