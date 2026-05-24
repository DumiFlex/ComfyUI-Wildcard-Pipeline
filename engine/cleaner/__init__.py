"""Prompt cleaner engine — pure-Python rule pipeline.

Zero ComfyUI imports — runs as plain Python and is testable with
vanilla pytest. The node layer (wp_nodes/prompt_cleaner.py) adapts
PIPELINE_CONTEXT into the small CleanerCtx dataclass this module
consumes.
"""
