<script setup lang="ts">
/**
 * CellRulePopover — body of the constraint-matrix cell editor.
 *
 * Renders four labeled state buttons (NEUTRAL/EXCLUDE/BOOST/REDUCE) plus
 * a numeric factor input (boost / reduce only) and an optional "Reset"
 * button shown when the caller signals there's an override to clear.
 *
 * Stateless: props in, emits out. The popover never closes itself —
 * the parent owns close via outside-click / Escape. Picking a state or
 * typing a factor keeps the popover open so the user can keep tweaking.
 */
import { computed, nextTick, onMounted, ref, watch } from "vue";

type RuleState = "neutral" | "exclude" | "boost" | "reduce";

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

const factorInput = ref<HTMLInputElement | null>(null);
const factorStr = ref<string>("");
const showFactor = computed(() => props.state === "boost" || props.state === "reduce");
const stepValue = 0.1;

/** Initialise the displayed factor string. `factorStr` is the LOCAL
 *  source of truth while the popover is open — incoming `props.factor`
 *  only feeds the initial value (and re-syncs on STATE transitions so
 *  entering boost/reduce shows the right default). We deliberately do
 *  NOT watch `props.factor` because every keystroke fires an `update:factor`
 *  event that round-trips through the parent and re-arrives as a new
 *  `props.factor`; reacting to that would call `.select()` on every digit
 *  the user types, clobbering their input. */
onMounted(() => {
  factorStr.value = props.factor.toFixed(1);
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
    factorStr.value = props.factor.toFixed(1);
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

function onFactorInput(ev: Event): void {
  const raw = (ev.target as HTMLInputElement).value;
  factorStr.value = raw;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) {
    // Snap to 3 decimals on emit so fuzz tails (e.g. paste of
    // `1.2999999999999998`, autofill, or a stray native step that beat
    // our keydown intercept) don't leak into stored data, while still
    // honouring legit 2-decimal precision a user might type.
    const snapped = Math.round(n * 1000) / 1000;
    emit("update:factor", snapped);
  }
}

/** Arrow-key + scroll-wheel stepping on a `<input type="number">` is
 *  handled natively by the browser and produces classic float fuzz
 *  (e.g. `1.4 - 0.1 = 1.2999999999999998`). Intercept both and route
 *  them through `bump()` so the value snaps to one-decimal precision. */
function onFactorKeydown(ev: KeyboardEvent): void {
  if (ev.key === "ArrowUp") {
    ev.preventDefault();
    bump(1);
  } else if (ev.key === "ArrowDown") {
    ev.preventDefault();
    bump(-1);
  }
}
function onFactorWheel(ev: WheelEvent): void {
  if (document.activeElement !== factorInput.value) return;
  ev.preventDefault();
  bump(ev.deltaY < 0 ? 1 : -1);
}

/** Step the value by ±0.1, clamped to > 0. Rounds to 1 decimal so
 *  `1 + 0.1` doesn't surface JS float fuzz (`1.0000000000000002`). */
function bump(direction: 1 | -1): void {
  const current = Number(factorStr.value) || props.factor || 1;
  let next = current + direction * stepValue;
  if (next <= 0) next = stepValue;
  next = Math.round(next * 10) / 10;
  factorStr.value = next.toFixed(1);
  emit("update:factor", next);
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
    </div>

    <div v-if="showFactor" class="pop-factor">
      <label class="pop-factor__label">Factor ×</label>
      <span class="pop-num">
        <input
          ref="factorInput"
          class="pop-num__field"
          type="number"
          step="0.1"
          min="0.1"
          :value="factorStr"
          aria-label="Factor multiplier"
          @input="onFactorInput"
          @keydown="onFactorKeydown"
          @wheel="onFactorWheel"
        />
        <span class="pop-num__spin">
          <button
            type="button"
            class="pop-num__btn"
            tabindex="-1"
            aria-label="Increase factor"
            @click="bump(1)"
          ><svg width="6" height="4" viewBox="0 0 8 5" aria-hidden="true">
            <path d="M0 5 L4 0 L8 5 Z" fill="currentColor" />
          </svg></button>
          <button
            type="button"
            class="pop-num__btn"
            tabindex="-1"
            aria-label="Decrease factor"
            @click="bump(-1)"
          ><svg width="6" height="4" viewBox="0 0 8 5" aria-hidden="true">
            <path d="M0 0 L4 5 L8 0 Z" fill="currentColor" />
          </svg></button>
        </span>
      </span>
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
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.6);
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
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  font: 600 10px var(--wp-font-sans, sans-serif);
  color: var(--wp-text-muted, #8a8d99);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.pop-btn:hover { color: var(--wp-text, #fff); border-color: var(--wp-border-strong, #4a4d55); }
.pop-btn .b-glyph { font: 13px var(--wp-font-mono, monospace); line-height: 1; }
.pop-btn.b-neutral.active { background: rgba(255, 255, 255, 0.10); color: var(--wp-text, #fff); border-color: rgba(255, 255, 255, 0.4); }
.pop-btn.b-exclude.active { background: color-mix(in srgb, var(--wp-danger, #ef4444) 35%, transparent); color: var(--wp-text, #fff); border-color: color-mix(in srgb, var(--wp-danger, #ef4444) 70%, transparent); }
.pop-btn.b-boost.active   { background: color-mix(in srgb, var(--wp-success, #22c55e) 35%, transparent); color: var(--wp-text, #fff); border-color: color-mix(in srgb, var(--wp-success, #22c55e) 70%, transparent); }
.pop-btn.b-reduce.active  { background: color-mix(in srgb, var(--wp-warn, #f97316) 35%, transparent); color: var(--wp-text, #fff); border-color: color-mix(in srgb, var(--wp-warn, #f97316) 70%, transparent); }

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
.pop-num {
  flex: 1;
  display: inline-flex;
  align-items: stretch;
  background: var(--wp-bg-deep, var(--wp-bg, #0e1015));
  border: 1px solid var(--wp-border, #353841);
  border-radius: 3px;
  overflow: hidden;
  height: 24px;
}
.pop-num:focus-within { border-color: var(--wp-accent, #c4b5fd); }
.pop-num__field {
  flex: 1;
  background: transparent;
  border: 0;
  padding: 0 8px;
  font: 600 12px var(--wp-font-mono, monospace);
  color: var(--wp-text, #fff);
  text-align: right;
  width: 0;
  min-width: 0;
  -moz-appearance: textfield;
}
.pop-num__field::-webkit-outer-spin-button,
.pop-num__field::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.pop-num__field:focus { outline: none; }
.pop-num__spin {
  display: flex;
  flex-direction: column;
  width: 16px;
  flex-shrink: 0;
  border-left: 1px solid var(--wp-border, #353841);
  background: var(--wp-bg-deep, var(--wp-bg, #0e1015));
}
.pop-num__btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  padding: 0;
  margin: 0;
  color: var(--wp-text-dim, var(--wp-text-muted, #8a8d99));
  cursor: pointer;
  line-height: 0;
}
.pop-num__btn + .pop-num__btn {
  border-top: 1px solid var(--wp-border, #353841);
}
.pop-num__btn:hover {
  color: var(--wp-accent-text, var(--wp-text, #fff));
  background: color-mix(in srgb, var(--wp-accent, #c4b5fd) 12%, transparent);
}

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
  color: var(--wp-accent-text, var(--wp-accent, #c4b5fd));
  border-color: var(--wp-accent, #c4b5fd);
  background: color-mix(in srgb, var(--wp-accent, #c4b5fd) 10%, transparent);
}
.pop-reset__glyph { font: 12px var(--wp-font-mono, monospace); line-height: 1; }

.pop-hint {
  margin-top: 6px;
  font: 9px var(--wp-font-mono, monospace);
  color: var(--wp-text-dim, #595c66);
  text-align: right;
}
</style>
