<script setup lang="ts">
import { computed } from "vue";
import {
  effectiveWeight,
  isEnabled,
  probabilityFor,
  type InstanceLike,
  type WildcardOption,
} from "../probability";
import { tokenizeRich, type RichToken } from "../../../../../widgets/richTokenize";
import { cacheVersion, ensure, lookup } from "../../../../../extension/preview-resolver";

interface OptionFull extends WildcardOption {
  value: string;
}

const props = defineProps<{
  option: OptionFull;
  allOptions: readonly OptionFull[];
  instance: InstanceLike;
}>();

const emit = defineEmits<{
  "toggle": [optionId: string];
  "weight": [optionId: string, weight: number | null];
}>();

const enabled = computed(() => isEnabled(props.option, props.instance));

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
const tokens = computed<RichToken[]>(() => {
  void cacheVersion.value;
  const toks = tokenizeRich(props.option.value ?? "");
  const uuids = toks
    .filter((t) => t.kind === "ref")
    .map((t) => t.meta?.uuid)
    .filter((u): u is string => typeof u === "string");
  if (uuids.length > 0) ensure(uuids);
  return toks;
});

function refDisplay(uuid: string | undefined, raw: string): string {
  if (!uuid) return raw;
  const hit = lookup(uuid);
  if (hit?.varBinding && hit.varBinding.trim()) return `@${hit.varBinding.trim()}`;
  if (hit?.name && hit.name.trim()) return `@${hit.name.trim()}`;
  return raw;
}

/** Distinguish two reasons a row might be disabled:
 *   - per-option toggle off (`enabled_options` array excludes this id)
 *   - sub-category filtered out (`category_filter` excludes this option's bucket)
 *
 * Per-option toggle remains interactive (user can re-check).
 * Category-filtered rows are read-only — the sub-category chip is the
 * authority. Clicking the per-option checkbox while filtered would write
 * to `enabled_options` invisibly and surprise the user when they re-enable
 * the category. So we no-op the click in that case.
 */
const filteredByCategory = computed(() => {
  const filter = props.instance.category_filter;
  if (!Array.isArray(filter) || filter.length === 0) return false;
  if (!props.option.sub_category) return true;
  return !filter.includes(props.option.sub_category);
});
const probability = computed(() => probabilityFor(props.option, props.allOptions, props.instance));
const weight = computed(() => effectiveWeight(props.option, props.instance));
const overrideWeight = computed(
  () => typeof props.instance.option_weights?.[props.option.id] === "number",
);

function onToggle(): void {
  if (filteredByCategory.value) return;
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

function onWeightInput(ev: Event): void {
  const raw = (ev.target as HTMLInputElement).value.trim();
  if (raw === "") {
    emit("weight", props.option.id, null);
    return;
  }
  const n = Number(raw);
  if (Number.isFinite(n)) {
    emitWeight(n);
  }
}

const WEIGHT_STEP = 0.1;

function bumpWeight(direction: 1 | -1): void {
  if (!enabled.value) return;
  // Round to 1 decimal so 1.0 + 0.1 doesn't drift to 1.0999... visually.
  const next = Math.max(0, Math.round((weight.value + direction * WEIGHT_STEP) * 10) / 10);
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
      'opt--on': enabled,
      'opt--off': !enabled,
      'opt--weighted': overrideWeight,
      'opt--filtered': filteredByCategory,
    }"
  >
    <span
      class="opt__check"
      :class="{ 'opt__check--on': enabled }"
      data-test="opt-check"
      role="checkbox"
      :aria-checked="enabled"
      :aria-disabled="filteredByCategory"
      :tabindex="filteredByCategory ? -1 : 0"
      @click="onToggle"
      @keydown.space.prevent="onToggle"
    >
      <!-- Inline SVG checkmark instead of PrimeIcon: precise sizing
           (8×8 inside 14px box) without the icon-font's intrinsic
           line-height inflating the glyph past the box edge. -->
      <svg
        v-if="enabled"
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
    <span class="opt__name" data-test="opt-name">
      <template v-for="(tok, idx) in tokens" :key="idx">
        <span
          v-if="tok.kind === 'ref'"
          class="opt__tok opt__tok--ref"
          :data-uuid="tok.meta?.uuid"
        >{{ refDisplay(tok.meta?.uuid, tok.raw) }}</span>
        <span
          v-else-if="tok.kind === 'var'"
          class="opt__tok opt__tok--var"
        >{{ tok.raw }}</span>
        <span
          v-else-if="tok.kind === 'dp-brace' || tok.kind === 'dp-multi'"
          class="opt__tok opt__tok--dp"
        >{{ tok.raw }}</span>
        <span
          v-else-if="tok.kind === 'escape'"
          class="opt__tok opt__tok--escape"
        >{{ tok.raw }}</span>
        <template v-else>{{ tok.raw }}</template>
      </template>
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
        min="0"
        :value="weight"
        :disabled="!enabled"
        :aria-label="`Weight for ${option.value}`"
        @input="onWeightInput"
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
    <span class="opt__cat" data-test="opt-cat">{{ option.sub_category ?? "" }}</span>
  </div>
</template>

<style scoped>
.opt {
  display: grid;
  /* Columns: check · option name (1fr — generous for long values) ·
   * probability (compact, ~110px is enough for a 50px bar + 32px %
   * label) · weight input · category. The earlier 1fr-on-probability
   * stretched the bar past usefulness and squeezed the name. */
  grid-template-columns: 22px 1fr 110px 64px 60px;
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
.opt--filtered .opt__check {
  cursor: not-allowed;
  opacity: 0.45;
}
.opt--filtered { cursor: default; }
.opt__name {
  font: 11px var(--wp-font-mono);
  color: var(--wp-text);
  /* Stay `display: inline` so whitespace between text/pill tokens
   * renders naturally — `inline-flex` collapsed the spaces and the
   * pills butted up against the surrounding words. */
  line-height: 1.55;
  word-break: break-word;
}
.opt--off .opt__name {
  color: var(--wp-text-dim, var(--wp-text3));
  text-decoration: line-through;
}
/* Inline-syntax chips inside option values. Mirror the SPA's
 * rich-text.css colour palette so an `@nestedName` reads the same
 * here as in the SPA editor — wildcard pink for refs, accent violet
 * for vars, warn yellow for choice-blocks, muted for escapes. */
.opt__tok {
  border-radius: 3px;
  padding: 0 4px;
  margin: 0 1px;
  font-weight: 500;
  /* Inline-block so vertical padding + box-shadow render without
   * interfering with the surrounding line's baseline. */
  display: inline-block;
  vertical-align: baseline;
}
.opt__tok--ref {
  color: var(--wp-kind-wildcard, #f0abfc);
  background: color-mix(in oklab, var(--wp-kind-wildcard, #c026d3) 22%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--wp-kind-wildcard, #c026d3) 45%, transparent);
}
.opt__tok--var {
  color: var(--wp-accent-text-strong, var(--wp-accent-text, #c4b5fd));
  background: color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 22%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 45%, transparent);
}
.opt__tok--dp {
  color: var(--wp-warn, #fcd34d);
  font-weight: 600;
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
.opt__cat {
  font: 9px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
  text-transform: uppercase;
  letter-spacing: 0.08em;
  text-align: right;
}
</style>
