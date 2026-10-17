import type { ModuleEntry } from "../../widgets/_shared";
import {
  ensure as ensurePreviewLookup,
  lookup as previewLookup,
  cacheVersion as previewCacheVersion,
} from "../../extension/preview-resolver";
import { isEnabled, type WildcardOption, type InstanceLike } from "./editors/wildcard/probability";

/**
 * Row-card read-outs that only look at the module list: a sibling's display
 * name by uuid, the `#N of M` sibling badge and the summary line's tokens.
 * Pure over `modules`; `lookupSiblingName` also reads (and lazily warms) the
 * preview-resolver cache, so callers inside a computed or render re-run
 * when a fetch lands.
 */

/**
 * Look up a sibling module's display name by uuid. Used by the
 * constraint summary + (Task 2) the modal preview. Returns the
 * payload's `var_binding` first (canonical $-var name for wildcards),
 * falls back to `meta.name`, then to the lazy preview-resolver cache
 * for cross-node refs (e.g. constraint source/target wildcards that
 * weren't picked into this WP_Context). Returns `null` only when
 * neither siblings nor the cache know the uuid — caller decides what
 * to render in that dangling-ref case.
 */
export function lookupSiblingName(modules: ModuleEntry[], uuid: string | null | undefined): string | null {
  if (!uuid) return null;
  // Touch cacheVersion so the computed re-evaluates when an async
  // fetch lands. Without this read the lookup stays stale until some
  // other dependency invalidates the computed.
  void previewCacheVersion.value;
  const sib = modules.find((m) => m.id === uuid);
  if (sib) {
    // Mirror the engine's precedence: per-instance override wins
    // (`wildcard_handler.py:216`), payload default falls through.
    const inst = sib.instance?.variable_binding;
    if (typeof inst === "string" && inst.trim()) return inst.trim();
    const binding = (sib.payload as { var_binding?: string } | undefined)?.var_binding;
    if (typeof binding === "string" && binding.trim()) return binding.trim();
    const name = sib.meta?.name?.trim();
    if (name) return name;
  }
  // Fallback: dangling ref (e.g. constraint references a wildcard
  // not embedded in this node). Pull the canonical name from the
  // preview-resolver cache — that's already populated for any uuid
  // mentioned anywhere in the chain. Fire ensure() lazily so the
  // first reference triggers a fetch; subsequent reads hit the cache.
  ensurePreviewLookup([uuid]);
  const lk = previewLookup(uuid);
  if (lk?.varBinding) return lk.varBinding;
  if (lk?.name) return lk.name;
  return null;
}

/**
 * Returns null when the module is the only instance of its uuid in the
 * current Context, or `{ index: 1-based, total }` when it has siblings.
 * Used to render the `#N of M` badge.
 *
 * Phase A: counts in-Context only. Phase B may broaden to whole-
 * workflow scope when wiring the auto-fork prompt.
 */
export function siblingInfo(modules: ModuleEntry[], m: ModuleEntry): { index: number; total: number } | null {
  const sameUuid = modules.filter((x) => x.id === m.id);
  if (sameUuid.length <= 1) return null;
  const index = sameUuid.findIndex((x) => x === m) + 1;
  return { index, total: sameUuid.length };
}

/**
 * One token of the summary line. `var` tokens get the kind-color
 * `var-N` class via `varColorClass`; `literal` tokens render plain.
 *
 * Same shape as the assembler / combine preview tokenization
 * (`wp-asm-preview` in AssemblerHelper.vue) so the eye reads
 * `$hair_style` as the same hue everywhere it appears.
 */
export type SummaryToken =
  | { kind: "literal"; text: string }
  | { kind: "var"; text: string; varName: string };

/**
 * Structured per-module summary used by the row's meta line. Each
 * entry is rendered as either a colored `<span class="var-tok var-N">`
 * (for `$binding` references) or plain text. Shape mirrors the
 * mockup at `_temp/design-demos/widgets-redesign-v5.html:682, 697,
 * 712, 723, 734` so colored variable tokens land in-place of the
 * previous all-plaintext meta string.
 */
/**
 * Card subtitle line. fixed_values surfaces the inline-edited
 * `$var, $var, …` list (the legacy summary); other kinds inspect
 * the snapshot payload to surface a one-glance signature
 * (var-binding + option count for wildcards, output-var for
 * combines, rule count for derivations, etc.).
 */
export function summaryTokens(modules: ModuleEntry[], m: ModuleEntry): SummaryToken[] {
  // Tiny helper — wrap a binding name as a `$name` var token so the
  // colour hash is computed against the bare name (matching how
  // `varColorClass` is used elsewhere in the codebase).
  const v = (name: string): SummaryToken => ({ kind: "var", text: `$${name}`, varName: name });
  const lit = (text: string): SummaryToken => ({ kind: "literal", text });

  if (m.type === "fixed_values") {
    // Read the bindings from `entries` first — that's the UI-mirror
    // populated when the user types directly into the inline editor.
    // Library-linked rows (bundle children, modules dragged in fresh
    // from the picker) ship with `entries: []` because the canonical
    // values live in `payload.values`. Fall back to that payload
    // shape so a library-linked fixed_values row doesn't render as
    // "(empty)" just because its UI-mirror hasn't been populated.
    const fromEntries = m.entries
      .map((e) => e.variable_name.trim())
      .filter((n) => n !== "");
    const fromPayload =
      fromEntries.length > 0
        ? []
        : (((m.payload ?? {}) as { values?: Array<{ name?: string }> }).values ?? [])
            .map((vv) => (vv.name ?? "").trim())
            .filter((n) => n !== "");
    const names = fromEntries.length > 0 ? fromEntries : fromPayload;
    if (names.length === 0) return [lit("(empty)")];
    const heads = names.slice(0, 2);
    const more = names.length - heads.length;
    const out: SummaryToken[] = [];
    heads.forEach((name, i) => {
      if (i > 0) out.push(lit(", "));
      out.push(v(name));
    });
    if (more > 0) out.push(lit(`, +${more} more`));
    return out;
  }

  const p = (m.payload ?? {}) as Record<string, unknown>;
  switch (m.type) {
    case "wildcard": {
      // Card summary respects the per-instance binding override so a
      // renamed wildcard reads as `$<override>` on the canvas. Engine
      // applies the same precedence at run time.
      const instBind = m.instance?.variable_binding;
      const payloadBinding = (p.var_binding as string | undefined)?.trim();
      const binding = (typeof instBind === "string" && instBind.trim()) || payloadBinding;
      const head: SummaryToken = binding ? v(binding) : lit("wildcard");
      const allOpts = (Array.isArray(p.options) ? p.options : []) as WildcardOption[];
      const total = allOpts.length;
      if (!total) return [head];
      const inst = (m.instance ?? {}) as InstanceLike & { pick_min?: number; pick_max?: number };
      const pmin = typeof inst.pick_min === "number" ? inst.pick_min : 1;
      const pmax = typeof inst.pick_max === "number" ? Math.max(pmin, inst.pick_max) : pmin;
      const multiActive = pmax > 1;
      // "X of Y options" only when a filter / enabled-subset actually narrows
      // the pool — a plain count when nothing is filtering (keeps the common
      // case clean). The null-option drop in multi mode alone never triggers it.
      const hasFilter =
        (typeof inst.category_filter === "string" && inst.category_filter.trim() !== "") ||
        Array.isArray(inst.enabled_options);
      const eligible = allOpts.filter((o) => isEnabled(o, inst, multiActive)).length;
      const tokens: SummaryToken[] = [
        head,
        lit(
          hasFilter && eligible < total
            ? ` · ${eligible} of ${total} options`
            : ` · ${total} option${total === 1 ? "" : "s"}`,
        ),
      ];
      // Multi-pick hint — surface when the instance resolves more than one.
      if (pmax > 1) {
        tokens.push(lit(pmin === pmax ? ` · picks ${pmin}` : ` · picks ${pmin}-${pmax}`));
      }
      return tokens;
    }
    case "combine": {
      // Same per-instance precedence as wildcard: rebinding via the v2
      // modal (`instance.variable_binding`) renders as `$<override>` on
      // the card so the canvas reads match the engine output.
      const inst = m.instance?.variable_binding;
      const payloadOut = (p.output_var as string | undefined)?.trim();
      const out = (typeof inst === "string" && inst.trim()) || payloadOut;
      return out ? [lit("→ "), v(out)] : [lit("template")];
    }
    case "derivation": {
      const rules = Array.isArray(p.rules) ? p.rules.length : 0;
      return [lit(`${rules} rule${rules === 1 ? "" : "s"}`)];
    }
    case "constraint": {
      const cp = p as Partial<{
        source_wildcard_id: string | null;
        target_wildcard_id: string | null;
        matrix: Record<string, Record<string, unknown>>;
      }>;
      const src = lookupSiblingName(modules, cp.source_wildcard_id) ?? "?";
      const tgt = lookupSiblingName(modules, cp.target_wildcard_id) ?? "?";
      const rowKeys = Object.keys(cp.matrix ?? {});
      const colKeys = Object.keys(Object.values(cp.matrix ?? {})[0] ?? {});
      return [v(src), lit(" → "), v(tgt), lit(` · ${rowKeys.length}×${colKeys.length}`)];
    }
    default:             return [lit(m.type)];
  }
}

/** Plain-text fallback — used for `:title` tooltip + a11y text. */
export function summaryFor(modules: ModuleEntry[], m: ModuleEntry): string {
  return summaryTokens(modules, m).map((t) => t.text).join("");
}
