<!-- src/manager/components/RefChip.vue -->
<script setup lang="ts">
import { computed, ref, onBeforeUnmount } from "vue";
import { KIND_ICON_MAP } from "../../components/shared/kind-icons";
import { parse, readsAs, matches } from "@/manager/parsing/subcatFilter";
import { splitRefFilter } from "@/widgets/richTokenize";
// Live library lookup — the hover card's "N of M options match" count reads
// the referenced wildcard's CURRENT option list from here, so adding an option
// in the library moves the count (the propagation signal issue #3 asked for).
import { cacheVersion, ensure, lookup } from "@/extension/preview-resolver";

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
  /** SP2a list accessor for a var chip: `$name.K` (0-based). Ignored by refs. */
  index?: number;
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
  /** Fired when a RESOLVED ref-kind chip body is clicked. The MouseEvent
   *  payload lets the parent read the chip's bounding rect (via
   *  `ev.currentTarget`) so it can anchor a popover near the chip. */
  "click": [event: MouseEvent];
  /** Fired when an UNRESOLVED (broken) ref-kind chip body is clicked.
   *  Distinct from `click` ON PURPOSE: hosts wired to `@click` expect
   *  only the resolved edit-popover event, so the broken-chip remap
   *  affordance gets its own channel (spec Component A "Trigger").
   *  Var-kind chips never emit. */
  "remap": [event: MouseEvent];
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
  // SP2a: a var chip may carry a `.K` list accessor (`$colors.0`); refs never do.
  const idxSuffix = !isRef.value && props.index != null ? "." + props.index : "";
  if (!props.resolved) {
    // Unresolved refs prefer the cached `#name` (kept on the ref atom
    // from the `@{uuid#name}` syntax) so a broken reference still
    // tells the user which wildcard was originally there. Falls back
    // to the uuid when no cached name is available (legacy bare-uuid
    // refs / older workflows). Vars keep showing the bare name.
    if (props.kind === "ref") {
      return props.name && props.name.length > 0 ? props.name : props.uuid;
    }
    return props.name + idxSuffix;
  }
  return (isRef.value ? "@" : "$") + props.name + idxSuffix;
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
  // Ref-kind only: resolved chips open the edit popover (`click`); broken
  // chips open the remap popup (`remap`). Var-kind chips are pure marks.
  if (!isRef.value) return;
  if (props.resolved) emit("click", ev);
  else emit("remap", ev);
}

// ── Hover card (issues #3 / #8): a small informational popover mirroring the
// constraint-pair card. Ref chips show uuid + filter "reads as" + "N of M
// options match" (the count is the propagation signal — it moves when library
// options change). Var chips show the binding + resolved state.
const HOVER_DELAY_MS = 280;
const hoverOpen = ref(false);
const popPos = ref<{ top: number; left: number; flip: boolean }>({ top: 0, left: 0, flip: false });
let hoverTimer: number | undefined;

/** Live option stats for a ref chip: total options + how many match the
 *  filter. Null when not a ref, no uuid, or the library row isn't resolved
 *  yet (card then shows "not in library"). Reactive on fetch via cacheVersion. */
const optionStats = computed<{ total: number; matched: number } | null>(() => {
  void cacheVersion.value;
  if (!isRef.value || !props.uuid) return null;
  const sets = lookup(props.uuid)?.optionTagSets;
  if (!sets || sets.length === 0) return null;
  const total = sets.length;
  if (!hasExpr.value) return { total, matched: total };
  const ast = parse(filter.value.expr);
  return { total, matched: sets.filter((tags) => matches(ast, new Set(tags))).length };
});

function positionPop(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  const POP_H = 120;
  const gap = 6;
  const margin = 8;
  const spaceBelow = window.innerHeight - r.bottom;
  const flip = spaceBelow < POP_H + gap + margin && r.top > spaceBelow;
  popPos.value = {
    top: flip ? Math.max(margin, r.top - gap) : r.bottom + gap,
    left: Math.max(margin, Math.min(r.left, window.innerWidth - 280 - margin)),
    flip,
  };
}

function onEnter(ev: MouseEvent): void {
  const el = ev.currentTarget as HTMLElement | null;
  if (!el) return;
  if (hoverTimer !== undefined) window.clearTimeout(hoverTimer);
  hoverTimer = window.setTimeout(() => {
    if (isRef.value && props.uuid) ensure([props.uuid]); // fetch options if uncached
    positionPop(el);
    hoverOpen.value = true;
  }, HOVER_DELAY_MS);
}

function onLeave(): void {
  if (hoverTimer !== undefined) window.clearTimeout(hoverTimer);
  hoverTimer = undefined;
  hoverOpen.value = false;
}

onBeforeUnmount(() => { if (hoverTimer !== undefined) window.clearTimeout(hoverTimer); });
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
    :data-uuid="uuid || undefined"
    contenteditable="false"
    @click.stop="onClick"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
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

    <!-- Info-only hover card (issues #3 / #8). The <Teleport> lives INSIDE the
         chip span so the component stays single-root (wrapper.classes/attributes
         keep working); it renders only a placeholder here and moves the card to
         <body> — fixed + pointer-events:none so it escapes overflow + never
         steals the hover. Mirrors the constraint-pair popover. -->
    <Teleport to="body">
    <div
      v-if="hoverOpen"
      class="wp-refchip-pop"
      :class="{ 'wp-refchip-pop--up': popPos.flip }"
      :style="{ top: popPos.top + 'px', left: popPos.left + 'px' }"
      data-test="refchip-hover"
    >
      <template v-if="kind === 'ref'">
        <div class="wp-refchip-pop__head">
          <span v-if="name" class="wp-refchip-pop__name">@{{ name }}</span>
          <span class="wp-refchip-pop__kind">{{ resolved ? moduleKind : "broken" }}</span>
        </div>
        <div class="wp-refchip-pop__uuid">{{ uuid }}</div>
        <div v-if="hasExpr || showNoNull" class="wp-refchip-pop__filter">
          <span v-if="readsAsExpr">{{ readsAsExpr }}</span>
          <span v-if="filter.excludeNull" class="wp-refchip-pop__nonull">null excluded</span>
        </div>
        <!-- Option count only for wildcards (a resolved constraint/derivation
             has no options — don't mislabel it "not in library"). Show the
             not-in-library note ONLY when the ref genuinely didn't resolve. -->
        <div v-if="optionStats" class="wp-refchip-pop__count">
          {{ hasExpr ? `${optionStats.matched} of ${optionStats.total} options match`
                     : `${optionStats.total} option${optionStats.total === 1 ? "" : "s"}` }}
        </div>
        <div v-else-if="!resolved" class="wp-refchip-pop__count">not in library</div>
      </template>
      <template v-else>
        <div class="wp-refchip-pop__head">
          <span class="wp-refchip-pop__name">${{ name }}{{ index != null ? "." + index : "" }}</span>
        </div>
        <div class="wp-refchip-pop__count">{{ resolved ? "produced upstream" : "binds at runtime" }}</div>
      </template>
    </div>
    </Teleport>
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
  cursor: pointer;
}
.wp-refchip--unresolved:hover {
  background: color-mix(in srgb, var(--wp-danger, #ef4444) 25%, transparent);
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

/* Hover card — teleported to <body>; scoped styles still apply (the data-v
 * attribute travels with the teleported node). z-index 9999 matches the other
 * canvas popovers. */
.wp-refchip-pop {
  position: fixed;
  z-index: 9999;
  width: 260px;
  padding: 7px 9px;
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border-strong);
  border-radius: 7px;
  box-shadow: var(--wp-shadow-lg);
  font: 10px/1.5 var(--wp-font-mono, monospace);
  color: var(--wp-text);
  pointer-events: none;
}
.wp-refchip-pop--up { transform: translateY(-100%); }
.wp-refchip-pop > div { padding: 1px 0; word-break: break-word; }
.wp-refchip-pop__head { display: flex; gap: 6px; align-items: baseline; }
.wp-refchip-pop__name { font-weight: 600; }
.wp-refchip-pop__kind {
  font-size: 8px; text-transform: uppercase;
  color: var(--wp-text-dim);
  border: 1px solid var(--wp-border);
  border-radius: 3px; padding: 0 3px;
}
.wp-refchip-pop__uuid { color: var(--wp-text-muted); }
.wp-refchip-pop__filter { color: var(--wp-text-dim); }
.wp-refchip-pop__count { color: var(--wp-accent-text); font-weight: 600; }
.wp-refchip-pop__nonull { color: var(--wp-status-modified, #fbbf24); margin-left: 4px; }
</style>
