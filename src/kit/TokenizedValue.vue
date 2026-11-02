<script setup lang="ts">
/**
 * Read-only renderer for a wildcard-grammar value string.
 *
 * Consumes the token stream from `tokenizeRich` (chunk A1) and paints each
 * token as a coloured inline span or chip — vars (green), refs (magenta),
 * brace alternations (amber scaffolding) and multi-picks (green scaffolding).
 * The component is RECURSIVE: brace arms re-enter `TokenizedValue` so a
 * `@{uuid}` or `$var` nested inside `{a|@{…}|$rank}` still renders as a chip.
 *
 * No `v-html` — every token becomes a `v-for`-rendered element (CLAUDE.md
 * confines raw-HTML rendering to `utils/sanitize.ts`). This mirrors the
 * sister project's RefChip + rich-text.css chrome (read, not imported — the
 * two repos diverge) but emits a flat, framework-local span tree.
 *
 * The token stream is pre-flattened in `<script>` into a single list of
 * `RenderItem`s (text / escape / var / ref / scaffolding-glyph / nested
 * child). That keeps the template a flat `v-for` — no nested branch loops —
 * which both reads cleanly and lets adjacent items abut with no stray
 * whitespace (tokens are contiguous; an inter-element space would corrupt
 * the rendered value).
 */
import { computed } from "vue";
import {
  splitRefFilter,
  tokenizeRich,
  type RichToken,
} from "./rich-tokenize";

defineOptions({ name: "TokenizedValue" });

const props = withDefaults(
  defineProps<{
    /** The raw wildcard-grammar string to render. */
    value: string;
    /** uuid → display-name map for resolving `@{uuid}` refs. Empty by default
     *  (callers without a catalog still render; refs fall back to #name/uuid). */
    uuidToName?: ReadonlyMap<string, string>;
  }>(),
  { uuidToName: () => new Map<string, string>() },
);

/** Concrete (never-undefined) map for binding into nested instances —
 *  `withDefaults` guarantees a value, but the recursive self-reference's
 *  optional prop type needs an explicitly non-optional source under
 *  `exactOptionalPropertyTypes`. */
const refMap = computed<ReadonlyMap<string, string>>(() => props.uuidToName);

/** One drawable unit. A brace/multi token expands into several of these
 *  (scaffolding glyphs interleaved with `child` arms); every other token
 *  maps to exactly one. */
type RenderItem =
  | { key: string; kind: "text" | "escape"; text: string }
  | { key: string; kind: "var"; label: string; neg: boolean }
  | { key: string; kind: "scaf"; text: string; flavor: "brace" | "multi" }
  | { key: string; kind: "child"; value: string }
  | {
      key: string;
      kind: "ref";
      uuid: string;
      label: string;
      resolved: boolean;
      expr: string;
      excludeNull: boolean;
    };

/** Var chip label: `$name` plus an optional `.K` list accessor (SP2a) and
 *  `.neg` negatives read (schema v8). */
function varLabel(meta: RichToken["meta"]): string {
  const idx = meta?.index;
  return (
    "$" +
    (meta?.name ?? "") +
    (idx !== undefined ? "." + idx : "") +
    (meta?.neg ? ".neg" : "")
  );
}

/** Resolve a ref token into its chip view. Resolution precedence: live map
 *  name → cached `#name` → bare uuid. The raw `:`-filter is peeled into an
 *  expression + exclude-null flag (the expression rides in the hover title,
 *  never inline, so long filters can't blow out the chip). */
function refItem(token: RichToken, key: string): Extract<RenderItem, { kind: "ref" }> {
  const meta = token.meta ?? {};
  const uuid = meta.uuid ?? "";
  const mapped = props.uuidToName.get(uuid);
  const fromMap = typeof mapped === "string" && mapped.length > 0 ? mapped : "";
  const cached = typeof meta.name === "string" && meta.name.length > 0 ? meta.name : "";
  const resolvedName = fromMap || cached;
  const { expr, excludeNull } = splitRefFilter((meta.sub_categories ?? []).join(","));
  return {
    key,
    kind: "ref",
    uuid,
    label: resolvedName || uuid,
    resolved: resolvedName.length > 0,
    expr,
    excludeNull,
  };
}

/** Reconstruct a multi-pick's opening scaffolding from its meta: `{N`, `-M`
 *  (range only), `~` (independent), then the `$$sep$$` delimiter. Inverse of
 *  the tokenizer so a decomposed block reads identically to its source. */
function multiPrefix(meta: RichToken["meta"]): string {
  const min = meta?.min ?? 0;
  const max = meta?.max ?? min;
  const range = max !== min ? "-" + max : "";
  const indep = meta?.independent ? "~" : "";
  return "{" + min + range + indep + "$$" + (meta?.sep ?? "") + "$$";
}

/** Flatten a brace/multi token into scaffolding glyphs + child arms. */
function expandBlock(
  token: RichToken,
  flavor: "brace" | "multi",
  open: string,
  base: string,
): RenderItem[] {
  const out: RenderItem[] = [];
  const branches = token.meta?.branches ?? [];
  out.push({ key: base + "-o", kind: "scaf", text: open, flavor });
  branches.forEach((branch, bi) => {
    if (bi > 0) out.push({ key: `${base}-p${bi}`, kind: "scaf", text: "|", flavor });
    out.push({ key: `${base}-c${bi}`, kind: "child", value: branch });
  });
  out.push({ key: base + "-x", kind: "scaf", text: "}", flavor });
  return out;
}

const items = computed<RenderItem[]>(() => {
  const out: RenderItem[] = [];
  for (const token of tokenizeRich(props.value)) {
    const key = String(token.start);
    switch (token.kind) {
      case "text":
        out.push({ key, kind: "text", text: token.raw });
        break;
      case "escape":
        out.push({ key, kind: "escape", text: token.raw });
        break;
      case "var":
        out.push({ key, kind: "var", label: varLabel(token.meta), neg: token.meta?.neg === true });
        break;
      case "ref":
        out.push(refItem(token, key));
        break;
      case "dp-brace":
        out.push(...expandBlock(token, "brace", "{", key));
        break;
      case "dp-multi":
        out.push(...expandBlock(token, "multi", multiPrefix(token.meta), key));
        break;
      default:
        // Defensive: any future/unhandled kind still shows its raw text so
        // the lossless invariant holds visually.
        out.push({ key, kind: "text", text: token.raw });
    }
  }
  return out;
});
</script>

<template>
  <span class="wp-tv">
    <template
      v-for="item in items"
      :key="item.key"
    >
      <span
        v-if="item.kind === 'text'"
        class="wp-tv-text"
      >{{ item.text }}</span>
      <span
        v-else-if="item.kind === 'escape'"
        class="wp-tv-escape"
      >{{ item.text }}</span>
      <span
        v-else-if="item.kind === 'var'"
        class="wp-tv-var"
        :data-neg="item.neg || null"
      >{{ item.label }}</span>
      <span
        v-else-if="item.kind === 'scaf'"
        class="wp-tv-scaf"
        :class="item.flavor === 'multi' ? 'wp-tv-scaf--multi' : 'wp-tv-scaf--brace'"
      >{{ item.text }}</span>
      <TokenizedValue
        v-else-if="item.kind === 'child'"
        :value="item.value"
        :uuid-to-name="refMap"
      />
      <span
        v-else-if="item.kind === 'ref'"
        class="wp-tv-ref"
        :class="{ 'wp-tv-ref--unresolved': !item.resolved }"
        :title="item.expr || undefined"
      >
        <i
          class="pi wp-tv-ref__icon"
          :class="item.resolved ? 'pi-sparkles' : 'pi-question-circle'"
          aria-hidden="true"
        />
        <span class="wp-tv-ref__label">{{ item.label }}</span>
        <i
          v-if="item.expr"
          class="pi pi-filter wp-tv-ref__funnel"
          aria-hidden="true"
        />
        <i
          v-if="item.excludeNull"
          class="pi pi-ban wp-tv-ref__nonull"
          aria-hidden="true"
        />
      </span>
    </template>
  </span>
</template>

<style scoped>
.wp-tv {
  /* Host text size — chips deliberately read SMALLER than this line. */
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.wp-tv-text {
  color: var(--wp-text);
}

.wp-tv-escape {
  color: var(--wp-text-dim);
}

/* ── Chips (var + ref) ───────────────────────────────────────────────
 * Inline (not inline-flex) so they wrap with the surrounding prose and
 * sit on the text baseline. 11px < the 13px host line keeps them from
 * towering over the text. */
.wp-tv-var,
.wp-tv-ref {
  display: inline;
  font-size: 11px;
  padding: 1px 4px;
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  white-space: nowrap;
  vertical-align: baseline;
}

/* $var — green. */
.wp-tv-var {
  background: color-mix(in oklab, var(--wp-success) 16%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--wp-success) 50%, transparent);
  color: var(--wp-success);
  font-weight: 500;
}
/* $var.neg — reads the variable's negatives, so it wears the negative red. */
.wp-tv-var[data-neg] {
  background: color-mix(in oklab, var(--wp-danger) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--wp-danger) 45%, transparent);
  color: var(--wp-danger-text, var(--wp-danger));
}

/* @{uuid} ref — magenta. Carries a hover title (the filter), so `help`. */
.wp-tv-ref {
  background: color-mix(in oklab, var(--wp-kind-ref) 15%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--wp-kind-ref) 50%, transparent);
  color: var(--wp-kind-ref);
  font-weight: 500;
  cursor: help;
}

/* Unresolved ref — red. Overrides the magenta tone above. */
.wp-tv-ref--unresolved {
  background: color-mix(in oklab, var(--wp-danger) 15%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--wp-danger) 50%, transparent);
  color: var(--wp-danger);
}

/* In-chip PrimeIcons — small + baseline-nudged so they don't lift the line. */
.wp-tv-ref__icon,
.wp-tv-ref__funnel,
.wp-tv-ref__nonull {
  font-size: 8px;
  vertical-align: 0;
}
.wp-tv-ref__icon {
  margin-right: 3px;
}
.wp-tv-ref__funnel {
  margin-left: 3px;
  color: var(--wp-warn);
}
.wp-tv-ref__nonull {
  margin-left: 2px;
  color: var(--wp-text-dim);
}

/* ── Brace / multi scaffolding ───────────────────────────────────────
 * Colour-only (no background, no box) — the bordered chips are the nested
 * arms. Brace = amber, multi = green. */
.wp-tv-scaf--brace {
  color: var(--wp-warn);
  font-weight: 600;
}
.wp-tv-scaf--multi {
  color: var(--wp-kind-derivation);
  font-weight: 600;
}
</style>
