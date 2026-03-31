"""Pytest configuration — adds project root to sys.path for engine imports
without triggering the root __init__.py (which requires comfy_api)."""

import sys
from pathlib import Path

# Add project root to sys.path so `from engine.pipeline import ...` works.
# We use importlib mode in pyproject.toml so pytest won't walk __init__.py
# files as package markers.
sys.path.insert(0, str(Path(__file__).resolve().parent))

collect_ignore = [
    "__init__.py",
    "nodes",
    "api",
]
