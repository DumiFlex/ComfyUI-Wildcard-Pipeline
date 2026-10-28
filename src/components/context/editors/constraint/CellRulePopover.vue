<script setup lang="ts">
/**
 * CellRulePopover — body of the constraint-matrix cell editor.
 *
 * Renders five labeled state buttons (NEUTRAL/EXCLUDE/BOOST/REDUCE/ONLY) plus
 * a numeric factor input (boost / reduce only) and an optional "Reset"
 * button shown when the caller signals there's an override to clear.
 *
 * Stateless: props in, emits out. The popover never closes itself —
 * the parent owns close via outside-click / Escape. Picking a state or
 * typing a factor keeps the popover open so the user can keep tweaking.
 */
import WpNumber from "../../../shared/WpNumber.vue";
import { computed, nextTick, onMounted, ref, watch } from "vue";

type RuleState = "neutral" | "exclude" | "boost" | "reduce" | "only";

const props = withDefaults(
  defineProps<{
    state: RuleState;
    factor: number;
    srcLabel: string;
    tgtLabel: string;
    canReset?: boolean;
  }>(),
  { canReset: false },
);

const emit = defineEmits<{
  "update:state": [next: RuleState];
  "update:factor": [value: number];
  "reset": [];
  "close": [];
}>();

const factorInput = ref<InstanceType<typeof WpNumber> | null>(null);
const factorVal = ref<number>(props.factor);
const showFactor = computed(() => props.state === "boost" || props.state === "reduce");
const stepValue = 0.1;

/** Initialise the displayed factor. `factorVal` is the LOCAL
 *  source of truth while the popover is open — incoming `props.factor`
 *  only feeds the initial value (and re-syncs on STATE transitions so
 *  entering boost/reduce shows the right default). We deliberately do
 *  NOT watch `props.factor` because every keystroke fires an `update:factor`
 *  event that round-trips through the parent and re-arrives as a new
 *  `props.factor`; reacting to that would call `.select()` on every digit
 *  the user types, clobbering their input. */
onMounted(() => {
  factorVal.value = props.factor;
  if (showFactor.value) {
    void nextTick(() => {
      factorInput.value?.focus();
      factorInput.value?.select();
    });
  }
});

watch(
  () => props.state,
  () => {
    // Mode changed — re-sync the displayed value to the freshly defaulted
    // factor (commitMode in the parent sets boost=1.5 / reduce=0.5 when
    // entering from a non-factor state) and re-focus the input so the
    // user can immediately tweak.
    factorVal.value = props.factor;
    if (showFactor.value) {
      void nextTick(() => {
        factorInput.value?.focus();
        factorInput.value?.select();
      });
    }
  },
);

function pickState(next: RuleState): void {
  emit("update:state", next);
}

/** Typed or stepped factor. WpNumber snaps float fuzz and steps by 0.1;
 *  anything not above zero is ignored until a real factor lands. */
function onFactor(n: number | null): void {
  if (n === null || !Number.isFinite(n) || n <= 0) return;
  factorVal.value = n;
  emit("update:factor", n);
}

function onReset(): void {
  emit("reset");
}
</script>

<template>
  <div class="pop" role="dialog" :aria-label="`Rule for ${srcLabel} to ${tgtLabel}`">
    <div class="pop-title">Cell rule</div>
    <div class="pop-states">
      <button
        type="button"
        class="pop-btn b-neutral"
        :class="{ active: state === 'neutral' }"
        :aria-pressed="state === 'neutral'"
        @click="pickState('neutral')"
      >
        <span class="b-glyph">·</span> Neutral
      </button>
      <button
        type="button"
        class="pop-btn b-exclude"
        :class="{ active: state === 'exclude' }"
        :aria-pressed="state === 'exclude'"
        @click="pickState('exclude')"
      >
        <span class="b-glyph">×</span> Exclude
      </button>
      <button
        type="button"
        class="pop-btn b-boost"
        :class="{ active: state === 'boost' }"
        :aria-pressed="state === 'boost'"
        @click="pickState('boost')"
      >
        <span class="b-glyph">↑</span> Boost
      </button>
      <button
        type="button"
        class="pop-btn b-reduce"
        :class="{ active: state === 'reduce' }"
        :aria-pressed="state === 'reduce'"
        @click="pickState('reduce')"
      >
        <span class="b-glyph">↓</span> Reduce
      </button>
      <button
        type="button"
        class="pop-btn b-only"
        :class="{ active: state === 'only' }"
        :aria-pressed="state === 'only'"
        title="Guest list: when this source tag fires, the target only picks options this row has a rule for (boost and reduce keep their odds)"
        @click="pickState('only')"
      >
        <span class="b-glyph">✓</span> Only
      </button>
    </div>
    <div v-if="state === 'only'" class="pop-note">
      Every target in this row without a rule of its own is excluded when {{ srcLabel }} fires.
    </div>

    <div v-if="showFactor" class="pop-factor">
      <label class="pop-factor__label">Factor ×</label>
      <WpNumber
        ref="factorInput"
        class="pop-num"
        :model-value="factorVal"
        :min="stepValue"
        :step="stepValue"
        commit="input"
        aria-label="Factor multiplier"
        up-label="Increase factor"
        down-label="Decrease factor"
        @update:model-value="onFactor"
      />
    </div>

    <div v-if="canReset" class="pop-foot">
      <button
        type="button"
        class="pop-reset"
        aria-label="Reset cell to library default"
        @click="onReset"
      >
        <span class="pop-reset__glyph" aria-hidden="true">↺</span> Reset to library
      </button>
    </div>

    <div class="pop-hint">Click outside or press Esc to close</div>
  </div>
</template>

<style scoped>
.pop {
  /* Opaque background — earlier `var(--wp-bg2)` resolved to the host's
   * variable which is sometimes transparent (e.g. canvas overlay
   * contexts). Hard fallback chain keeps the popover legible across
   * extension + SPA mounts. */
  background-color: #1a1d24;
  background-color: var(--wp-bg-1, var(--wp-bg2, #1a1d24));
  border: 1px solid var(--wp-border-strong, var(--wp-border, #353841));
  border-radius: 6px;
  padding: 10px;
  box-shadow: var(--wp-shadow-md);
  min-width: 240px;
  font: 11px var(--wp-font-sans, sans-serif);
  color: var(--wp-text, #e0e0e8);
}
.pop-title {
  font: 600 9px var(--wp-font-sans, sans-serif);
  color: var(--wp-text-dim, var(--wp-text-muted, #8a8d99));
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
}

.pop-states {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
  margin-bottom: 8px;
}
.pop-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
  padding: 8px 6px;
  border: 1px solid var(--wp-border, #2a2d35);
  border-radius: 4px;
  background: color-mix(in srgb, var(--wp-text) 2%, transparent);
  cursor: pointer;
  font: 600 10px var(--wp-font-sans, sans-serif);
  color: var(--wp-text-muted, #8a8d99);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.pop-btn:hover { color: var(--wp-text); border-color: var(--wp-border-strong, #4a4d55); }
.pop-btn .b-glyph { font: 13px var(--wp-font-mono, monospace); line-height: 1; }
.pop-btn.b-neutral.active {
  background: color-mix(in srgb, var(--wp-text) 10%, transparent);
  color: var(--wp-text);
  border-color: color-mix(in srgb, var(--wp-text) 40%, transparent);
}
.pop-btn.b-exclude.active { background: color-mix(in srgb, var(--wp-danger, #ef4444) 22%, transparent); color: var(--wp-danger); border-color: color-mix(in srgb, var(--wp-danger, #ef4444) 50%, transparent); }
.pop-btn.b-boost.active   { background: color-mix(in srgb, var(--wp-success, #22c55e) 22%, transparent); color: var(--wp-success); border-color: color-mix(in srgb, var(--wp-success, #22c55e) 50%, transparent); }
.pop-btn.b-only {
  /* Fifth button spans the grid so the 2-column layout stays even. */
  grid-column: 1 / -1;
}
.pop-btn.b-only.active    { background: color-mix(in srgb, var(--wp-info, #3b82f6) 22%, transparent); color: var(--wp-info, #3b82f6); border-color: color-mix(in srgb, var(--wp-info, #3b82f6) 50%, transparent); }
.pop-note {
  margin: -2px 0 8px;
  font: 10px var(--wp-font-sans, sans-serif);
  color: var(--wp-text-muted, #8a8d99);
  line-height: 1.4;
}
.pop-btn.b-reduce.active  { background: color-mix(in srgb, var(--wp-warn, #f97316) 22%, transparent); color: var(--wp-warn); border-color: color-mix(in srgb, var(--wp-warn, #f97316) 50%, transparent); }

/* ── Factor input — wrap + stacked stepper, mirrors OptionRow's
 * `opt__weight-wrap + opt__spin` pattern so users see one consistent
 * numeric control across the extension. */
.pop-factor {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--wp-border, #2a2d35);
  font: 10px var(--wp-font-sans, sans-serif);
  color: var(--wp-text-muted, #8a8d99);
}
.pop-factor__label {
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
}
.pop-num { flex: 1; }

/* ── Reset button ───────────────────────────────────────────── */
.pop-foot {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--wp-border, #2a2d35);
  display: flex;
  justify-content: flex-end;
}
.pop-reset {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: transparent;
  border: 1px solid var(--wp-border, #353841);
  border-radius: 4px;
  color: var(--wp-text-muted, #8a8d99);
  font: 600 10px var(--wp-font-sans, sans-serif);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  cursor: pointer;
}
.pop-reset:hover {
  color: var(--wp-accent-text, var(--wp-accent, #6366f1));
  border-color: var(--wp-accent, #6366f1);
  background: color-mix(in srgb, var(--wp-accent, #6366f1) 10%, transparent);
}
.pop-reset__glyph { font: 12px var(--wp-font-mono, monospace); line-height: 1; }

.pop-hint {
  margin-top: 6px;
  font: 9px var(--wp-font-mono, monospace);
  color: var(--wp-text-dim, #595c66);
  text-align: right;
}
</style>
