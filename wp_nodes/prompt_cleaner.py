"""WP_PromptCleaner — V3 node wrapping the cleaner engine.

Slots:
  - prompt   : STRING (required, multiline)
  - cleaner  : WP_CLEANER widget (config JSON: mode, intensity,
                 rules_override, blocklist)

  - negative : STRING (optional) — cleaned by the rule list's negative column

Output:
  - prompt   : STRING
  - negative : STRING ("" when the negative input is empty)

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
                # Send-to-negative: one node cleans both prompts. Declared
                # right after `prompt` so the boxes read prompt, negative,
                # rules. Workflows saved before this carry two positional
                # widget values; `upgradeLegacyValues` (src/widgets/cleaner.ts)
                # moves the rules JSON back where it belongs on load.
                # A text box (like `prompt`) so the node also works on its
                # own: type or paste a negative, or wire one in.
                io.String.Input(
                    "negative",
                    optional=True,
                    multiline=True,
                    default="",
                    tooltip=(
                        "Optional negative prompt. Type it here or wire one "
                        "in (e.g. an Assembler's negative output). Cleaned "
                        "by the rules' negative column; left empty, the "
                        "negative output is empty."
                    ),
                ),
                # Optional (execute defaults it) only so it sorts after `negative`:
                # the frontend lays out required inputs before optional ones.
                CleanerWidgetInput.Input(
                    "wp_cleaner", socketless=True, default="{}", optional=True,
                ),
            ],
            # `prompt` stays at index 0 so existing links keep their slot.
            outputs=[io.String.Output("prompt"), io.String.Output("negative")],
            not_idempotent=True,
        )

    @classmethod
    def execute(cls, prompt, wp_cleaner="{}", negative=None):
        cfg = _parse_config(wp_cleaner)
        cleaner = PromptCleaner()
        result = cleaner.run(prompt, cfg)
        text = result["text"]
        ui_payload = {
            "wp_cleaner_report": [result["report"]],
            "wp_cleaner_word_count": [count_words(text)],
            "wp_cleaner_char_count": [count_chars(text)],
        }
        neg_text = ""
        if isinstance(negative, str) and negative.strip():
            neg = cleaner.run_negative(negative, cfg, prompt=text)
            neg_text = neg["text"]
            ui_payload["wp_cleaner_negative_report"] = [neg["report"]]
            ui_payload["wp_cleaner_negative_word_count"] = [count_words(neg_text)]
        return io.NodeOutput(text, neg_text, ui=ui_payload)
