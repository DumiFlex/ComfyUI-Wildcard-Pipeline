"""WP_PromptCleaner — V3 node wrapping the cleaner engine.

Slots:
  - prompt   : STRING (required, multiline)
  - cleaner  : WP_CLEANER widget (config JSON: mode, intensity,
                 rules_override, blocklist)

Output:
  - prompt   : STRING

No PIPELINE_CONTEXT input — all rules operate on the prompt string +
widget config alone. The node parses the widget JSON, runs
PromptCleaner.run(), and emits the cleaned text plus a UI payload
(per-rule report + word/char counts) the widget reads via the
ComfyUI `executed` event.
"""

import json
from typing import Any

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine.cleaner.pipeline import PromptCleaner
from engine.cleaner.tokenize import count_chars, count_words
from wp_nodes.types import CleanerWidgetInput


def _parse_config(raw: dict[str, Any] | str | None) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, str):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return data if isinstance(data, dict) else {}
    return raw


class WPPromptCleaner(io.ComfyNode):
    """Rule-based prompt cleaner. Operates on a single STRING input."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_PromptCleaner",
            display_name="WP Prompt Cleaner",
            category="wildcard-pipeline",
            inputs=[
                io.String.Input(
                    "prompt",
                    multiline=True,
                    default="",
                    tooltip=(
                        "Prompt text to clean up. Wire from an upstream "
                        "WP Prompt Assembler (or any other string source) "
                        "and the configured rules — punctuation, weights, "
                        "duplicates, blocklist — apply on top."
                    ),
                ),
                CleanerWidgetInput.Input("wp_cleaner", socketless=True, default="{}"),
            ],
            outputs=[io.String.Output("prompt")],
            not_idempotent=True,
        )

    @classmethod
    def execute(cls, prompt, wp_cleaner="{}"):
        cfg = _parse_config(wp_cleaner)
        result = PromptCleaner().run(prompt, cfg)
        text = result["text"]
        ui_payload = {
            "wp_cleaner_report": [result["report"]],
            "wp_cleaner_word_count": [count_words(text)],
            "wp_cleaner_char_count": [count_chars(text)],
        }
        return io.NodeOutput(text, ui=ui_payload)
