<script setup lang="ts">
import { computed } from "vue";
import {
  effectiveWeight,
  isEnabled,
  probabilityFor,
  type InstanceLike,
  type WildcardOption,
} from "../probability";
import { splitRefFilter, tokenizeRich, type RichToken } from "../../../../../widgets/richTokenize";
import { cacheVersion, ensure, lookup } from "../../../../../extension/preview-resolver";
import type { PairingBadge } from "../../../../../extension/constraint-pairs";
import { matches, parse, readsAs } from "@/manager/parsing/subcatFilter";
import PairBadge from "../../../PairBadge.vue";

interface OptionFull extends WildcardOption {
  value: string;
}

const props = withDefaults(
  defineProps<{
    option: OptionFull;
    allOptions: readonly OptionFull[];
    instance: InstanceLike;
    /** Via-nested constraint pairs that reach a target through this
     *  option's `@{uuid}` ref. Rendered as trailing `↪#N` chips at the
     *  end of the value cell. Empty when this option isn't a carrier. */
    pairBadges?: readonly PairingBadge[];
    /** `payload.tag_groups` — axis name → member tags. Drives the
     *  per-axis colour of the CATEGORY chips so a tag reads with the
     *  same hue here as in the pool pills. Ungrouped tags fall back to
     *  a neutral hue. Read-only on this surface (membership is edited
     *  in the SPA library editor, §4.3). */
    tagGroups?: Record<string, string[]>;
    /** SP2a: the instance is in multi-pick mode (count range != 1..1). When
     *  true the null option is excluded from the pool, so its row renders
     *  disabled/greyed + non-toggleable. Real option rows are unaffected. */
    multiActive?: boolean;
  }>(),
  { pairBadges: () => [], tagGroups: () => ({}), multiActive: false },
);

const emit = defineEmits<{
  "toggle": [optionId: string];
  "weight": [optionId: string, weight: number | null];
}>();

const enabled = computed(() => isEnabled(props.option, props.instance, props.multiActive === true));

/**
 * Tokenize the option's `value` so nested `@{uuid}` refs render with
 * resolved names + colour, brace-blocks (`{a|b|c}`) get the warn hue,
 * and `$vars` look like the SPA editor's chip style. Reads
 * `cacheVersion` so the computed re-runs when the preview-resolver
 * lands a new uuid → name mapping.
 *
 * Side-effect: kicks `ensure(...)` for unseen uuids the first time the
 * row tokenizes — fires-and-forgets, the resolver picks up missing
 * names asynchronously and bumps `cacheVersion`.
 */
/** SP2b: split a `{a|b}` / `{N$$sep$$…}` block into a flat run of scaffolding
 *  fragments (kept as dp-brace/dp-multi tokens carrying braces / count /
 *  `$$sep$$` / pipes / literal arms) + the inner `@{uuid}`/`$var` arms as their
 *  own ref/var tokens. The render loop then chips inner refs/vars exactly like
 *  top-level ones, instead of dumping the whole block as raw text. Mirrors the
 *  SPA editor's decomposition (`manager/components/atomicEditorModel.parse`) so
 *  the canvas reads identically. */
function decomposeBlock(tok: RichToken): RichToken[] {
  const meta = (tok.meta ?? {}) as {
    branches?: string[]; min?: number; max?: number;
    independent?: boolean; sep?: string; count?: number;
  };
  const branches = Array.isArray(meta.branches) ? meta.branches : [];
  const frag = (raw: string): RichToken => ({ kind: tok.kind, raw, start: 0, end: 0 });
  const out: RichToken[] = [];
  if (tok.kind === "dp-multi") {
    const cmin = meta.min ?? meta.count ?? 0;
    const cmax = meta.max ?? meta.count ?? 0;
    const countStr = cmin === cmax ? String(cmin) : `${cmin}-${cmax}`;
    out.push(frag(`{${countStr}${meta.independent ? "~" : ""}$$${meta.sep ?? ""}$$`));
  } else {
    out.push(frag("{"));
  }
  branches.forEach((b, i) => {
    if (i > 0) out.push(frag("|"));
    for (const bt of tokenizeRich(b)) {
      if (bt.kind === "ref" || bt.kind === "var") out.push(bt);
      else out.push(frag(bt.raw));
    }
  });
  out.push(frag("}"));
  return out;
}

const tokens = computed<RichToken[]>(() => {
  void cacheVersion.value;
  const out: RichToken[] = [];
  for (const t of tokenizeRich(props.option.value ?? "")) {
    if (t.kind === "dp-brace" || t.kind === "dp-multi") out.push(...decomposeBlock(t));
    else out.push(t);
  }
  // Resolve names for EVERY ref — including refs nested inside a block.
  const uuids = out
    .filter((t) => t.kind === "ref")
    .map((t) => t.meta?.uuid)
    .filter((u): u is string => typeof u === "string");
  if (uuids.length > 0) ensure(uuids);
  return out;
});

function refDisplay(
  uuid: string | undefined,
  cachedName: string | undefined,
  raw: string,
): string {
  if (!uuid) return raw;
  // Priority: live library lookup → cached `#name` from the token →
  // raw token text (which still carries `@{uuid#name}` or bare uuid).
  // Mirrors the SPA's RefChip label-fallback chain so broken refs
  // surface the cached name instead of a bare uuid.
  const hit = lookup(uuid);
  if (hit?.varBinding && hit.varBinding.trim()) return `@${hit.varBinding.trim()}`;
  if (hit?.name && hit.name.trim()) return `@${hit.name.trim()}`;
  if (cachedName && cachedName.trim()) return `@${cachedName.trim()}`;
  return raw;
}

/** True when the ref's uuid resolves against neither the live preview-
 *  resolver cache nor any local sibling in the chain — i.e. broken
 *  reference. Drives the danger-tint + `?` icon on the option chip
 *  so canvas-side broken refs read the same way as the SPA's RefChip
 *  unresolved state. */
function refIsUnresolved(uuid: string | undefined): boolean {
  if (!uuid) return false;
  // `lookup` is the resolver cache; truthy means we know a live
  // entry exists for this uuid (live name/varBinding either populated
  // now or already polled). Anything falsey reads as broken.
  return !lookup(uuid);
}

/** Compact filter indicators for a nested-ref token — mirrors the SPA
 *  RefChip grammar so the canvas reads identically: a funnel when a
 *  sub-category expression is set, a ban when the null option is excluded,
 *  and the normalized expression ("reads as") + "null excluded" in the
 *  hover title. The widget lexer comma-splits the raw `:`-body WITHOUT
 *  peeling `!null`, so rejoin + `splitRefFilter` here rather than printing
 *  the glued `sub_categories` inline. Memoized per token object so the
 *  several template bindings don't each re-parse. */
interface RefFilterInfo { hasExpr: boolean; excludeNull: boolean; isFiltered: boolean; title: string }
const _refFilterMemo = new WeakMap<RichToken, RefFilterInfo>();
function refFilter(tok: RichToken): RefFilterInfo {
  const cached = _refFilterMemo.get(tok);
  if (cached) return cached;
  const subs = tok.meta?.sub_categories;
  let info: RefFilterInfo;
  if (!Array.isArray(subs) || subs.length === 0) {
    info = { hasExpr: false, excludeNull: false, isFiltered: false, title: "" };
  } else {
    const { expr, excludeNull } = splitRefFilter(subs.join(","));
    let reads = "";
    if (expr) {
      try { reads = readsAs(parse(expr)); } catch { reads = expr; }
    }
    const parts: string[] = [];
    if (reads) parts.push(reads);
    if (excludeNull) parts.push("null excluded");
    info = {
      hasExpr: expr.length > 0,
      excludeNull,
      isFiltered: expr.length > 0 || excludeNull,
      title: parts.join(" · "),
    };
  }
  _refFilterMemo.set(tok, info);
  return info;
}

/** Distinguish two reasons a row might be disabled:
 *   - per-option toggle off (`enabled_options` array excludes this id)
 *   - sub-category filtered out (`category_filter` boolean expression
 *     excludes this option's tag set)
 *
 * Per-option toggle remains interactive (user can re-check).
 * Category-filtered rows are read-only — the pool pills / advanced
 * expression are the authority. Clicking the per-option checkbox while
 * filtered would write to `enabled_options` invisibly and surprise the
 * user when they re-enable the category. So we no-op the click in that
 * case. The null option is never category-filtered (its membership is
 * governed by `exclude_null`, not the tag expression).
 */
const filteredByCategory = computed(() => {
  if (props.option.is_null) return false;
  const expr = (props.instance.category_filter ?? "").trim();
  if (expr === "") return false;
  return !matches(parse(expr), new Set(props.option.sub_categories ?? []));
});

/**
 * Per-axis chip colour. Each `tag_groups` axis gets a stable hue from a
 * small palette of graph-theme tokens so a tag reads with the same colour
 * here as in the pool pills. Ungrouped tags fall back to a neutral hue.
 * Returned as inline custom properties the scoped CSS consumes — keeps the
 * palette out of per-tag class explosions.
 */
const AXIS_HUES = [
  "var(--wp-kind-wildcard, #a78bfa)",
  "var(--wp-teal, #33d6c6)",
  "var(--wp-status-modified, #fb923c)",
  "var(--wp-accent2, #a970ff)",
  "var(--wp-success, #22c55e)",
];

function axisOf(tag: string): number {
  // Index of the axis whose member list contains `tag`; -1 when ungrouped.
  const axes = Object.keys(props.tagGroups);
  for (let i = 0; i < axes.length; i++) {
    if (props.tagGroups[axes[i]]?.includes(tag)) return i;
  }
  return -1;
}

function chipStyle(tag: string): Record<string, string> {
  const idx = axisOf(tag);
  if (idx < 0) return { "--chip-hue": "var(--wp-text-dim, var(--wp-text3))" };
  return { "--chip-hue": AXIS_HUES[idx % AXIS_HUES.length] };
}
const probability = computed(() =>
  probabilityFor(props.option, props.allOptions, props.instance, props.multiActive === true),
);
const weight = computed(() => effectiveWeight(props.option, props.instance));
const overrideWeight = computed(
  () => typeof props.instance.option_weights?.[props.option.id] === "number",
);

/** SP2a: the null option leaves the pool in multi-pick mode, so its row is
 *  inert. Only the null option is affected. */
const nullDisabledInMulti = computed(
  () => props.multiActive === true && props.option.is_null === true,
);
/** Combined "this row can't be toggled" signal for the checkbox. */
const interactionLocked = computed(
  () => filteredByCategory.value || nullDisabledInMulti.value,
);

function onToggle(): void {
  if (interactionLocked.value) return;
  emit("toggle", props.option.id);
}

/** Library default — used to clear the override map entry when the
 *  user types the same value back, so the row stops looking modified
 *  without forcing a manual reset. */
const libraryWeight = computed(() =>
  typeof props.option.weight === "number" ? props.option.weight : 1.0,
);

function emitWeight(next: number | null): void {
  if (next !== null && next === libraryWeight.value) {
    // Match library default → drop the override entry. Engine reads
    // the same value either way; clearing here keeps the visual
    // override-state honest.
    emit("weight", props.option.id, null);
    return;
  }
  emit("weight", props.option.id, next);
}

/** Minimum allowed weight. 0 or negative never picks (probability
 *  normalises away), so refusing them in the input is honest: to
 *  disable an option, use the per-row toggle (engine respects that).
 *  Floor at 0.01 leaves room for "low but possible" without silent
 *  zeroes from typos. */
const WEIGHT_MIN = 0.01;

function clampWeight(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : WEIGHT_MIN;
}

function onWeightInput(ev: Event): void {
  const raw = (ev.target as HTMLInputElement).value.trim();
  if (raw === "") {
    emit("weight", props.option.id, null);
    return;
  }
  const n = Number(raw);
  if (Number.isFinite(n)) {
    // Snap to 3 decimals so fuzz tails (e.g. autofill / native step that
    // beat our keydown intercept) don't leak into stored data, while
    // still honouring legit 2-decimal precision a user might type.
    const snapped = Math.round(n * 1000) / 1000;
    emitWeight(clampWeight(snapped));
  }
}

/** Route ArrowUp / ArrowDown / wheel through `bumpWeight()` so the
 *  step uses rounded math instead of the browser's native float step. */
function onWeightKeydown(ev: KeyboardEvent): void {
  if (ev.key === "ArrowUp") {
    ev.preventDefault();
    bumpWeight(1);
  } else if (ev.key === "ArrowDown") {
    ev.preventDefault();
    bumpWeight(-1);
  }
}
function onWeightWheel(ev: WheelEvent): void {
  const target = ev.target as HTMLInputElement;
  if (document.activeElement !== target) return;
  ev.preventDefault();
  bumpWeight(ev.deltaY < 0 ? 1 : -1);
}

const WEIGHT_STEP = 0.1;

function bumpWeight(direction: 1 | -1): void {
  if (!enabled.value) return;
  // Round to 1 decimal so 1.0 + 0.1 doesn't drift to 1.0999... visually.
  const next = Math.max(
    WEIGHT_MIN,
    Math.round((weight.value + direction * WEIGHT_STEP) * 10) / 10,
  );
  emitWeight(next);
}

function fmtPct(p: number): string {
  return `${Math.round(p * 100)}%`;
}
</script>

<template>
  <div
    class="opt"
    :class="{
      'opt--on': enabled && !nullDisabledInMulti,
      'opt--off': !enabled || nullDisabledInMulti,
      'opt--weighted': overrideWeight,
      'opt--filtered': filteredByCategory,
    }"
  >
    <span
      class="opt__check"
      :class="{ 'opt__check--on': enabled && !nullDisabledInMulti }"
      data-test="opt-check"
      role="checkbox"
      :aria-checked="enabled"
      :aria-disabled="interactionLocked"
      :tabindex="interactionLocked ? -1 : 0"
      @click="onToggle"
      @keydown.space.prevent="onToggle"
    >
      <!-- Inline SVG checkmark instead of PrimeIcon: precise sizing
           (8×8 inside 14px box) without the icon-font's intrinsic
           line-height inflating the glyph past the box edge. -->
      <svg
        v-if="enabled && !nullDisabledInMulti"
        class="opt__check-tick"
        width="8"
        height="8"
        viewBox="0 0 12 12"
        aria-hidden="true"
      >
        <path d="M2.5 6.5 L5 9 L9.5 3.5"
              fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </span>
    <span class="opt__name" data-test="opt-name" :class="{ 'opt__name--null': option.is_null }">
      <span class="opt__name-main">
      <span
        v-if="option.is_null"
        class="opt__null-chip"
        aria-label="null option (resolves to empty)"
      >
        <i class="pi pi-ban" aria-hidden="true" />
        <span>null</span>
      </span>
      <template v-for="(tok, idx) in tokens" v-else :key="idx">
        <span
          v-if="tok.kind === 'ref'"
          class="opt__tok opt__tok--ref"
          :class="{
            'opt__tok--filtered': refFilter(tok).isFiltered,
            'opt__tok--unresolved': refIsUnresolved(tok.meta?.uuid),
          }"
          :data-uuid="tok.meta?.uuid"
          :title="refIsUnresolved(tok.meta?.uuid)
            ? `Reference ${tok.meta?.uuid} not in library`
            : (refFilter(tok).title || undefined)"
        >
          <span class="opt__tok-icon" aria-hidden="true">{{ refIsUnresolved(tok.meta?.uuid) ? '?' : '✦' }}</span>
          <span class="opt__tok-label">{{ refDisplay(tok.meta?.uuid, tok.meta?.name, tok.raw) }}</span>
          <!-- Compact filter mark, matching SPA RefChip: funnel = expression
               set (full expr in hover title), ban = null option excluded.
               The expression is never printed inline (it can be long). -->
          <span
            v-if="refFilter(tok).isFiltered"
            class="opt__tok-filter"
            aria-hidden="true"
          >
            <i v-if="refFilter(tok).hasExpr" class="pi pi-filter opt__tok-funnel"></i>
            <i v-if="refFilter(tok).excludeNull" class="pi pi-ban opt__tok-nonull"></i>
          </span>
        </span>
        <span
          v-else-if="tok.kind === 'var'"
          class="opt__tok opt__tok--var"
        >
          <span class="opt__tok-icon" aria-hidden="true">⌘</span>
          <span class="opt__tok-label">{{ tok.raw }}</span>
        </span>
        <span
          v-else-if="tok.kind === 'dp-brace'"
          class="opt__tok opt__tok--brace"
        >{{ tok.raw }}</span>
        <span
          v-else-if="tok.kind === 'dp-multi'"
          class="opt__tok opt__tok--multi"
        >{{ tok.raw }}</span>
        <span
          v-else-if="tok.kind === 'escape'"
          class="opt__tok opt__tok--escape"
        >{{ tok.raw }}</span>
        <template v-else>{{ tok.raw }}</template>
      </template>
      </span>
      <span v-if="pairBadges.length > 0" class="opt__pair-badges" data-test="opt-pair-badges">
        <PairBadge
          v-for="p in pairBadges"
          :key="`${p.number}-${p.targetUuid}`"
          :pair="p"
          variant="option"
        />
      </span>
    </span>
    <span class="opt__prob">
      <span class="opt__prob-bar" aria-hidden="true">
        <span :style="{ width: `${Math.round(probability * 100)}%` }" />
      </span>
      <span class="opt__prob-pct" data-test="opt-prob-pct">{{ fmtPct(probability) }}</span>
    </span>
    <span class="opt__weight-wrap" :class="{ 'opt__weight-wrap--off': !enabled }">
      <input
        class="opt__weight"
        data-test="opt-weight"
        type="number"
        step="0.1"
        min="0.01"
        :value="weight"
        :disabled="!enabled"
        :aria-label="`Weight for ${option.value}`"
        @input="onWeightInput"
        @keydown="onWeightKeydown"
        @wheel="onWeightWheel"
      />
      <span class="opt__spin">
        <button
          type="button"
          class="opt__spin-btn"
          data-test="opt-weight-up"
          tabindex="-1"
          :disabled="!enabled"
          :aria-label="`Increase weight for ${option.value}`"
          @click="bumpWeight(1)"
        ><svg width="6" height="4" viewBox="0 0 8 5" aria-hidden="true">
          <path d="M0 5 L4 0 L8 5 Z" fill="currentColor" />
        </svg></button>
        <button
          type="button"
          class="opt__spin-btn"
          data-test="opt-weight-down"
          tabindex="-1"
          :disabled="!enabled"
          :aria-label="`Decrease weight for ${option.value}`"
          @click="bumpWeight(-1)"
        ><svg width="6" height="4" viewBox="0 0 8 5" aria-hidden="true">
          <path d="M0 0 L4 5 L8 0 Z" fill="currentColor" />
        </svg></button>
      </span>
    </span>
    <span class="opt__cat">
      <span
        v-for="tag in (option.is_null ? [] : (option.sub_categories ?? []))"
        :key="tag"
        class="opt__cat-chip"
        :data-test="`opt-cat-${tag}`"
        :style="chipStyle(tag)"
      >{{ tag }}</span>
    </span>
  </div>
</template>

<style scoped>
.opt {
  display: grid;
  /* Columns: check · option name (1fr — generous for long values) ·
   * probability (compact, ~110px is enough for a 50px bar + 32px %
   * label) · weight input · category. The earlier 1fr-on-probability
   * stretched the bar past usefulness and squeezed the name. Category
   * widened from 60px → 96px now that it holds multiple wrapping tag
   * chips instead of one right-aligned label (§4.2). */
  grid-template-columns: 22px 1fr 110px 64px 96px;
  align-items: center;
  gap: 12px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
  font: 11px var(--wp-font-mono);
  color: var(--wp-text);
  cursor: pointer;
}
.opt:last-child { border-bottom: none; }
.opt:hover { background: var(--wp-row-hover, rgba(255, 255, 255, 0.02)); }
.opt__check {
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--wp-border-soft, var(--wp-border));
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: white;
  background: var(--wp-bg);
  flex-shrink: 0;
}
.opt__check-tick {
  display: block;
}
.opt__check--on {
  background: var(--wp-accent);
  border-color: var(--wp-accent);
}
/* Category-filtered rows are read-only — the chip controls them.
 * Show a "not-allowed" cursor + slight opacity so the user knows the
 * per-option checkbox is intentionally inert in this state. */
/* Any locked checkbox — category-filtered OR the null row in multi-pick —
 * reads as intentionally inert: not-allowed cursor + dimmed. Keyed on
 * aria-disabled so both lock reasons share one rule. */
.opt__check[aria-disabled="true"] {
  cursor: not-allowed;
  opacity: 0.45;
}
.opt--filtered { cursor: default; }
.opt__name {
  /* Outer cell is a flex row so the trailing pair-badge cluster
   * sticks to the right edge while the tokenised value text fills
   * the remaining width. Inner `.opt__name-main` holds the actual
   * inline tokens with the old display-inline behaviour. */
  display: flex;
  align-items: baseline;
  gap: 8px;
  font: 11px var(--wp-font-mono);
  color: var(--wp-text);
  line-height: 1.55;
}
.opt__name-main {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}
.opt__pair-badges {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
/* Null option chip — shown in place of the tokenised value when the
 * option carries is_null=true. Visually distinct from the regular
 * tokens so users see at a glance that this row resolves to nothing. */
.opt__null-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  background: color-mix(in srgb, var(--wp-text-muted, var(--wp-text2)) 12%, transparent);
  border: 1px dashed var(--wp-border-soft, var(--wp-border));
  border-radius: 3px;
  color: var(--wp-text-muted, var(--wp-text2));
  font: 10px var(--wp-font-mono);
}
.opt__null-chip .pi { font-size: 10px; }
.opt--off .opt__name {
  color: var(--wp-text-dim, var(--wp-text3));
  text-decoration: line-through;
}
/* The null chip is `display: inline-flex`, so the ancestor line-through on
 * `.opt__name` doesn't cross into it — strike it explicitly so a disabled
 * null row (e.g. excluded from a multi-pick pool) reads as cut-out. */
.opt--off .opt__null-chip {
  text-decoration: line-through;
  opacity: 0.7;
}
/* Inline-syntax chips inside option values. Matches the SPA's
 * `wp-refchip` palette + icon prefix so an `@nestedName` reads the
 * same on the canvas as in the SPA editor — purple ✦ for refs,
 * green ⌘ for vars, amber `· subcat` suffix when the ref carries a
 * sub-category filter. */
.opt__tok {
  margin: 0 1px;
  font-weight: 500;
  display: inline-flex;
  align-items: baseline;
  vertical-align: baseline;
}
.opt__tok--ref,
.opt__tok--var {
  border-radius: 3px;
  padding: 0 5px;
  gap: 3px;
  border: 1px solid;
  /* Match SPA RefChip dimensions: 10px font + 1.4 line-height so the
   * chip reads as a compact mark inside the option text, not a
   * second-class label competing with the text for vertical space.
   * Earlier 13px-inherit + 1px 6px padding made each chip ~28px tall
   * inside a 24px row, which clipped the chip ascender. */
  font: 10px/1.4 var(--wp-font-mono);
}
.opt__tok-icon { font-size: 8px; opacity: 0.75; }
/* Compact filter indicator — funnel (expression set) + optional ban
 * (null excluded). Mirrors RefChip's `wp-refchip__filter` so the canvas
 * + SPA chips read the same; full expression lives in the hover title. */
.opt__tok-filter {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 2px;
  color: var(--wp-status-modified, #fbbf24);
}
.opt__tok-funnel { font-size: 8px; line-height: 1; }
.opt__tok-nonull { font-size: 8px; line-height: 1; opacity: 0.85; }
.opt__tok--ref {
  background: color-mix(in srgb, var(--wp-kind-wildcard, #a855f7) 15%, transparent);
  border-color: color-mix(in srgb, var(--wp-kind-wildcard, #a855f7) 50%, transparent);
  color: var(--wp-kind-wildcard);
}
/* Unresolved ref — broken reference (target uuid not in library +
 * not in preview-resolver cache). Mirrors the SPA RefChip
 * `wp-refchip--unresolved` palette so the canvas + SPA chips read
 * the same broken-state grammar. Wins over the base `.opt__tok--ref`
 * accent via selector specificity. */
.opt__tok--ref.opt__tok--unresolved {
  background: color-mix(in srgb, var(--wp-danger, #ef4444) 15%, transparent);
  border-color: color-mix(in srgb, var(--wp-danger, #ef4444) 50%, transparent);
  color: var(--wp-danger, #ef4444);
  cursor: help;
}
.opt__tok--var {
  background: color-mix(in srgb, var(--wp-success, #22c55e) 15%, transparent);
  border-color: color-mix(in srgb, var(--wp-success, #22c55e) 50%, transparent);
  color: var(--wp-success);
}
/* Plain `{a|b|c}` inline-choice block — warn-tone yellow (matches the
 * SPA `wp-rt-dp-brace` palette in `manager/styles/rich-text.css`). */
.opt__tok--brace {
  color: var(--wp-warn, #fcd34d);
  font-weight: 600;
}
/* `{N$$sep$$a|b|c}` multi-pick block — distinct teal/green tone so users
 * can tell it apart from the plain brace block at a glance. Matches the
 * SPA `wp-rt-dp-multi` palette (`--wp-rt-token-good`). SP2b V2: colour only,
 * NO background / box (continuous block-coloured text) — same treatment the
 * SPA editor + preview now use for brace-block scaffolding. */
.opt__tok--multi {
  color: var(--wp-rt-token-good, #4ad4c4);
  font-weight: 500;
}
.opt__tok--escape {
  color: var(--wp-text-muted, var(--wp-text2));
  opacity: 0.7;
}
.opt--off .opt__tok {
  background: transparent;
  box-shadow: none;
  text-decoration: line-through;
  opacity: 0.65;
}
.opt__prob {
  display: flex;
  align-items: center;
  gap: 8px;
}
.opt__prob-bar {
  flex: 1;
  height: 4px;
  background: var(--wp-bg);
  border-radius: 2px;
  overflow: hidden;
}
.opt__prob-bar > span {
  display: block;
  height: 100%;
  background: var(--wp-accent);
  border-radius: 2px;
  transition: width var(--wp-motion-hover) ease;
}
.opt__prob-pct {
  font: 10px var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text2));
  width: 36px;
  text-align: right;
}
.opt--off .opt__prob-pct { color: var(--wp-text-dim, var(--wp-text3)); }
/* Weight input wrapper holds the number field plus a stacked custom
 * spinner pair. The wrapper carries the border + bg so the input and
 * spinner read as a single themed control. Native browser spinners
 * are hidden via `appearance: textfield` (FF) + ::-webkit pseudo
 * elements; the up/down buttons we render do the same job but
 * styled to fit the dark/light theme. */
.opt__weight-wrap {
  display: inline-flex;
  align-items: stretch;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: 2px;
  width: 100%;
  height: 22px;
  overflow: hidden;
}
.opt__weight-wrap:focus-within {
  border-color: var(--wp-accent);
}
.opt__weight {
  flex: 1;
  background: transparent;
  border: 0;
  padding: 0 6px;
  font: 10px var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text2));
  text-align: right;
  width: 100%;
  min-width: 0;
  -moz-appearance: textfield;
}
.opt__weight::-webkit-outer-spin-button,
.opt__weight::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.opt__weight:focus {
  outline: none;
  color: var(--wp-text);
}
.opt--weighted .opt__weight {
  color: var(--wp-accent-text, var(--wp-text));
}
.opt--weighted .opt__weight-wrap {
  border-color: var(--wp-accent);
}
.opt--off .opt__weight-wrap {
  background: transparent;
  border-color: var(--wp-border-soft, var(--wp-border));
}
.opt--off .opt__weight {
  color: var(--wp-text-dim, var(--wp-text3));
}
.opt__spin {
  display: flex;
  flex-direction: column;
  width: 14px;
  flex-shrink: 0;
  border-left: 1px solid var(--wp-border);
  background: var(--wp-bg-deep, var(--wp-bg));
}
.opt__spin-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  padding: 0;
  margin: 0;
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
  line-height: 0;
}
.opt__spin-btn + .opt__spin-btn {
  border-top: 1px solid var(--wp-border);
}
.opt__spin-btn:hover { color: var(--wp-accent-text, var(--wp-text)); background: rgba(99,102,241,0.10); }
.opt__spin-btn:disabled {
  cursor: not-allowed;
  color: var(--wp-text-dim, var(--wp-text3));
  opacity: 0.4;
  background: transparent;
}
/* CATEGORY column — option's sub-category tags as small chips, one per
 * axis-coloured tag. Wraps + right-aligns so multi-tag options stay
 * readable in the narrow column. Read-only here (membership is edited in
 * the SPA library editor, §4.3). */
.opt__cat {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  justify-content: flex-end;
  align-content: center;
}
.opt__cat-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  border-radius: 999px;
  font: 8px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  white-space: nowrap;
  color: var(--chip-hue, var(--wp-text-dim, var(--wp-text3)));
  border: 1px solid color-mix(in srgb, var(--chip-hue, var(--wp-text3)) 45%, transparent);
  background: color-mix(in srgb, var(--chip-hue, var(--wp-text3)) 13%, transparent);
}
.opt--off .opt__cat-chip {
  opacity: 0.5;
}
</style>
