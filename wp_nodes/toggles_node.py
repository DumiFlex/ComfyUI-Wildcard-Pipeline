"""WP_Toggles — one node for many on/off switches.

Each toggle writes ``"true"`` / ``"false"`` to its own variable, and
a pinned toggle also has a plain BOOLEAN output. ComfyUI V3 has no dynamic
outputs, so the schema declares the context plus :data:`MAX_OUTPUTS`
BOOLEANs; the frontend (``src/widgets/toggles.ts``) shows only the pinned ones
and each row's ``out`` says which slot it drives. ``execute`` always returns
the full tuple, so a slot the canvas hid reads ``False``.

Resolution (``needs`` links, Pick one) lives in ``engine/toggles.py``.
"""
from __future__ import annotations

from typing import Any

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine import negatives, template, toggles
from wp_nodes.types import PipelineContext, TogglesWidgetInput


class WPToggles(io.ComfyNode):
    """Chain source of on/off variables, plus a BOOLEAN per pinned toggle."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_Toggles",
            display_name="WP Toggles",
            category="wildcard-pipeline",
            description=(
                "Several on/off switches in one node. Each writes $its_variable "
                "as true or false for rules to branch on, and can show a "
                "BOOLEAN output for switch nodes."
            ),
            inputs=[
                PipelineContext.Input(
                    "upstream",
                    optional=True,
                    tooltip=(
                        "Optional upstream Context to extend. Only nodes after "
                        "this one see the toggle variables."
                    ),
                ),
                TogglesWidgetInput.Input(
                    "wp_toggles", socketless=True, default="", optional=True,
                ),
            ],
            outputs=[
                PipelineContext.Output("context"),
                *(
                    io.Boolean.Output(f"toggle_{i}")
                    for i in range(1, toggles.MAX_OUTPUTS + 1)
                ),
            ],
            hidden=[io.Hidden.unique_id],
            not_idempotent=True,
        )

    @classmethod
    def execute(
        cls,
        upstream: PipelineContext | None = None,
        wp_toggles: str = "",
    ):
        upstream_ctx: dict = upstream.context if upstream is not None else {}
        cfg, from_upstream = toggles.with_upstream(toggles.parse_config(wp_toggles), upstream_ctx)
        values = toggles.resolve(cfg)
        set_vars = {t.var for t in cfg.toggles if t.id in from_upstream}
        group = cfg.group_var if cfg.mode == "one" else ""
        raw_values = dict(values)
        on_off = toggles.bools(cfg)
        valued = {t.var for t in cfg.toggles if t.writes_text and t.var in values}
        # A value may read upstream variables and the toggles' own. Inline
        # {a|b} picks need a seed the node doesn't have, so they stay as
        # written (the Assembler's seedless surface), like the Context
        # Injector's templates; the editor warns about them. Toggles first,
        # then the pick, which may hold a toggle's value.
        value_warnings: list = []
        read_ctx = {**upstream_ctx, toggles.BOOLS_KEY: on_off}
        value_order = [*sorted(valued - {group}), *([group] if group in values else [])]
        value_reads: dict[str, list] = {}
        for name in value_order:
            text = values[name]
            if "$" in text or "{" in text:
                value_reads[name] = []
                values[name] = template.resolve_variables(
                    text, {**read_ctx, **values, "__wp_warnings__": value_warnings},
                    reads=value_reads[name],
                )

        def resolve_neg(text: str) -> str:
            if "$" in text or "{" in text:
                text = template.resolve_variables(text, {**read_ctx, **values})
            return text.strip()

        # Negatives go with their variable, so an Assembler that prints it
        # sends them to the negative prompt: each toggle's Negative while it
        # is on (its Off negative while off), and the pick's with the Pick one
        # variable.
        own_negs = {k: resolve_neg(v) for k, v in toggles.own_negatives(cfg).items()}
        neg_text = resolve_neg(toggles.picked_negative(cfg)) if group in values else ""

        upstream_debug: dict = upstream.debug if upstream is not None else {}
        upstream_internals: dict = upstream.internals if upstream is not None else {}
        hidden = getattr(cls, "hidden", None)
        node_id = getattr(hidden, "unique_id", None) if hidden is not None else None

        ctx: dict = dict(upstream_ctx)
        ctx.update(values)

        out_internals = dict(upstream_internals)
        # A write replaces a variable's negatives (send-to-negative rule).
        neg_table = out_internals.get(negatives.NEG_KEY)
        if isinstance(neg_table, dict) and any(k in neg_table for k in values):
            out_internals[negatives.NEG_KEY] = {
                k: v for k, v in neg_table.items() if k not in values
            }
        filed = {k: v for k, v in own_negs.items() if v}
        if neg_text:
            filed[group] = neg_text
        # A value that reads `$vars` carries their negatives (negatives
        # follow usage), then the toggle's own. In resolve order, so the pick
        # reading a toggle's value gets that toggle's negatives too.
        table = dict(out_internals.get(negatives.NEG_KEY) or {})
        for k, v in filed.items():
            if k not in value_reads:
                table[k] = [{"text": v, "pick": None, "source": "WP_Toggles"}]
        for k in value_order:
            entries = negatives.entries_for_reads(
                {negatives.NEG_KEY: table}, value_reads.get(k, []),
            )
            if filed.get(k):
                entries.append({"text": filed[k], "pick": None, "source": "WP_Toggles"})
            if entries:
                table[k] = entries
        if table or negatives.NEG_KEY in out_internals:
            out_internals[negatives.NEG_KEY] = table
        # `$name.bool` reads these, across nodes, whatever the variable holds.
        if on_off:
            out_internals[toggles.BOOLS_KEY] = {
                **(out_internals.get(toggles.BOOLS_KEY) or {}),
                **on_off,
            }
        # Each toggle chooses whether its variable shows in the Assembler
        # (`visible`); the Pick one variable shows with `group_visible`.
        hidden_vars = toggles.internal_vars(cfg)
        flags = dict(out_internals.get("__wp_internal_flags__") or {})
        for k in values:
            if k in hidden_vars:
                flags[k] = True
            else:
                flags.pop(k, None)
        if flags or "__wp_internal_flags__" in out_internals:
            out_internals["__wp_internal_flags__"] = flags
        details = _trace_details(cfg, values, group, raw_values, upstream_ctx)
        traces = [
            {
                "node": "WP_Toggles",
                "binding": name,
                "internal": name in hidden_vars,
                "type": "pick" if name == group else "toggle",
                "value": value,
                **({"bool": on_off[name]} if name in on_off and name != group else {}),
                **({"has_value": True} if name in valued and name != group else {}),
                **({"negative": filed[name]} if name in filed else {}),
                **({"source": "upstream"} if name in set_vars else {}),
                **({"detail": details[name]} if details.get(name) else {}),
            }
            for name, value in values.items()
        ]
        warnings = [
            {"type": "toggles_problem", "severity": "warn", "message": f"WP Toggles: {msg}"}
            for msg in toggles.problems(cfg)
        ]
        # What resolving the Pick one value found (a `$name` nothing sets …).
        warnings += [
            {**w, "message": f"WP Toggles value: {w.get('message', '')}"}
            for w in value_warnings if isinstance(w, dict)
        ]
        if cfg.mode == "one" and not cfg.forced and len(cfg.upstream_on) > 1:
            names = [t.name for t in cfg.toggles if t.id in cfg.upstream_on]
            warnings.append({
                "type": "toggles_upstream_many", "severity": "warn",
                "message": (
                    f"WP Toggles: upstream turned on {', '.join(names)}; "
                    f"Pick one took the first, {names[0]}"
                ),
            })

        debug = dict(upstream_debug)
        if node_id is not None:
            for row in traces + warnings:
                row["node_id"] = str(node_id)
        if traces:
            debug["__wp_trace__"] = list(debug.get("__wp_trace__", [])) + traces
        if warnings:
            debug["__wp_warnings__"] = list(debug.get("__wp_warnings__", [])) + warnings

        return io.NodeOutput(
            PipelineContext.Type(context=ctx, debug=debug, internals=out_internals),
            *toggles.output_values(cfg),
        )


def _trace_details(
    cfg: toggles.Config,
    values: dict[str, str],
    group: str,
    raw_values: dict[str, str],
    upstream_ctx: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """WP Debug: why each toggle ended up on or off, and how Pick one chose."""
    eff = toggles.effective(cfg)
    by_id = {t.id: t for t in cfg.toggles}
    out: dict[str, dict[str, Any]] = {}
    for t in cfg.toggles:
        if not t.var or t.var not in values:
            continue
        d: dict[str, Any] = {"switch": t.on}
        if raw_values.get(t.var, "") != values[t.var]:
            d["raw"] = raw_values.get(t.var, "")[:240]
        if t.upstream:
            raw = upstream_ctx.get(t.var)
            d["upstream_read"] = None if raw is None else str(raw)[:80]
        if cfg.mode == "any" and t.needs:
            parent = by_id.get(t.needs)
            d["needs"] = parent.name if parent else ""
            if t.on and not eff[t.id]:
                d["held_off"] = True
        out[t.var] = d
    if group and group in values:
        picked = next((t for t in cfg.toggles if eff.get(t.id)), None)
        d = {"picked": picked.name if picked else ""}
        if cfg.forced and cfg.forced in by_id:
            d["forced_by"] = str(upstream_ctx.get(group, ""))[:80]
        if cfg.upstream_on:
            d["upstream_on"] = [by_id[i].name for i in cfg.upstream_on if i in by_id]
        if raw_values.get(group, "") != values[group]:
            d["raw"] = raw_values.get(group, "")[:240]
        out[group] = d
    return out
