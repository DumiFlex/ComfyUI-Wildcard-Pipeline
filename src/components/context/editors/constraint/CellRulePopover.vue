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
import WpButton from "../../../shared/WpButton.vue";

type RuleState = "neutral" | "exclude" | "boost" | "reduce" | "only";

const STATES: { state: RuleState; glyph: string; label: string; hint?: string }[] = [
  { state: "neutral", glyph: "·", label: "Neutral" },
  { state: "exclude", glyph: "×", label: "Exclude" },
  { state: "boost", glyph: "↑", label: "Boost" },
  { state: "reduce", glyph: "↓", label: "Reduce" },
  {
    state: "only",
    glyph: "✓",
    label: "Only",
    hint: "Guest list: when this source tag fires, the target only picks options this row has a rule for (boost and reduce keep their odds)",
  },
];

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
  <div class="pop">
    <div class="pop-title">Cell rule</div>
    <div class="pop-states">
      <WpButton
        v-for="b in STATES"
        :key="b.state"
        class="pop-btn"
        :class="[`b-${b.state}`, { active: state === b.state }]"
        :pressed="state === b.state"
        :hint="b.hint"
        @click="pickState(b.state)"
      >
        <span class="b-glyph" aria-hidden="true">{{ b.glyph }}</span> {{ b.label }}
      </WpButton>
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
      <WpButton
        variant="ghost"
        icon="pi-replay"
        class="pop-reset"
        hint="Reset cell to library default"
        @click="onReset"
      >Reset to library</WpButton>
    </div>

    <div class="pop-hint">Click outside or press Esc to close</div>
  </div>
</template>

<style scoped>
/* The shared Popover draws the panel (background, border, shadow); this is
 * only its content. */
.pop {
  width: 236px;
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
/* WpButton carries the size, focus ring and hover; the compound selectors
 * beat its scoped rules on a tie. Each state wears its matrix colour once
 * picked. */
.wp-btn.pop-btn {
  gap: 6px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.pop-btn .b-glyph { font: 13px var(--wp-font-mono, monospace); line-height: 1; }
.wp-btn.pop-btn.b-only { grid-column: 1 / -1; } /* fifth button spans the grid so it stays even */
.wp-btn.pop-btn.active { --pop-tone: var(--wp-text); }
.wp-btn.pop-btn.b-exclude.active { --pop-tone: var(--wp-danger); }
.wp-btn.pop-btn.b-boost.active { --pop-tone: var(--wp-success); }
.wp-btn.pop-btn.b-reduce.active { --pop-tone: var(--wp-warn); }
.wp-btn.pop-btn.b-only.active { --pop-tone: var(--wp-info); }
.wp-btn.pop-btn.active {
  background: color-mix(in srgb, var(--pop-tone) 20%, transparent);
  border-color: color-mix(in srgb, var(--pop-tone) 50%, transparent);
  color: var(--pop-tone);
}
.wp-btn.pop-btn.b-neutral.active { background: color-mix(in srgb, var(--wp-text) 10%, transparent); }
.pop-note {
  margin: -2px 0 8px;
  font: 10px var(--wp-font-sans, sans-serif);
  color: var(--wp-text-muted, #8a8d99);
  line-height: 1.4;
}

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

.pop-hint {
  margin-top: 6px;
  font: 9px var(--wp-font-mono, monospace);
  color: var(--wp-text-dim, #595c66);
  text-align: right;
}
</style>
