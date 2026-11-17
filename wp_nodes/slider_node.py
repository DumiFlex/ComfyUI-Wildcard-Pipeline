"""WP_Slider — several number sliders in one node.

Each slider writes its own variable (the number, a text that may read
``$name.num``, or the word of the range the value falls in) and its number to
the cross-node table ``$name.num`` reads. A pinned slider also has a number
output. ComfyUI V3 has no dynamic outputs and fixed output types, so the
schema declares the context plus :data:`sliders.MAX_OUTPUTS` outputs of type
``*``; the frontend (``src/widgets/sliders.ts``) shows only the pinned ones,
typed INT or FLOAT from the slider's decimals, and each row's ``out`` says
which slot it drives. ``execute`` always returns the full tuple, so a slot
the canvas hid reads ``0``.

Resolution lives in ``engine/sliders.py``.
"""
from __future__ import annotations

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine import negatives, sliders, template
from wp_nodes.types import PipelineContext, SlidersWidgetInput, carry_frame0


def _has_syntax(text: str) -> bool:
    """Whether the text needs resolving: a `$var` / `$$`, an `@{ref}` /
    `@@` or a `{…}`. Plain text is left exactly as written."""
    return "$" in text or "{" in text or "@" in text


class WPSlider(io.ComfyNode):
    """Chain source of number variables, plus a number output per pinned slider."""

    #: The node id traces, warnings and negatives name (WP_Slider2D reuses
    #: this class's run with its own).
    NODE = "WP_Slider"
    LABEL = "WP Slider"

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_Slider",
            display_name="WP Slider",
            category="wildcard-pipeline",
            description=(
                "Several sliders in one node. Each writes $its_variable (the "
                "number, your text, or a word per range of values), $name.num "
                "always reads the number, and a slider can show an INT or "
                "FLOAT output."
            ),
            inputs=[
                PipelineContext.Input(
                    "upstream",
                    optional=True,
                    tooltip=(
                        "Optional upstream Context to extend. Only nodes after "
                        "this one see the slider variables."
                    ),
                ),
                SlidersWidgetInput.Input(
                    "wp_sliders", socketless=True, default="", optional=True,
                ),
            ],
            outputs=[
                PipelineContext.Output("context"),
                *(
                    io.AnyType.Output(f"value_{i}")
                    for i in range(1, sliders.MAX_OUTPUTS + 1)
                ),
            ],
            hidden=[io.Hidden.unique_id],
            not_idempotent=True,
        )

    @classmethod
    def execute(
        cls,
        upstream: PipelineContext | None = None,
        wp_sliders: str = "",
    ):
        out = cls._execute(upstream, wp_sliders)
        carry_frame0(upstream, out.args[0], lambda up: cls._execute(up, wp_sliders).args[0])
        return out

    @classmethod
    def _execute(
        cls,
        upstream: PipelineContext | None = None,
        wp_sliders: str = "",
    ):
        cfg = sliders.parse_config(wp_sliders)
        return io.NodeOutput(cls._context(upstream, cfg), *sliders.output_values(cfg))

    @classmethod
    def _context(cls, upstream: PipelineContext | None, cfg: sliders.Config):
        """The Context with every slider variable, its negatives, the
        `$name.num` table, traces and warnings added."""
        upstream_ctx: dict = upstream.context if upstream is not None else {}
        upstream_debug: dict = upstream.debug if upstream is not None else {}
        upstream_internals: dict = upstream.internals if upstream is not None else {}
        values = sliders.resolve(cfg)
        raw_values = dict(values)
        nums = sliders.nums(cfg)
        by_var = {s.var: s for s in cfg.sliders if s.var in values}

        # The cross-node number table, upstream's plus ours, so a text here
        # (and every node after) can read `$name.num`.
        num_table = {**(upstream_internals.get(sliders.NUMS_KEY) or {}), **nums}
        read_ctx = {**upstream_ctx, sliders.NUMS_KEY: num_table}
        value_warnings: list = []
        value_reads: dict[str, list] = {}
        for name in values:
            s = by_var[name]
            if s.mode == "text" and _has_syntax(values[name]):
                value_reads[name] = []
                values[name] = template.resolve_variables(
                    values[name],
                    {**read_ctx, **values, "__wp_warnings__": value_warnings},
                    reads=value_reads[name],
                )

        def resolve_neg(text: str) -> str:
            if _has_syntax(text):
                text = template.resolve_variables(text, {**read_ctx, **values})
            return text.strip()

        own_negs = {k: resolve_neg(v) for k, v in sliders.own_negatives(cfg).items()}

        hidden = getattr(cls, "hidden", None)
        node_id = getattr(hidden, "unique_id", None) if hidden is not None else None

        ctx: dict = dict(upstream_ctx)
        ctx.update(values)

        out_internals = dict(upstream_internals)
        # A write replaces a variable's negatives (send-to-negative rule); a
        # text that reads `$vars` carries theirs, then the slider's own.
        table = {
            k: v for k, v in (out_internals.get(negatives.NEG_KEY) or {}).items()
            if k not in values
        }
        for k in values:
            entries = negatives.entries_for_reads(
                {negatives.NEG_KEY: table}, value_reads.get(k, []),
            )
            if own_negs.get(k):
                entries.append({"text": own_negs[k], "pick": None, "source": cls.NODE})
            if entries:
                table[k] = entries
        if table or negatives.NEG_KEY in out_internals:
            out_internals[negatives.NEG_KEY] = table
        if nums:
            out_internals[sliders.NUMS_KEY] = num_table
        hidden_vars = sliders.internal_vars(cfg)
        flags = dict(out_internals.get("__wp_internal_flags__") or {})
        for k in values:
            if k in hidden_vars:
                flags[k] = True
            else:
                flags.pop(k, None)
        if flags or "__wp_internal_flags__" in out_internals:
            out_internals["__wp_internal_flags__"] = flags

        traces = []
        for name, value in values.items():
            s = by_var[name]
            detail: dict = {"mode": s.mode, "range": [s.min, s.max]}
            if raw_values[name] != value:
                detail["raw"] = raw_values[name][:240]
            traces.append({
                "node": cls.NODE,
                "binding": name,
                "internal": name in hidden_vars,
                "type": "slider",
                "value": value,
                "num": nums.get(name, ""),
                **({"negative": own_negs[name]} if own_negs.get(name) else {}),
                "detail": detail,
            })
        warnings = [
            {"type": "slider_problem", "severity": "warn", "message": f"{cls.LABEL}: {msg}"}
            for msg in sliders.problems(cfg)
        ]
        warnings += [
            {**w, "message": f"{cls.LABEL} text: {w.get('message', '')}"}
            for w in value_warnings if isinstance(w, dict)
        ]

        debug = dict(upstream_debug)
        if node_id is not None:
            for row in traces + warnings:
                row["node_id"] = str(node_id)
        if traces:
            debug["__wp_trace__"] = list(debug.get("__wp_trace__", [])) + traces
        if warnings:
            debug["__wp_warnings__"] = list(debug.get("__wp_warnings__", [])) + warnings

        return PipelineContext.Type(context=ctx, debug=debug, internals=out_internals)
