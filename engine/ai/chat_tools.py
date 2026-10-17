"""The chat's tools for everything past wildcards and rules.

A mixin for `chat.Library`: reading any item in full (with refs by name,
tag groups, negatives, per-use settings), fixed values, combines, prompt
templates, bundles, editing existing rules and constraints, and running a
stack on the engine (`run_test`) so the model can check what a change does
before the user applies it.

Every change tool returns a proposal dict the manager shows as a card;
nothing here writes. Payloads go through the same compilers the editor
panels and the pack builder use, and their engine handlers.
"""
from __future__ import annotations

import copy
import re
from typing import Any

from engine.ai import constraint as ai_constraint
from engine.ai import derivation as ai_derivation
from engine.ai import pack as ai_pack
from engine.ai import refs as ai_refs
from engine.ai import text_items
from engine.ai import use as ai_use
from engine.ai import wildcard as ai_wildcard
from engine.modules.constraint_handler import ConstraintHandler
from engine.modules.derivation_handler import DerivationHandler, clause_actions
from engine.modules.snapshot import payload_hash

MAX_READ_ROWS = 150
MAX_STACK = 40
MAX_SEEDS = 500
DEFAULT_SEEDS = 100
SAMPLES = 3
TOP_VALUES = 5
_REACH = re.compile(r"^(all|first|next)(?:\s+(\d+))?$")


def _short(text: Any, n: int) -> str:
    s = re.sub(r"\s+", " ", text).strip() if isinstance(text, str) else ""
    return s if len(s) <= n else s[: n - 1] + "…"


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def constraint_rows(p: dict[str, Any]) -> list[tuple[str, Any, Any, dict[str, Any]]]:
    """A constraint's rules in the order `read` numbers them: matrix cells
    (``("cell", src_tag, tgt_tag, cell)``), then exceptions
    (``("exception", index, None, exc)``)."""
    rows: list[tuple[str, Any, Any, dict[str, Any]]] = []
    matrix = p.get("matrix") if isinstance(p.get("matrix"), dict) else {}
    for src, row in matrix.items():
        if isinstance(row, dict):
            for tgt, cell in row.items():
                if isinstance(cell, dict) and cell.get("mode") not in (None, "allow"):
                    rows.append(("cell", src, tgt, cell))
    for i, e in enumerate(p.get("exceptions") or []):
        if isinstance(e, dict):
            rows.append(("exception", i, None, e))
    return rows


def _effect(rule: dict[str, Any]) -> str:
    mode = rule.get("mode", "")
    if mode in ("boost", "reduce") and isinstance(rule.get("factor"), (int, float)):
        return f"{mode} ×{rule['factor']}"
    return str(mode)


def _reach(raw: Any) -> dict[str, Any] | None:
    """``"all"`` / ``"first"`` / ``"next 2"`` → a ``target_select``."""
    if not isinstance(raw, str) or not raw.strip():
        return None
    m = _REACH.match(raw.strip().lower())
    if not m:
        raise ValueError("reach is all, first or next N")
    mode = m.group(1)
    if mode == "all":
        return {"mode": "all"}
    if mode == "first":
        return {"mode": "first"}
    return {"mode": "next", "count": max(1, min(20, int(m.group(2) or 1)))}


def _reach_text(sel: Any) -> str:
    if not isinstance(sel, dict) or sel.get("mode") in (None, "all"):
        return "every target after it"
    if sel["mode"] == "first":
        return "the first target after it"
    if sel["mode"] == "next":
        return f"the next {sel.get('count', 1)} targets after it"
    return "picked targets"


#: Words a model adds to an item's name when it names it ("Lighting
#: wildcard", "Frame Cues derivation"); `_find_loose` drops them.
_KIND_WORDS = {"wildcard", "wildcards", "derivation", "derivations", "constraint",
               "constraints", "bundle", "bundles", "template", "templates", "combine",
               "fixed", "values", "value", "module", "the", "card", "new"}


class MoreTools:
    """Mixed into `chat.Library` (which supplies modules, bundles,
    templates, `_module`, `_current`, `_meta`, `_name`, `catalog`)."""

    modules: dict[str, dict[str, Any]]
    bundles: dict[str, dict[str, Any]]
    templates: dict[str, dict[str, Any]]
    names: dict[str, str]

    # ── shared ───────────────────────────────────────────────────────────

    @property
    def refs(self) -> ai_refs.RefIndex:
        return ai_refs.RefIndex([m for m in self.modules.values()
                                 if m.get("type") == "wildcard"])

    def _show(self, text: Any) -> str:
        return ai_refs.display_text(text, self.refs)

    def _find(self, raw: Any, kinds: tuple[str, ...] = ()) -> dict[str, Any] | None:
        """An item by id, or by name when it is unique (case-insensitive)."""
        if not isinstance(raw, str) or not raw.strip():
            return None
        key = raw.strip()
        row = self.get(key)  # type: ignore[attr-defined]
        if row is None:
            low = key.lower().lstrip("$")
            pool = [*self.modules.values(), *self.bundles.values(), *self.templates.values()]
            hits = [r for r in pool if str(r.get("name") or "").lower() == low]
            if not hits:
                hits = [m for m in self.modules.values() if isinstance(m.get("payload"), dict)
                        and low in (m["payload"].get("var_binding"),
                                    m["payload"].get("output_var"))]
            if len(hits) > 1:
                # A name the library already has, just proposed again in
                # this answer ("Outfit"): the answer means its own card.
                made = getattr(self, "_created", {})
                hits = [r for r in hits if r.get("id") in made] or hits
            row = hits[0] if len(hits) == 1 else None
        if row is not None and kinds and self._kind(row) not in kinds:  # type: ignore
            return None
        return row

    def _find_loose(self, raw: Any) -> dict[str, Any] | None:
        """`_find`, plus the ways a model names a stack item for run_test:
        a chip (``id#Name``) or card id (``p4``), the name with its kind
        ("Sequence Frame Cue Derivation"), singular or plural, ``A → B`` for
        the constraint between two items, and the newest card when cards
        repeat a name."""
        if not isinstance(raw, str) or not raw.strip():
            return None
        row = self._find(raw)
        if row is None:
            row = self._find(self._bare_id(raw))  # type: ignore[attr-defined]
        if row is not None:
            return row
        pair = re.split(r"\s*(?:→|->|=>)\s*", raw.strip())
        if len(pair) == 2:
            a, b = (self._find_loose(x) for x in pair)
            if a is not None and b is not None:
                for m in reversed(list(self.modules.values())):
                    p = m.get("payload") if isinstance(m.get("payload"), dict) else {}
                    if m.get("type") == "constraint" and (p.get("source_wildcard_id"),
                                                          p.get("target_wildcard_id")) \
                            == (a["id"], b["id"]):
                        return m
            return None

        def norm(text: Any) -> str:
            words = re.findall(r"[a-z0-9]+", str(text or "").lower().lstrip("$"))
            words = [w for w in words if w not in _KIND_WORDS]
            return " ".join(w[:-1] if len(w) > 3 and w.endswith("s") else w for w in words)

        want = norm(raw)
        if not want:
            return None
        pool = [*self.modules.values(), *self.bundles.values(), *self.templates.values()]
        hits = [r for r in pool if norm(r.get("name")) == want]
        if len(hits) > 1:
            made = getattr(self, "_created", {})
            newest = [r for r in hits if r.get("id") in made]
            hits = newest[-1:] or hits
        return hits[0] if len(hits) == 1 else None

    def _used_by(self, mid: str) -> list[str]:
        out = []
        for m in self.modules.values():
            p = m.get("payload") if isinstance(m.get("payload"), dict) else {}
            if m.get("type") == "constraint":
                if p.get("source_wildcard_id") == mid:
                    out.append(f"constraint {m.get('name')} (source)")
                if p.get("target_wildcard_id") == mid:
                    out.append(f"constraint {m.get('name')} (target)")
            elif m["id"] != mid and f"@{{{mid}" in str(p):
                out.append(f"{m.get('type')} {m.get('name')} (points at it)")
        for b in self.bundles.values():
            if any(isinstance(c, dict) and c.get("id") == mid for c in b.get("children") or []):
                out.append(f"bundle {b.get('name')}")
        return out[:12]

    # ── read ─────────────────────────────────────────────────────────────

    def read_body(self, kind: str, r: dict[str, Any]) -> list[str]:
        p = r.get("payload") if isinstance(r.get("payload"), dict) else {}
        if kind == "wildcard":
            return self._read_wildcard(r, p)
        if kind == "fixed_values":
            vals = [v for v in p.get("values") or [] if isinstance(v, dict)]
            lines = [f"Values ({len(vals)}):"]
            for n, v in enumerate(vals, 1):
                line = f"{n}. ${v.get('name', '')} = {v.get('value', '')}"
                if v.get("negative"):
                    line += f"  (negative: {v['negative']})"
                lines.append(line)
            return lines
        if kind == "combine":
            lines = [f"Sets ${p.get('output_var', '')} = {p.get('template', '')}"]
            if p.get("negative"):
                lines.append(f"Negative: {p['negative']}")
            return lines
        if kind == "derivation":
            rules = [x for x in p.get("rules") or [] if isinstance(x, dict)]
            lines = [f"Rules ({len(rules)}, each runs on its own, top to bottom):"]
            lines += [f"{n}. {self._show(ai_derivation.describe_rule(x))}"
                      for n, x in enumerate(rules, 1)]
            return lines
        if kind == "constraint":
            src = self.names.get(str(p.get("source_wildcard_id")), "?")
            tgt = self.names.get(str(p.get("target_wildcard_id")), "?")
            lines = [f"Source: {src} ({p.get('source_wildcard_id')}). Target: {tgt} "
                     f"({p.get('target_wildcard_id')}).",
                     f"Reaches {_reach_text(p.get('target_select'))}."]
            rows = constraint_rows(p)
            lines.append(f"Rules ({len(rows)}):")
            for n, (what, a, b, rule) in enumerate(rows, 1):
                if what == "cell":
                    lines.append(f"{n}. #{a} → #{b}: {_effect(rule)}")
                else:
                    lines.append(f"{n}. {rule.get('source')} → {rule.get('target')}: "
                                 f"{_effect(rule)} (one option pair)")
            return lines
        if kind == "bundle":
            kids = [c for c in r.get("children") or [] if isinstance(c, dict)]
            lines = [f"Runs in this order ({len(kids)}):"]
            for n, c in enumerate(kids, 1):
                meta = c.get("meta") if isinstance(c.get("meta"), dict) else {}
                inner = self.get(c.get("id")) if c.get("type") == "bundle" else None  # type: ignore
                cname = meta.get("name") or self.names.get(str(c.get("id")), "") \
                    or (inner or {}).get("name") or c.get("id")
                line = f"{n}. {c.get('type')} {cname}"
                if inner is not None:
                    line += f" [[{c.get('id')}#{cname}]] (sub-bundle)"
                use = ai_use.describe(c.get("instance"), c.get("payload")
                                      if isinstance(c.get("payload"), dict) else None)
                if use:
                    line += f"  [use: {use}]"
                if c.get("enabled") is False:
                    line += "  (off)"
                lines.append(line)
                for g in (inner or {}).get("children") or []:
                    if isinstance(g, dict):
                        gm = g.get("meta") if isinstance(g.get("meta"), dict) else {}
                        gname = gm.get("name") or self.names.get(str(g.get("id")), "") \
                            or g.get("id")
                        lines.append(f"   - {g.get('type')} {gname}"
                                     + ("  (off)" if g.get("enabled") is False else ""))
            return lines
        if kind == "template":
            lines = [f"Template: {r.get('template_string') or ''}"]
            neg = r.get("negative_template")
            lines.append(f"Negative: {neg}" if neg else "Negative: (none: just the "
                         "negatives of what the prompt used)")
            return lines
        return []

    def _read_wildcard(self, r: dict[str, Any], p: dict[str, Any]) -> list[str]:
        lines = []
        var = p.get("var_binding")
        lines.append(f"Variable: ${var}" if var else
                     f"Variable: none (a vocabulary: options elsewhere point at it with "
                     f"@{{{r.get('name')}}})")
        groups = p.get("tag_groups") if isinstance(p.get("tag_groups"), dict) else {}
        kinds = p.get("tag_group_kinds") if isinstance(p.get("tag_group_kinds"), dict) else {}
        grouped: set[str] = set()
        for g, members in groups.items():
            kind = kinds.get(g, "classify")
            how = f"accepts; read ${var}.{g}" if kind == "accepts" and var else kind
            lines.append(f"Tag group {g} ({how}): {', '.join(members)}")
            grouped.update(members)
        loose = [t for t in p.get("sub_categories") or [] if t not in grouped]
        lines.append(f"{'Other tags' if groups else 'Option tags'}: "
                     f"{', '.join(loose) or '(none)'}")
        used = self._used_by(r["id"])
        if used:
            lines.append("Used by: " + "; ".join(used))
        opts = [o for o in p.get("options") or [] if isinstance(o, dict)]
        lines.append(f"Options ({len(opts)}):")
        refs = self.refs
        for n, o in enumerate(opts[:MAX_READ_ROWS], start=1):
            lines.append(f"{n}. {ai_wildcard.option_line(o, refs)}")
        if len(opts) > MAX_READ_ROWS:
            lines.append(f"- … {len(opts) - MAX_READ_ROWS} more")
        return lines

    # ── fixed values ─────────────────────────────────────────────────────

    def create_fixed_values(self, args: dict[str, Any]) -> dict[str, Any]:
        name = self._name(args, "")  # type: ignore[attr-defined]
        if not name:
            raise ValueError("give the fixed values a name")
        out = text_items.compile_fixed({"values": args.get("values") or []})
        meta = self._meta(args)  # type: ignore[attr-defined]
        clash = [v["name"] for v in out["payload"]["values"] if v["name"] in self.catalog]  # type: ignore[attr-defined]
        warnings = [self.var_clash(n) for n in clash[:4]]  # type: ignore[attr-defined]
        return {
            "title": f"Create fixed values {name}",
            "summary": _plural(len(out["payload"]["values"]), "value"),
            "preview": out["preview"], "warnings": warnings + out["warnings"],
            "op": {"op": "create", "kind": "module", "new_category": meta["new_category"],
                   "body": {"type": "fixed_values", "name": name, **meta["body"],
                            "payload": out["payload"]}},
        }

    def edit_values(self, args: dict[str, Any]) -> dict[str, Any]:
        r = self._module(args, "fixed_values")  # type: ignore[attr-defined]
        old = r.get("payload") if isinstance(r.get("payload"), dict) else {}
        payload = copy.deepcopy(old)
        preview: list[str] = []
        warnings: list[str] = []
        if args.get("set"):
            out = text_items.compile_fixed({"values": args["set"]}, existing=payload)
            payload, preview, warnings = out["payload"], out["preview"], out["warnings"]
        for x in args.get("rename") or []:
            frm = _short(x.get("from"), 64).lstrip("$") if isinstance(x, dict) else ""
            to = _short(x.get("to"), 64).lstrip("$") if isinstance(x, dict) else ""
            row = next((v for v in payload.get("values") or [] if v.get("name") == frm), None)
            if row is None or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", to):
                warnings.append(f"Left out rename {frm or '?'} → {to or '?'}: "
                                + ("no such value" if row is None else "not a variable name"))
                continue
            if frm == to:
                continue
            row["name"] = to
            preview.append(f"${frm} → ${to}")
            warnings += self._rename_notes(frm, to, r["id"])
        drop = {str(n).lstrip("$") for n in args.get("remove") or [] if isinstance(n, str)}
        if drop:
            kept = [v for v in payload.get("values") or [] if v.get("name") not in drop]
            gone = len(payload.get("values") or []) - len(kept)
            payload["values"] = kept
            preview += [f"− ${n}" for n in sorted(drop)][:gone]
        if not preview:
            raise ValueError("that changes nothing")
        return self._update(r, old, payload, f"Change {r.get('name')}", preview, warnings,
                            "fixed_values")

    # ── combine ──────────────────────────────────────────────────────────

    def create_combine(self, args: dict[str, Any]) -> dict[str, Any]:
        name = self._name(args, "")  # type: ignore[attr-defined]
        var = _short(args.get("var"), 64).lstrip("$")
        if not name or not var:
            raise ValueError("give the combine a name and the variable it sets")
        cat = dict(self.catalog)  # type: ignore[attr-defined]
        out = text_items.compile_combine(args, out_var=var, catalog=cat)
        meta = self._meta(args)  # type: ignore[attr-defined]
        warnings = list(out["warnings"])
        if var in cat:
            warnings.insert(0, self.var_clash(var))  # type: ignore[attr-defined]
        return {
            "title": f"Create combine {name}", "summary": f"sets ${var}",
            "preview": out["preview"], "warnings": warnings,
            "op": {"op": "create", "kind": "module", "new_category": meta["new_category"],
                   "body": {"type": "combine", "name": name, **meta["body"],
                            "payload": out["payload"]}},
        }

    def edit_combine(self, args: dict[str, Any]) -> dict[str, Any]:
        r = self._module(args, "combine")  # type: ignore[attr-defined]
        old = r.get("payload") if isinstance(r.get("payload"), dict) else {}
        raw = {"template": args["template"] if isinstance(args.get("template"), str)
               else old.get("template", ""),
               "negative": args["negative"] if isinstance(args.get("negative"), str)
               else old.get("negative", "")}
        was = str(old.get("output_var") or "")
        var = _short(args.get("var"), 64).lstrip("$") or was
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", var):
            raise ValueError(f"${var} isn't a variable name (letters, digits, _)")
        out = text_items.compile_combine(raw, out_var=var,
                                         catalog=self.catalog, existing=old)  # type: ignore
        if out["payload"] == old:
            raise ValueError("that changes nothing")
        preview, warnings = list(out["preview"]), list(out["warnings"])
        if var != was:
            preview.insert(0, f"Sets ${var}" + (f" instead of ${was}" if was else ""))
            warnings += self._rename_notes(was, var, r["id"])
        return self._update(r, old, out["payload"], f"Change {r.get('name')}", preview,
                            warnings, "combine")

    def _rename_notes(self, was: str, var: str, self_id: str) -> list[str]:
        """Warnings for a module that now sets ``$var`` instead of ``$was``."""
        notes = []
        clash = self.var_clash(var)  # type: ignore[attr-defined]
        if clash:
            notes.append(clash)
        readers = [x for x in self.readers(was) if x.get("id") != self_id] if was \
            else []  # type: ignore[attr-defined]
        if readers:
            notes.append(f"Still read as ${was} by "
                         + ", ".join(self._chip(x) for x in readers[:6])  # type: ignore
                         + ": change them too (or they get nothing)")
        return notes

    # ── templates ────────────────────────────────────────────────────────

    def create_template(self, args: dict[str, Any]) -> dict[str, Any]:
        name = self._name(args, "")  # type: ignore[attr-defined]
        if not name:
            raise ValueError("give the template a name")
        out = text_items.compile_template(args, catalog=self.catalog)  # type: ignore
        meta = self._meta(args)  # type: ignore[attr-defined]
        return {
            "title": f"Create template {name}", "summary": "prompt template",
            "preview": out["preview"], "warnings": out["warnings"],
            "op": {"op": "create", "kind": "template", "new_category": meta["new_category"],
                   "body": {"name": name, "description": meta["body"]["description"],
                            "tags": meta["body"]["tags"],
                            **({"category_id": meta["body"]["category_id"]}
                               if meta["body"]["category_id"] else {}),
                            **out["payload"]}},
        }

    def edit_template(self, args: dict[str, Any]) -> dict[str, Any]:
        r = self.templates.get(args.get("id")) if isinstance(args.get("id"), str) else None
        if r is None:
            raise ValueError(f"no template with id {_short(args.get('id'), 20)!r}")
        r = self._current(r["id"])[0] or r  # type: ignore[attr-defined]
        raw = {"template": args["template"] if isinstance(args.get("template"), str)
               else r.get("template_string") or "",
               "negative": args["negative"] if isinstance(args.get("negative"), str)
               else r.get("negative_template") or ""}
        out = text_items.compile_template(raw, catalog=self.catalog)  # type: ignore
        before = {"template_string": r.get("template_string") or "",
                  "negative_template": r.get("negative_template") or ""}
        if out["payload"] == before:
            raise ValueError("that changes nothing")
        return {
            "title": f"Change template {r.get('name')}", "summary": "prompt template",
            "preview": out["preview"], "warnings": out["warnings"],
            "op": {"op": "update", "kind": "template", "type": "template", "id": r["id"],
                   "name": r.get("name"), "body": out["payload"], "before": before},
        }

    # ── derivation rules ─────────────────────────────────────────────────

    def edit_rules(self, args: dict[str, Any]) -> dict[str, Any]:
        r = self._module(args, "derivation")  # type: ignore[attr-defined]
        old = r.get("payload") if isinstance(r.get("payload"), dict) else {}
        rules = [copy.deepcopy(x) for x in old.get("rules") or [] if isinstance(x, dict)]
        preview: list[str] = []
        warnings: list[str] = []
        for x in args.get("replace") or []:
            if not isinstance(x, dict):
                continue
            n = _num(x.get("n"), len(rules))
            if n is None:
                warnings.append(f"Left out rule {x.get('n')}: no such rule")
                continue
            compiled = ai_derivation.compile_rules(
                {"rules": [x.get("rule")]}, catalog=self.catalog,  # type: ignore
                refs=self.refs, taken_ids={y.get("id") for y in rules})
            if not compiled["rules"]:
                warnings += [f"Left out rule {n}: {s['reason']}" for s in compiled["skipped"]]
                continue
            new = {**compiled["rules"][0]["rule"], "id": rules[n - 1].get("id")}
            preview.append(f"{n}. {self._show(ai_derivation.describe_rule(rules[n - 1]))} → "
                           f"{self._show(ai_derivation.describe_rule(new))}")
            warnings += compiled["rules"][0]["warnings"]
            rules[n - 1] = new
        gone = {n for n in (_num(v, len(rules)) for v in args.get("remove") or []) if n}
        for n in sorted(gone):
            preview.append(f"− {n}. {self._show(ai_derivation.describe_rule(rules[n - 1]))}")
        # Moves name rules by the numbers read showed; rules run top to bottom.
        order = list(range(1, len(rules) + 1))
        for x in args.get("move") or []:
            if not isinstance(x, dict):
                continue
            n, to = _num(x.get("n"), len(rules)), _num(x.get("to"), len(rules))
            if n is None or to is None or n == to or n in gone:
                continue
            order.remove(n)
            order.insert(to - 1, n)
            preview.append(f"Move rule {n} to place {to}")
        rules = [rules[i - 1] for i in order if i not in gone]
        if not preview:
            raise ValueError("that changes nothing" + "".join(f"; {w}" for w in warnings[:3]))
        payload = {**copy.deepcopy(old), "rules": rules}
        DerivationHandler.validate_payload(payload)
        return self._update(r, old, payload, f"Change rules in {r.get('name')}", preview,
                            list(dict.fromkeys(warnings)), "derivation")

    # ── constraints ──────────────────────────────────────────────────────

    @staticmethod
    def _refit(payload: dict[str, Any], src: dict[str, Any], tgt: dict[str, Any],
               preview: list[str]) -> list[str]:
        """After a side changed: drop the rules that name tags or options the
        new wildcard doesn't have."""
        def tags(w: dict[str, Any]) -> set[str]:
            return set((w.get("payload") or {}).get("sub_categories") or [])

        def values(w: dict[str, Any]) -> set[str]:
            return {str(o.get("value") or "") for o in (w.get("payload") or {}).get("options")
                    or [] if isinstance(o, dict)}
        dropped = 0
        matrix = {}
        for a, row in (payload.get("matrix") or {}).items():
            if a not in tags(src) or not isinstance(row, dict):
                dropped += len(row) if isinstance(row, dict) else 1
                continue
            kept = {b: c for b, c in row.items() if b in tags(tgt)}
            dropped += len(row) - len(kept)
            if kept:
                matrix[a] = kept
        payload["matrix"] = matrix
        excs = [e for e in payload.get("exceptions") or [] if isinstance(e, dict)
                and str(e.get("source") or "") in values(src)
                and str(e.get("target") or "") in values(tgt)]
        dropped += len(payload.get("exceptions") or []) - len(excs)
        payload["exceptions"] = excs
        if dropped:
            preview.append(f"− {dropped} rule{'s' if dropped != 1 else ''} the new wildcard "
                           "can't match")
            return [f"{dropped} rule{'s' if dropped != 1 else ''} named tags or options the new "
                    "wildcard doesn't have, so they're dropped; add rules for it"]
        return []

    def edit_constraint(self, args: dict[str, Any]) -> dict[str, Any]:
        r = self._module(args, "constraint")  # type: ignore[attr-defined]
        old = r.get("payload") if isinstance(r.get("payload"), dict) else {}
        payload = copy.deepcopy(old)
        preview: list[str] = []
        warnings: list[str] = []
        for key, side in (("source_id", "source_wildcard_id"), ("target_id", "target_wildcard_id")):
            if not args.get(key) or args[key] == old.get(side):
                continue
            row = self._current(args[key])[0]  # type: ignore[attr-defined]
            if row is None or row.get("type") != "wildcard":
                raise ValueError(f"{key}: no wildcard {_short(args[key], 40)!r}")
            payload[side] = row["id"]
            preview.append(f"{'Source' if key == 'source_id' else 'Target'}: "
                           f"{self._chip(row)}")  # type: ignore[attr-defined]
        if payload["source_wildcard_id"] == payload["target_wildcard_id"]:
            raise ValueError("the source and target must be different wildcards")
        src = self._current(str(payload.get("source_wildcard_id")))[0]  # type: ignore
        tgt = self._current(str(payload.get("target_wildcard_id")))[0]  # type: ignore
        if src is None or tgt is None:
            raise ValueError("one of its wildcards isn't in the library any more")
        if preview:
            warnings += self._refit(payload, src, tgt, preview)
        rows = constraint_rows(payload)
        gone = {n for n in (_num(v, len(rows)) for v in args.get("remove") or []) if n}
        drop_exc = set()
        for n in sorted(gone):
            what, a, b, rule = rows[n - 1]
            if what == "cell":
                payload["matrix"][a].pop(b, None)
                if not payload["matrix"][a]:
                    payload["matrix"].pop(a)
                preview.append(f"− #{a} → #{b}: {_effect(rule)}")
            else:
                drop_exc.add(a)
                preview.append(f"− {rule.get('source')} → {rule.get('target')}: {_effect(rule)}")
        if drop_exc:
            payload["exceptions"] = [e for i, e in enumerate(payload.get("exceptions") or [])
                                     if i not in drop_exc]
        if args.get("rules"):
            source = ai_constraint.side_view(self._current(src["id"])[0] or src, "S")  # type: ignore
            target = ai_constraint.side_view(self._current(tgt["id"])[0] or tgt, "T")  # type: ignore
            compiled = ai_constraint.compile_rules(
                {"rules": args["rules"]}, source=source, target=target, existing=payload)
            for c in compiled["cells"]:
                payload.setdefault("matrix", {}).setdefault(c["source_tag"], {})[
                    c["target_tag"]] = c["cell"]
                preview.append(f"#{c['source_tag']} → #{c['target_tag']}: {_effect(c['cell'])}"
                               + (" (replaces)" if c["replaces"] else ""))
            excs = list(payload.get("exceptions") or [])
            for e in compiled["exceptions"]:
                pair = (e["exception"]["source"], e["exception"]["target"])
                excs = [x for x in excs if (x.get("source"), x.get("target")) != pair]
                excs.append(e["exception"])
                preview.append(f"{pair[0]} → {pair[1]}: {_effect(e['exception'])}")
            payload["exceptions"] = excs
            warnings += [f"Left out {s['text'][:50]}: {s['reason']}" for s in compiled["skipped"]]
        if "reach" in args:
            sel = _reach(args.get("reach"))
            if sel and sel != (old.get("target_select") or {"mode": "all"}):
                if sel["mode"] == "all":
                    payload.pop("target_select", None)
                else:
                    payload["target_select"] = sel
                preview.append(f"Reaches {_reach_text(sel)}")
        if not preview:
            raise ValueError("that changes nothing")
        ConstraintHandler.validate_payload(payload)
        return self._update(r, old, payload, f"Change {r.get('name')}", preview, warnings,
                            "constraint")

    # ── bundles ──────────────────────────────────────────────────────────

    def _child(self, raw: Any, warnings: list[str],
               host: dict[str, Any] | None = None) -> dict[str, Any] | None:
        """A stack/bundle entry: ``"name or id"`` or ``{"item", "use"}``.
        ``host`` is the bundle it goes into (bundles nest one level)."""
        ref, use = (raw.get("item") or raw.get("id"), raw.get("use")) \
            if isinstance(raw, dict) else (raw, "")
        row = self._find(ref)
        if row is None:
            warnings.append(f"Left out {_short(ref, 40) or 'an item'}: not in the library "
                            "(or more than one item has that name; use its id)")
            return None
        row = self._current(row["id"])[0] or row  # type: ignore[attr-defined]
        kind = self._kind(row)  # type: ignore[attr-defined]
        if kind == "template":
            warnings.append(f"Left out {row.get('name')}: a template isn't part of a stack")
            return None
        if kind == "bundle":
            why = self._nest_refusal(row, host)
            if why:
                warnings.append(f"Left out {row.get('name')}: {why}")
                return None
            return {"id": row["id"], "type": "bundle", "enabled": True, "name": row.get("name")}
        p = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        inst, notes = ai_use.parse_use(use, kind=kind, tags=p.get("sub_categories")
                                       if kind == "wildcard" else None, payload=p)
        warnings += [f"{row.get('name')}: {n}" for n in notes]
        return {
            "id": row["id"], "type": kind, "enabled": True, "collapsed": False,
            "meta": {"name": row.get("name"), "library_name": row.get("name")},
            "payload": copy.deepcopy(p), "payload_hash": payload_hash(p),
            "instance": inst, "entries": [], "name": row.get("name"),
        }

    def _nest_refusal(self, inner: dict[str, Any], host: dict[str, Any] | None) -> str:
        """Why ``inner`` can't be a sub-bundle of ``host`` (one level only,
        the rule `wp_api/bundles.py` enforces on save), else ""."""
        if host is not None and inner.get("id") == host.get("id"):
            return "a bundle can't hold itself"
        if any(isinstance(c, dict) and c.get("type") == "bundle"
               for c in inner.get("children") or []):
            return ("it holds bundles itself, and bundles nest one level only; add its "
                    "items instead")
        if host is not None and any(
                isinstance(c, dict) and c.get("type") == "bundle" and c.get("id") == host.get("id")
                for b in self.bundles.values() for c in b.get("children") or []):  # type: ignore
            return (f"{host.get('name')} is already inside another bundle, so it can't hold "
                    "bundles (one level only)")
        return ""

    def _order(self, kids: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Producers first, a constraint between its source and target,
        derivations after the picks, combines last (the pack's order)."""
        plan_items = []
        for n, c in enumerate(kids):
            p = c.get("payload") or {}
            item = {"key": f"i{n + 1}", "kind": c["type"], "var": "", "source": "", "target": ""}
            if c["type"] == "wildcard":
                item["var"] = (c.get("instance") or {}).get("variable_binding") \
                    or p.get("var_binding") or f"__vocab{n}"
            elif c["type"] in ("combine", "fixed_values", "derivation"):
                item["var"] = p.get("output_var") or ""
            elif c["type"] == "constraint":
                byid = {k.get("id"): k for k in kids if k["type"] == "wildcard"}
                s, t = byid.get(p.get("source_wildcard_id")), byid.get(p.get("target_wildcard_id"))
                if s is None or t is None:
                    item["kind"] = "derivation"  # unknown edges: keep it with the rules
                else:
                    item["source"] = (s.get("payload") or {}).get("var_binding") or ""
                    item["target"] = (t.get("payload") or {}).get("var_binding") or ""
            plan_items.append(item)
        plan = {"items": [i for i in plan_items if i["kind"] != "bundle"]}
        built = {i["key"]: {"payload": kids[n].get("payload") or {}}
                 for n, i in enumerate(plan_items)}
        try:
            order = ai_pack.chain_order(plan, built)
        except KeyError:
            return kids
        by_key = {i["key"]: kids[n] for n, i in enumerate(plan_items)}
        out = [by_key[k] for k in order if k in by_key]
        # Sub-bundles stay where they were given: what they set, the items
        # after them may read.
        for n, c in enumerate(kids):
            if c["type"] == "bundle":
                out.insert(min(n, len(out)), c)
        return out

    def create_bundle(self, args: dict[str, Any]) -> dict[str, Any]:
        name = self._name(args, "")  # type: ignore[attr-defined]
        if not name:
            raise ValueError("give the bundle a name")
        warnings: list[str] = []
        kids = [k for k in (self._child(x, warnings) for x in (args.get("items") or [])
                            [:MAX_STACK]) if k]
        if not kids:
            raise ValueError("no items to bundle" + "".join(f"; {w}" for w in warnings[:3]))
        if args.get("order") != "as_given":
            kids = self._order(kids)
        meta = self._meta(args)  # type: ignore[attr-defined]
        return {
            "title": f"Create bundle {name}",
            "summary": _plural(len(kids), "item"),
            "preview": [self._kid_line(n, k) for n, k in enumerate(kids, 1)],
            "warnings": warnings,
            "op": {"op": "create", "kind": "bundle", "new_category": "",
                   "body": {"name": name, "description": meta["body"]["description"],
                            "tags": meta["body"]["tags"],
                            "children": [self._stored(k) for k in kids]}},
        }

    @staticmethod
    def _stored(k: dict[str, Any]) -> dict[str, Any]:
        if k["type"] == "bundle":
            return {"id": k["id"], "type": "bundle", "enabled": k.get("enabled", True)}
        return {key: v for key, v in k.items() if key != "name"}

    @staticmethod
    def _kid_line(n: int, k: dict[str, Any]) -> str:
        meta = k.get("meta") if isinstance(k.get("meta"), dict) else {}
        line = f"{n}. {k['type']} {k.get('name') or meta.get('name') or k['id']}"
        use = ai_use.describe(k.get("instance"), k.get("payload")
                              if isinstance(k.get("payload"), dict) else None)
        return line + (f"  [use: {use}]" if use else "")

    def edit_bundle(self, args: dict[str, Any]) -> dict[str, Any]:
        r = self._current(args.get("id"))[0] if isinstance(args.get("id"), str) else None  # type: ignore
        if r is None or r.get("id") not in self.bundles:
            raise ValueError(f"no bundle with id {_short(args.get('id'), 20)!r}")
        old = [copy.deepcopy(c) for c in r.get("children") or [] if isinstance(c, dict)]
        kids = copy.deepcopy(old)
        warnings: list[str] = []
        preview: list[str] = []
        for x in args.get("use") or []:
            if not isinstance(x, dict):
                continue
            n = _num(x.get("n"), len(kids))
            if n is None or kids[n - 1].get("type") == "bundle":
                warnings.append(f"Left out use for {x.get('n')}: not a module in the bundle")
                continue
            k = kids[n - 1]
            p = k.get("payload") if isinstance(k.get("payload"), dict) else {}
            inst, notes = ai_use.parse_use(x.get("use"), kind=k["type"],
                                           tags=p.get("sub_categories")
                                           if k["type"] == "wildcard" else None,
                                           payload=p)
            warnings += notes
            keep = {key: v for key, v in (k.get("instance") or {}).items()
                    if key not in _USE_KEYS}
            k["instance"] = {**keep, **inst}
            preview.append(self._kid_line(n, {**k, "name": (k.get("meta") or {}).get("name")}))
        for key, on in (("off", False), ("on", True)):
            for v in args.get(key) or []:
                n = _num(v, len(kids))
                if n is None:
                    warnings.append(f"Left out {key} {_short(v, 10)}: no item {_short(v, 10)}")
                    continue
                if (kids[n - 1].get("enabled") is not False) != on:
                    kids[n - 1]["enabled"] = on
                    meta = kids[n - 1].get("meta") or {}
                    cname = meta.get("name") or self.names.get(str(kids[n - 1].get("id")), "") \
                        or kids[n - 1].get("id")
                    preview.append(f"{'Off' if not on else 'On'}: {kids[n - 1].get('type')} "
                                   f"{cname}")
        gone = {n for n in (_num(v, len(kids)) for v in args.get("remove") or []) if n}
        for n in sorted(gone):
            meta = kids[n - 1].get("meta") or {}
            preview.append(f"− {kids[n - 1].get('type')} "
                           f"{meta.get('name') or self.names.get(str(kids[n - 1].get('id')), '')}")
        kids = [k for i, k in enumerate(kids, 1) if i not in gone]
        added = [k for k in (self._child(x, warnings, r) for x in args.get("add") or []) if k]
        for k in added:
            preview.append(f"+ {self._kid_line(len(kids) + 1, k)[3:]}")
        kids += added
        if added and args.get("order") != "as_given":
            kids = self._order(kids)
        if not preview:
            raise ValueError("that changes nothing" + "".join(f"; {w}" for w in warnings[:3]))
        return {
            "title": f"Change bundle {r.get('name')}",
            "summary": f"{len(old)} → {_plural(len(kids), 'item')}",
            "preview": preview, "warnings": warnings,
            "op": {"op": "update", "kind": "bundle", "type": "bundle", "id": r["id"],
                   "name": r.get("name"), "body": {"children": [self._stored(k) for k in kids]},
                   "before": {"children": old}},
        }

    # ── shared update proposal ───────────────────────────────────────────

    def _update(self, r: dict[str, Any], old: dict[str, Any], payload: dict[str, Any],
                title: str, preview: list[str], warnings: list[str],
                type_: str) -> dict[str, Any]:
        return {
            "title": title, "summary": type_.replace("_", " "),
            "preview": [self._show(x) for x in preview], "warnings": warnings,
            "op": {"op": "update", "kind": "module", "type": type_, "id": r["id"],
                   "name": r.get("name"), "body": {"payload": payload},
                   "before": {"payload": old}},
        }

    # ── run_test ─────────────────────────────────────────────────────────

    def with_needs(self, ids: list[str]) -> tuple[list[str], list[str]]:
        """A stack's ids with what its constraints need added in run order: a
        constraint without its source wildcard before it, or its target
        after it, does nothing. A wildcard inside a bundle on the stack
        counts as there. Returns (ids, notes for the model)."""
        out = list(ids)
        notes: list[str] = []

        def present(mid: str) -> bool:
            return mid in out or any(
                any(isinstance(c, dict) and c.get("id") == mid
                    for c in (self.bundles.get(b) or {}).get("children") or [])
                for b in out if b in self.bundles)

        for cid in list(ids):
            row = self.modules.get(cid)
            if not row or row.get("type") != "constraint":
                continue
            p = row.get("payload") if isinstance(row.get("payload"), dict) else {}
            src = str(p.get("source_wildcard_id") or "")
            tgt = str(p.get("target_wildcard_id") or "")
            added = []
            if src in self.modules and not present(src):
                out.insert(out.index(cid), src)
                added.append(self.names.get(src, src))
            if tgt in self.modules and not present(tgt):
                out.insert(out.index(cid) + 1, tgt)
                added.append(self.names.get(tgt, tgt))
            elif tgt in out and out.index(tgt) < out.index(cid):
                # Already there but runs first: the constraint moves ahead of it.
                out.remove(cid)
                out.insert(out.index(tgt), cid)
                notes.append(f"moved {row.get('name')} before its target "
                             f"{self.names.get(tgt, tgt)}")
            if added:
                notes.append(f"added {' and '.join(added)} for {row.get('name')} (a constraint "
                             "needs its source before it and its target after it)")
        return out, notes

    def _stack_needs(self, args: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
        """`args` with the stack's constraint wildcards added (`with_needs`)."""
        raw = args.get("stack")
        if not isinstance(raw, list):
            return args, []
        by_id: dict[str, Any] = {}
        rest: list[Any] = []
        for x in raw:
            row = self._find_loose(x.get("item") or x.get("id") if isinstance(x, dict) else x)
            if row is None or row["id"] in by_id:
                rest.append(x)
            else:
                by_id[row["id"]] = x
        ids, notes = self.with_needs(list(by_id))
        if not notes:
            return args, []
        return {**args, "stack": [by_id.get(i, i) for i in ids] + rest}, notes

    def _stack(self, raw: Any, proposed: bool) -> tuple[list[dict[str, Any]], list[str]]:
        warnings: list[str] = []
        modules: list[dict[str, Any]] = []
        get = (lambda i: self._current(i)[0]) if proposed else self.get  # type: ignore
        for i, x in enumerate((raw if isinstance(raw, list) else [])[:MAX_STACK]):
            ref, use = (x.get("item") or x.get("id"), x.get("use")) if isinstance(x, dict) \
                else (x, "")
            found = self._find_loose(ref)
            row = get(found["id"]) if found else None
            if row is not None and row.get("_proposed") and not proposed:
                continue  # new in this answer: only in the "now" run
            if row is None:
                warnings.append(f"Left out {_short(ref, 40)}: not in the library")
                continue
            kind = self._kind(row)  # type: ignore[attr-defined]
            if kind == "template":
                warnings.append(f"{row.get('name')} is a template; pass it as template")
                continue
            uid = f"s{i}"
            if kind == "bundle":
                modules += self._expand(row, uid, get)
                continue
            p = row.get("payload") if isinstance(row.get("payload"), dict) else {}
            inst, notes = ai_use.parse_use(use, kind=kind, tags=p.get("sub_categories")
                                           if kind == "wildcard" else None, payload=p)
            warnings += notes
            raw_inst = x.get("instance") if isinstance(x, dict) else None
            if isinstance(raw_inst, dict):
                # A Test Runner stack item's own settings, passed through.
                inst = {**{k: v for k, v in raw_inst.items() if isinstance(k, str)}, **inst}
            modules.append(self._entry(row, uid, inst))
        return modules, warnings

    @staticmethod
    def _entry(row: dict[str, Any], uid: str, inst: dict[str, Any],
               origin: str | None = None) -> dict[str, Any]:
        e = {"id": row["id"], "_uid": uid, "type": row.get("type"), "enabled": True,
             "name": row.get("name", ""), "meta": {"name": row.get("name", "")},
             "payload": copy.deepcopy(row.get("payload") or {}),
             "payload_hash": payload_hash(row.get("payload") or {}), "instance": inst}
        if origin:
            e["bundle_origin"] = origin
        return e

    def _expand(self, bundle: dict[str, Any], uid: str, get: Any) -> list[dict[str, Any]]:
        out = []
        for j, c in enumerate(bundle.get("children") or []):
            if not isinstance(c, dict) or c.get("enabled") is False:
                continue
            if c.get("type") == "bundle":
                inner = get(c.get("id"))
                if inner and inner.get("id") in self.bundles:
                    for k, g in enumerate(inner.get("children") or []):
                        if isinstance(g, dict) and g.get("type") != "bundle" \
                                and g.get("enabled") is not False:
                            out.append(self._kid_entry(g, f"{uid}.{j}.{k}", f"{uid}.{j}"))
                continue
            out.append(self._kid_entry(c, f"{uid}.{j}", uid))
        return out

    def _kid_entry(self, c: dict[str, Any], uid: str, origin: str) -> dict[str, Any]:
        meta = c.get("meta") if isinstance(c.get("meta"), dict) else {}
        row = {"id": c.get("id"), "type": c.get("type"), "payload": c.get("payload") or {},
               "name": meta.get("name") or self.names.get(str(c.get("id")), "")}
        return self._entry(row, uid, dict(c.get("instance") or {}), origin)

    def _run(self, modules: list[dict[str, Any]], pins: dict[str, str], seeds: int,
             template: dict[str, Any] | None) -> dict[str, Any]:
        from engine.pipeline import PipelineEngine
        from engine.scenario import run_scenario

        rows = [m for m in self.modules.values() if m.get("type") == "wildcard"]
        rows += [m for m in modules if m.get("type") == "wildcard"]
        catalog = ai_pack.ref_catalog(modules, rows)
        seed_list = list(range(1, seeds + 1))
        report = run_scenario(modules, seeds=seed_list, catalog=catalog, pins=pins,
                              sample_limit=0, value_limit=TOP_VALUES)
        report["prompts"] = []
        if template is not None:
            for seed in seed_list[:SAMPLES]:
                try:
                    ctx = PipelineEngine().run(copy.deepcopy(modules),
                                               ctx={**pins, "__wp_catalog__": catalog}, seed=seed)
                    report["prompts"].append(ai_pack.render(
                        template.get("template_string") or "",
                        template.get("negative_template") or "", ctx))
                except Exception as exc:  # noqa: BLE001 - shown, not raised
                    report["prompts"].append((f"(failed: {exc})", ""))
        return report

    def run_test(self, args: dict[str, Any]) -> str:
        seeds = args.get("seeds", DEFAULT_SEEDS)
        seeds = max(1, min(MAX_SEEDS, int(seeds))) if isinstance(seeds, (int, float)) \
            and not isinstance(seeds, bool) else DEFAULT_SEEDS
        pins = {str(k).lstrip("$"): str(v) for k, v in (args.get("pins") or {}).items()} \
            if isinstance(args.get("pins"), dict) else {}
        template = None
        if args.get("template"):
            template = self._find(args["template"], ("template",))
            if template is None:
                raise ValueError(f"no template {_short(args['template'], 40)!r}")
        args, needs = self._stack_needs(args)
        # A stack naming a card not yet applied means the run with it: the
        # model often leaves out "proposed" and then gets "nothing to run".
        named = [self._find_loose(x.get("item") or x.get("id") if isinstance(x, dict) else x)
                 for x in (args.get("stack") if isinstance(args.get("stack"), list) else [])]
        proposed = (bool(args.get("proposed")) and bool(self._pending)  # type: ignore
                    ) or any(r is not None and r.get("_proposed") for r in named)
        modules, warnings = self._stack(args.get("stack"), False)
        warnings = needs + warnings
        after_modules: list[dict[str, Any]] = []
        if proposed:
            after_modules, warnings = self._stack(args.get("stack"), True)
        if not modules and not after_modules:
            raise ValueError("nothing to run" + "".join(f"; {w}" for w in warnings[:3]))
        before = None
        if not after_modules:
            report = self._run(modules, pins, seeds, template)
        elif not modules:
            # Everything in the stack is new in this answer: nothing to compare.
            report, modules = self._run(after_modules, pins, seeds, template), after_modules
        else:
            before = self._run(modules, pins, seeds, template)
            report, modules = self._run(after_modules, pins, seeds, template), after_modules
        stuck = self._stuck(report, modules, pins)
        warnings += stuck
        self.last_card = self._test_card(report, modules, before, args, pins, seeds)
        # On the card too: the user sees why a variable never changes.
        self.last_card["warnings"][:0] = [{"text": _short(w, 160), "count": report["runs"]}
                                          for w in stuck]
        return self._report(report, modules, warnings, before)

    def _stuck(self, report: dict[str, Any], modules: list[dict[str, Any]],
               pins: dict[str, str]) -> list[str]:
        """Derivations whose variable came out the same on every seed though
        their rules have more than one way to go: an IF that never held
        (the 9B's ``$iteration_total is "3"``, which only a Context Loop
        sets). Names the variables the tests read that nothing in the run
        sets, so the model pins them or says the test can't show it."""
        if report.get("runs", 0) < 5:
            return []
        sets: set[str] = set(pins)
        for m in modules:
            sets |= self._writes(m)  # type: ignore[attr-defined]
        out: list[str] = []
        for m in modules:
            if m.get("type") != "derivation":
                continue
            for rule in (m.get("payload") or {}).get("rules") or []:
                if not isinstance(rule, dict):
                    continue
                branches = [b for b in rule.get("branches") or [] if isinstance(b, dict)]
                if len(branches) + (1 if rule.get("else") else 0) < 2:
                    continue
                clauses = [*branches, *([rule["else"]] if isinstance(rule.get("else"),
                                                                     dict) else [])]
                targets = {a.get("target_var") for c in clauses for a in clause_actions(c)
                           if isinstance(a, dict) and a.get("mode") in (None, "replace")}
                for var in sorted(t for t in targets if isinstance(t, str)):
                    v = report["variables"].get(var)
                    if not v or v["distinct"] != 1 or v.get("other"):
                        continue
                    value = next(iter(v["counts"]), "")
                    read = {str(c.get("var") or "").split(".")[0]
                            for b in branches for c in _conditions(b.get("condition"))} - {""}
                    reads = sorted(read - sets)
                    if not reads and not any(
                            (report["variables"].get(r) or {}).get("distinct", 0) > 1
                            for r in read):
                        continue  # what it reads never changes here (pins): one value is right
                    why = (f"; nothing in this run sets ${', $'.join(reads)}, so its test "
                           "can't hold here: pass pins (e.g. {\"" + reads[0] + "\": \"...\"}) "
                           "or tell the user it only changes when that is set"
                           if reads else "; check its conditions against the values above")
                    out.append(f"{m.get('name')} set ${var} to "
                               f"\"{_short(self._show(value), 40)}\" on every seed: only one "
                               f"of its branches ever ran{why}")
        return out[:3]

    def _test_card(self, report: dict[str, Any], modules: list[dict[str, Any]],
                   before: dict[str, Any] | None, args: dict[str, Any],
                   pins: dict[str, str], seeds: int) -> dict[str, Any]:
        """The run as data for the chat's test card (the model reads the text
        report instead). Its stack holds the saved items, so "Open in Test
        Runner" can run the same thing there."""
        stack: list[dict[str, str]] = []
        for x in (args.get("stack") if isinstance(args.get("stack"), list) else [])[:MAX_STACK]:
            ref = x.get("item") or x.get("id") if isinstance(x, dict) else x
            row = self._find_loose(ref)
            if row is None or row.get("_proposed"):
                continue
            kind = self._kind(row)  # type: ignore[attr-defined]
            if kind != "template":
                stack.append({"bundle": row["id"]} if kind == "bundle" else {"module": row["id"]})
        runs = report["runs"]

        def pct(var: dict[str, Any] | None, value: str) -> int | None:
            if not var:
                return None
            total = sum(var["counts"].values()) + var["other"]
            return round(100 * var["counts"].get(value, 0) / total) if total else 0

        variables = []
        for name, v in list(report["variables"].items())[:12]:
            was = (before or {}).get("variables", {}).get(name) if before else None
            tops = []
            for k in list(v["counts"].keys())[:TOP_VALUES]:
                top: dict[str, Any] = {"v": _short(self._show(k), 80), "pct": pct(v, k)}
                if before is not None:
                    top["was"] = pct(was, k) or 0
                tops.append(top)
            variables.append({"name": name, "distinct": v["distinct"], "tops": tops,
                              **({"internal": True} if v.get("internal") else {})})
        never = []
        for m in modules:
            if m.get("type") != "wildcard":
                continue
            picked = report["picks"].get(m["id"], {})
            opts = m["payload"].get("options") or []
            miss = [_short(self._show(o.get("value")), 40) for o in opts
                    if isinstance(o, dict) and not o.get("is_null") and o.get("id") not in picked
                    and o.get("weight", 1) != 0]
            if miss and len(miss) < len(opts):
                never.append({"name": m.get("name") or "", "values": miss[:8],
                              "more": max(0, len(miss) - 8)})
        warnings = []
        for w in report["warnings"][:6]:
            detail = w.get("detail") if isinstance(w.get("detail"), dict) else {}
            warnings.append({"text": _short(detail.get("hint") or w.get("message")
                                            or w.get("type"), 160), "count": w["count"]})
        prompts = [{"p": _short(pr, 300), **({"n": _short(ng, 160)} if ng else {})}
                   for pr, ng in (report.get("prompts") or [])[:3]]
        return {"kind": "test", "runs": runs, "failed": report["failed"],
                "compared": before is not None, "seeds": seeds, "stack": stack,
                **({"pins": pins} if pins else {}), "vars": variables, "never": never,
                "warnings": warnings, "prompts": prompts}

    def _report(self, report: dict[str, Any], modules: list[dict[str, Any]],
                warnings: list[str], before: dict[str, Any] | None) -> str:
        runs = report["runs"]
        lines = [f"Ran {_plural(runs, 'seed')}"
                 + (f", {report['failed']} failed" if report["failed"] else "")
                 + (" with the proposed changes (was → now)" if before else "") + "."]
        lines += [f"Note: {w}" for w in warnings]

        def share(var: dict[str, Any] | None, value: str) -> str:
            if not var:
                return "0%"
            total = sum(var["counts"].values()) + var["other"]
            return f"{round(100 * var['counts'].get(value, 0) / total) if total else 0}%"

        for name, v in report["variables"].items():
            total = sum(v["counts"].values()) + v["other"]
            tops = "; ".join(
                (f'"{_short(self._show(k), 50)}" ' if k else "(empty) ")
                + (f"{share((before or {}).get('variables', {}).get(name), k)} → " if before
                   else "") + f"{round(100 * n / total) if total else 0}%"
                for k, n in list(v["counts"].items())[:TOP_VALUES])
            tag = " (internal)" if v.get("internal") else ""
            lines.append(f"${name}{tag}: {tops} ({v['distinct']} different)")
        for m in modules:
            if m.get("type") != "wildcard":
                continue
            picked = report["picks"].get(m["id"], {})
            never = [o.get("value") for o in m["payload"].get("options") or []
                     if isinstance(o, dict) and not o.get("is_null") and o.get("id") not in picked
                     and o.get("weight", 1) != 0]
            if never and len(never) < len(m["payload"].get("options") or []):
                lines.append(f"Never picked in {m.get('name')}: "
                             + ", ".join(_short(self._show(x), 40) for x in never[:8])
                             + (f" (+{len(never) - 8})" if len(never) > 8 else ""))
        for w in report["warnings"][:10]:
            detail = w.get("detail") if isinstance(w.get("detail"), dict) else {}
            what = detail.get("hint") or w.get("message") or w.get("type")
            lines.append(f"Warning: {_short(what, 200)} ({w['count']} of {runs} runs)")
        for prompt, negative in report.get("prompts") or []:
            lines.append(f"Prompt: {_short(prompt, 400)}")
            if negative:
                lines.append(f"  Negative: {_short(negative, 200)}")
        return "\n".join(lines)


_USE_KEYS = {"pick_min", "pick_max", "pick_separator", "pick_independent", "category_filter",
             "exclude_null", "match_variable", "seed_scope", "internal", "variable_binding",
             *(k for k in ai_use.WRITES if k != "target_select")}


def _conditions(cond: Any) -> list[dict[str, Any]]:
    """The single tests in a condition, groups opened."""
    if not isinstance(cond, dict):
        return []
    if isinstance(cond.get("conditions"), list):
        return [c for x in cond["conditions"] for c in _conditions(x)]
    return [cond]


def _num(raw: Any, size: int) -> int | None:
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return None
    return n if 1 <= n <= size else None
