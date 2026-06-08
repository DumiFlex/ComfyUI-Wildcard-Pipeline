<!-- src/manager/components/RefChip.vue -->
<script setup lang="ts">
import { computed } from "vue";
import { KIND_ICON_MAP } from "../../components/shared/kind-icons";
import { parse, readsAs } from "@/manager/parsing/subcatFilter";
import { splitRefFilter } from "@/widgets/richTokenize";

/** Module kind for the `moduleKind` prop. Mirrors `ModuleKind` in
 *  `src/manager/cascade/resolveChip.ts` — duplicated as a local literal
 *  union so this component stays free of cascade-layer imports. */
type ChipModuleKind =
  | "wildcard" | "fixed_values" | "combine" | "derivation" | "constraint" | "bundle";

interface Props {
  /** "ref" → @{uuid} chip, "var" → $name chip. */
  kind: "ref" | "var";
  /** Display name. For unresolved refs this is empty; uuid is shown instead. */
  name: string;
  /** UUID of the wildcard library entry (ref-kind only). */
  uuid?: string;
  /** True when the name resolved against the catalog / surface. False → render as red `?` chip. */
  resolved: boolean;
  /** Boolean sub-category filter expression (ref-kind only). Empty /
   *  undefined = no expression. The expression itself is NOT shown
   *  inline (it can be long); a funnel indicator marks "filtered" and
   *  the full normalized form ("reads as") lives in the hover title. */
  expr?: string;
  /** Exclude-null flag (ref-kind only). True drops the wildcard's null
   *  option from the resolved pool (inverted-null semantic, 2026-05-25).
   *  Surfaces alongside the funnel + in the hover title. */
  excludeNull?: boolean;
  /** @deprecated Legacy flat sub-category list (pre-SP1). Superseded by
   *  the boolean `expr` + `excludeNull` pair. Still accepted so callers
   *  that have not yet migrated keep compiling + showing a funnel; when
   *  `expr` is empty this list is reconstructed into an effective
   *  expression (comma = OR) and a trailing `"null"` token maps to
   *  `excludeNull`. New callers should pass `expr` / `excludeNull`. */
  subCategories?: string[];
  /** Module kind the resolved uuid points at — drives the chip's color
   *  (CSS custom property `--wp-refchip-tone`) + the leading PrimeIcon.
   *  Defaults to `wildcard` so existing callers that pass no `moduleKind`
   *  keep the legacy violet wildcard styling. Only honoured when the
   *  chip is `kind="ref"` AND `resolved` — unresolved chips stay red
   *  regardless. Var chips ignore this prop entirely. */
  moduleKind?: ChipModuleKind;
}

const props = withDefaults(defineProps<Props>(), {
  uuid: "",
  expr: "",
  excludeNull: false,
  subCategories: () => [],
  moduleKind: "wildcard",
});

const emit = defineEmits<{
  /** Fired when a ref-kind chip body is clicked. The MouseEvent
   *  payload lets the parent read the chip's bounding rect (via
   *  `ev.currentTarget`) so it can anchor a popover near the chip
   *  instead of centred on screen. Var-kind chips don't emit. */
  "click": [event: MouseEvent];
}>();

const isRef = computed(() => props.kind === "ref");

/** Effective filter for the chip, resolving the canonical `expr` /
 *  `excludeNull` props against the deprecated `subCategories` fallback.
 *  When `expr` is empty, a legacy list is reconstructed (comma = OR) and
 *  a trailing reserved `"null"` token maps to `excludeNull` — mirrors the
 *  pre-SP1 inverted-null semantic so unmigrated callers keep working. */
const filter = computed<{ expr: string; excludeNull: boolean }>(() => {
  const rawExpr = props.expr.trim();
  if (rawExpr.length > 0) {
    return { expr: rawExpr, excludeNull: props.excludeNull };
  }
  if (props.subCategories.length > 0) {
    // Two null conventions reach this legacy prop: a standalone "null"
    // element (pre-SP1 inverted-null list) and a glued trailing `!null` on
    // the v2 lexer's single-element body (the lexer comma-splits without
    // peeling). Strip the standalone element, then peel any glued marker off
    // the rejoined body so `["warm or intense!null"]` becomes
    // `{ expr: "warm or intense", excludeNull: true }` rather than showing
    // `warm or intense!null` raw in the hover title.
    const standaloneNull = props.subCategories.includes("null");
    const terms = props.subCategories.filter((s) => s !== "null");
    const peeled = splitRefFilter(terms.join(","));
    return {
      expr: peeled.expr,
      excludeNull: props.excludeNull || standaloneNull || peeled.excludeNull,
    };
  }
  return { expr: "", excludeNull: props.excludeNull };
});

const hasExpr = computed(() => isRef.value && filter.value.expr.length > 0);
/** A ref carries a filter when it has an expression OR opts the null
 *  option out. Either drives the compact funnel indicator. */
const isFiltered = computed(
  () => isRef.value && (hasExpr.value || filter.value.excludeNull),
);

/** Normalized expression for the hover tooltip — the full expression is
 *  NOT shown inline (it can be long), only on hover via "reads as".
 *  Falls back to the raw expression if it doesn't parse (shouldn't
 *  happen for serialized refs, but keeps a broken token legible). */
const readsAsExpr = computed(() => {
  if (!hasExpr.value) return "";
  try {
    return readsAs(parse(filter.value.expr));
  } catch {
    return filter.value.expr;
  }
});

/** Hover title summarising the filter — `<reads-as>` plus a
 *  " · null excluded" tail when the null option is dropped. Undefined
 *  when there's nothing to describe (so no empty `title` attr renders). */
const filterTitle = computed<string | undefined>(() => {
  if (!isFiltered.value) return undefined;
  const parts: string[] = [];
  if (readsAsExpr.value) parts.push(readsAsExpr.value);
  if (filter.value.excludeNull) parts.push("null excluded");
  return parts.join(" · ");
});

/** Whether the exclude-null mark should render (effective flag). */
const showNoNull = computed(() => isRef.value && filter.value.excludeNull);

const label = computed(() => {
  if (!props.resolved) {
    // Unresolved refs prefer the cached `#name` (kept on the ref atom
    // from the `@{uuid#name}` syntax) so a broken reference still
    // tells the user which wildcard was originally there. Falls back
    // to the uuid when no cached name is available (legacy bare-uuid
    // refs / older workflows). Vars keep showing the bare name.
    if (props.kind === "ref") {
      return props.name && props.name.length > 0 ? props.name : props.uuid;
    }
    return props.name;
  }
  return (isRef.value ? "@" : "$") + props.name;
});

/** Per-kind color CSS variable used as the chip's `--wp-refchip-tone`.
 *  `wildcard` keeps the legacy `--wp-kind-wildcard` (kind-aware path
 *  skipped). `bundle` has no `--wp-kind-bundle` token — falls back to
 *  text-muted, matching `toneVar("bundle")` in docs/registry.ts. */
const KIND_TONE: Record<ChipModuleKind, string> = {
  wildcard:     "var(--wp-kind-wildcard)",
  fixed_values: "var(--wp-kind-fixed)",
  combine:      "var(--wp-kind-combine)",
  derivation:   "var(--wp-kind-derivation)",
  constraint:   "var(--wp-kind-constraint)",
  bundle:       "var(--wp-text-muted)",
};

const isKindAware = computed(() =>
  isRef.value && props.resolved && props.moduleKind !== "wildcard",
);

const toneStyle = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {};
  if (isKindAware.value) out["--wp-refchip-tone"] = KIND_TONE[props.moduleKind];
  return out;
});

const kindIconCls = computed(() =>
  isKindAware.value ? KIND_ICON_MAP[props.moduleKind] : "",
);

const icon = computed(() => {
  if (!props.resolved) return "?";
  return isRef.value ? "✦" : "⌘";
});

function onClick(ev: MouseEvent): void {
  // Only ref-kind chips have a click-to-edit affordance. Var-kind chips
  // are pure visual marks — no picker to open.
  if (isRef.value && props.resolved) emit("click", ev);
}
</script>

<template>
  <span
    class="wp-refchip"
    :class="{
      'wp-refchip--var': kind === 'var',
      'wp-refchip--ref': kind === 'ref',
      'wp-refchip--unresolved': !resolved,
      'wp-refchip--filtered': isFiltered,
    }"
    :style="toneStyle"
    :title="filterTitle"
    contenteditable="false"
    @click.stop="onClick"
  >
    <i
      v-if="kindIconCls"
      class="wp-refchip__icon wp-refchip__icon--pi"
      :class="kindIconCls"
      aria-hidden="true"
    ></i>
    <span v-else class="wp-refchip__icon" aria-hidden="true">{{ icon }}</span>
    <span class="wp-refchip__label">{{ label }}</span>
    <!-- Compact filter indicator. The funnel marks "an expression is
         set" (the expression itself stays in the hover title — it can
         be long). A separate ban mark calls out exclude-null so the
         negation reads at a glance. -->
    <span
      v-if="isFiltered"
      class="wp-refchip__filter"
      data-test="refchip-filter"
      aria-hidden="true"
    >
      <i v-if="hasExpr" class="pi pi-filter wp-refchip__funnel"></i>
      <i v-if="showNoNull" class="pi pi-ban wp-refchip__nonull"></i>
    </span>
  </span>
</template>

<style scoped>
.wp-refchip {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  padding: 0 5px;
  margin: 1px 1px;
  border-radius: 3px;
  border: 1px solid;
  font: 10px/1.4 var(--wp-font-mono);
  user-select: none;
  cursor: default;
  vertical-align: baseline;
}
.wp-refchip--var {
  background: color-mix(in srgb, var(--wp-success, #22c55e) 15%, transparent);
  border-color: color-mix(in srgb, var(--wp-success, #22c55e) 50%, transparent);
  color: var(--wp-success);
}
/* Ref chip tone is sourced from `--wp-refchip-tone` — set per-instance
 * via inline style when `moduleKind` differs from `wildcard`. The
 * fallback to `--wp-kind-wildcard` keeps legacy (no-prop) callers on
 * the original violet palette. */
.wp-refchip--ref {
  background: color-mix(in srgb, var(--wp-refchip-tone, var(--wp-kind-wildcard, #a855f7)) 15%, transparent);
  border-color: color-mix(in srgb, var(--wp-refchip-tone, var(--wp-kind-wildcard, #a855f7)) 50%, transparent);
  color: var(--wp-refchip-tone, var(--wp-kind-wildcard));
  cursor: pointer;
}
.wp-refchip--ref:hover { background: color-mix(in srgb, var(--wp-refchip-tone, var(--wp-kind-wildcard, #a855f7)) 25%, transparent); }
.wp-refchip--unresolved {
  background: color-mix(in srgb, var(--wp-danger, #ef4444) 15%, transparent);
  border-color: color-mix(in srgb, var(--wp-danger, #ef4444) 50%, transparent);
  color: var(--wp-danger);
  cursor: help;
}
.wp-refchip__icon { font-size: 8px; opacity: 0.75; }
/* PrimeIcon variant (moduleKind set) — sized to align with the unicode glyph baseline. */
.wp-refchip__icon--pi { font-size: 9px; line-height: 1; }
/* Compact filter indicator — funnel (expression set) + optional ban
 * (null excluded). Tinted with the "modified" status accent to read as
 * "this ref is narrowed", and `cursor: help` mirrors the unresolved
 * chip's hover affordance since the full filter lives in the title. */
.wp-refchip__filter {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 1px;
  color: var(--wp-status-modified, #fbbf24);
  cursor: help;
}
.wp-refchip__funnel { font-size: 8px; line-height: 1; }
.wp-refchip__nonull { font-size: 8px; line-height: 1; opacity: 0.85; }
</style>
