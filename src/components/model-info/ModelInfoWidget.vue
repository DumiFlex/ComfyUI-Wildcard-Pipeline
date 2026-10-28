<script setup lang="ts">
/**
 * ModelInfoWidget — DOM widget for WP_ModelInfo.
 *
 * Two sections:
 *  - DETECTED: the three variables the node writes, each with where the value
 *    comes from and a pin. A pinned value replaces detection (the old
 *    `*_override` inputs). The family needs the loaded model, so before the
 *    first run it reads "after a run" unless pinned.
 *  - VARIANT RULES: `variant` + `pattern` rows, first match wins. The row
 *    matching the current file name is lit, a broken row is outlined red.
 *
 * Value contract: `modelValue` is a `ModelInfoConfig`; every edit emits the
 * whole next config (`src/widgets/model_info.ts` serializes it).
 */
import { computed, nextTick, ref } from "vue";
import WpButton from "../shared/WpButton.vue";
import WpIconButton from "../shared/WpIconButton.vue";
import {
  DEFAULT_VARIANT_RULES,
  compileVariantRules,
  matchRule,
  modelStem,
  type ModelInfoConfig,
  type ModelInfoRun,
  type VariantRuleRow,
} from "../../extension/model-info";

const props = withDefaults(
  defineProps<{
    modelValue: ModelInfoConfig;
    /** File name of the loader behind the `model` wire, read live. */
    loaderName?: string;
    modelWired?: boolean;
    lastRun?: ModelInfoRun | null;
    /** Litegraph mode: 2 = muted, 4 = bypassed (dims the widget). */
    nodeMode?: number;
  }>(),
  { loaderName: "", modelWired: false, lastRun: null, nodeMode: 0 },
);
const emit = defineEmits<{ "update:modelValue": [next: ModelInfoConfig] }>();

type Key = "family" | "variant" | "name";

const isSkipped = computed(() => props.nodeMode === 2 || props.nodeMode === 4);

const compiled = computed(() => compileVariantRules(props.modelValue.rules));
const problemByRow = computed(() => {
  const out = new Map<number, string>();
  compiled.value.problemRows.forEach((row, i) => out.set(row, compiled.value.problems[i] ?? ""));
  return out;
});

const detectedName = computed(() => (props.loaderName ? modelStem(props.loaderName) : ""));
const effectiveName = computed(() => (props.modelValue.name ? modelStem(props.modelValue.name) : detectedName.value));
const matched = computed(() => matchRule(effectiveName.value, compiled.value.rules));

interface Row { key: Key; label: string; variable: string; value: string; source: string; hint: string }

const rows = computed<Row[]>(() => {
  const cfg = props.modelValue;
  const family: Row = {
    key: "family",
    label: "family",
    variable: "$model_family",
    value: cfg.family || props.lastRun?.family || "",
    source: cfg.family ? "pinned" : props.lastRun?.family ? "from model" : "",
    hint: props.modelWired ? "after a run" : "wire a model",
  };
  const variant: Row = {
    key: "variant",
    label: "variant",
    variable: "$model_variant",
    value: cfg.variant || matched.value?.variant || "",
    source: cfg.variant ? "pinned" : matched.value ? `rule ${matched.value.row + 1}` : "",
    hint: effectiveName.value ? "no rule matched" : "needs a file name",
  };
  const name: Row = {
    key: "name",
    label: "name",
    variable: "$model_name",
    value: effectiveName.value,
    source: cfg.name ? "pinned" : detectedName.value ? "from loader" : "",
    hint: props.modelWired ? "no file name found" : "wire a model",
  };
  return [family, variant, name];
});

const ROW_TOOLTIPS: Record<Key, string> = {
  family: "The architecture (sd15, sdxl, flux, …), read from the loaded model when the node runs.",
  variant: "The fine-tune lineage (pony, illustrious, …): the first rule below whose pattern is in the file name.",
  name: "The checkpoint file name without folders or extension, read from the loader the model comes from.",
};

/* ── pins ─────────────────────────────────────────────────────────────── */

const editing = ref<Key | null>(null);
const pinInputs = ref<Partial<Record<Key, HTMLInputElement | null>>>({});

function isPinned(k: Key): boolean {
  return !!props.modelValue[k];
}
function setPin(k: Key, value: string): void {
  emit("update:modelValue", { ...props.modelValue, [k]: value.trim() });
}
async function startPin(row: Row): Promise<void> {
  if (isPinned(row.key)) {
    setPin(row.key, "");
    editing.value = null;
    return;
  }
  if (row.value) setPin(row.key, row.value);
  editing.value = row.key;
  await nextTick();
  pinInputs.value[row.key]?.select();
}
function onPinBlur(k: Key, ev: Event): void {
  setPin(k, (ev.target as HTMLInputElement).value);
  if (editing.value === k) editing.value = null;
}
function showsInput(k: Key): boolean {
  return isPinned(k) || editing.value === k;
}

/* ── internal (hidden from the Assembler) ─────────────────────────────── */

function isInternal(k: Key): boolean {
  return props.modelValue.internal[k];
}
function toggleInternal(k: Key): void {
  emit("update:modelValue", {
    ...props.modelValue,
    internal: { ...props.modelValue.internal, [k]: !isInternal(k) },
  });
}

/* ── rules ────────────────────────────────────────────────────────────── */

const isDefaultRules = computed(() =>
  JSON.stringify(props.modelValue.rules) === JSON.stringify(DEFAULT_VARIANT_RULES),
);

function setRules(rules: VariantRuleRow[]): void {
  emit("update:modelValue", { ...props.modelValue, rules });
}
function editRule(i: number, patch: Partial<VariantRuleRow>): void {
  setRules(props.modelValue.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
}
function removeRule(i: number): void {
  setRules(props.modelValue.rules.filter((_, j) => j !== i));
}
const ruleList = ref<HTMLElement | null>(null);
async function addRule(): Promise<void> {
  setRules([...props.modelValue.rules, { variant: "", pattern: "" }]);
  await nextTick();
  const inputs = ruleList.value?.querySelectorAll<HTMLInputElement>(".wp-mi__rule-variant");
  inputs?.[inputs.length - 1]?.focus();
}
function resetRules(): void {
  setRules(DEFAULT_VARIANT_RULES.map((r) => ({ ...r })));
}
</script>

<template>
  <div class="wp-mi" :class="{ 'wp-mi--skipped': isSkipped }">
    <section class="wp-mi__section">
      <div class="wp-mi__head">
        <span class="wp-mi__label">DETECTED</span>
        <span class="wp-mi__head-note" title="What this node writes for the nodes after it">writes for later nodes</span>
      </div>
      <div class="wp-mi__vars">
        <div
          v-for="row in rows"
          :key="row.key"
          class="wp-mi__var"
          :class="{ 'is-pinned': isPinned(row.key), 'is-empty': !row.value && !showsInput(row.key) }"
          :data-test="`mi-var-${row.key}`"
        >
          <span class="wp-mi__var-name" :title="`${row.variable}: ${ROW_TOOLTIPS[row.key]}`">{{ row.label }}</span>
          <input
            v-if="showsInput(row.key)"
            :ref="(el) => { pinInputs[row.key] = el as HTMLInputElement | null; }"
            class="wp-mi__pin-input"
            :value="modelValue[row.key]"
            :placeholder="row.key === 'name' ? 'checkpoint file name' : row.label"
            :data-test="`mi-pin-input-${row.key}`"
            spellcheck="false"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
            @keydown.stop
            @blur="onPinBlur(row.key, $event)"
          >
          <span
            v-else
            class="wp-mi__var-value"
            :title="row.value || row.hint"
            :data-test="`mi-value-${row.key}`"
          >{{ row.value || row.hint }}</span>
          <span class="wp-mi__source" :class="{ 'is-pinned': isPinned(row.key) }">{{ row.source }}</span>
          <span class="wp-mi__actions">
          <WpIconButton
            icon="pi-globe"
            tone="accent"
            :pressed="isInternal(row.key)"
            :label="isInternal(row.key) ? `Show ${row.variable} in the Assembler` : `Hide ${row.variable} from the Assembler`"
            :hint="isInternal(row.key) ? `Internal: hidden from the Assembler. Click to show ${row.variable}` : `Shown in the Assembler. Click to hide ${row.variable}`"
            :data-test="`mi-internal-${row.key}`"
            @click="toggleInternal(row.key)"
          />
          <WpIconButton
            icon="pi-thumbtack"
            tone="warn"
            :pressed="isPinned(row.key)"
            :label="isPinned(row.key) ? `Unpin ${row.variable}` : `Pin ${row.variable}`"
            :hint="isPinned(row.key) ? 'Unpin: detect it again' : `Pin ${row.variable} to a value of your own`"
            :data-test="`mi-pin-${row.key}`"
            @click="startPin(row)"
          />
          </span>
        </div>
      </div>
    </section>

    <section class="wp-mi__section">
      <div class="wp-mi__head">
        <span class="wp-mi__label">VARIANT RULES</span>
        <span class="wp-mi__head-note">first match in the file name wins</span>
        <WpButton v-if="!isDefaultRules"
         
          hint="Put the shipped rules back"
          variant="ghost"
          icon="pi-undo"
          class="wp-mi__reset"
          data-test="mi-reset-rules"
          @click="resetRules"
        >Reset</WpButton>
      </div>
      <div ref="ruleList" class="wp-mi__rules">
        <div
          v-for="(rule, i) in modelValue.rules"
          :key="i"
          class="wp-mi__rule"
          :class="{
            'is-match': !modelValue.variant && matched?.row === i,
            'is-problem': problemByRow.has(i),
          }"
          :title="problemByRow.get(i) || (matched?.row === i ? `Matches ${effectiveName}` : undefined)"
          :data-test="`mi-rule-${i}`"
        >
          <span class="wp-mi__rule-dot" aria-hidden="true" />
          <input
            class="wp-mi__rule-variant"
            :value="rule.variant"
            placeholder="variant"
            spellcheck="false"
            aria-label="variant"
            @keydown.stop
            @change="editRule(i, { variant: ($event.target as HTMLInputElement).value })"
          >
          <input
            class="wp-mi__rule-pattern"
            :value="rule.pattern"
            placeholder="pattern, e.g. pony|pdxl"
            spellcheck="false"
            aria-label="pattern"
            @keydown.stop
            @change="editRule(i, { pattern: ($event.target as HTMLInputElement).value })"
          >
          <WpIconButton
            icon="pi-trash"
            tone="danger"
            label="Remove this rule"
            :data-test="`mi-rule-remove-${i}`"
            @click="removeRule(i)"
          />
        </div>
        <div v-if="modelValue.rules.length === 0" class="wp-mi__ghost">
          No rules, so $model_variant stays empty unless pinned.
        </div>
      </div>
      <WpButton
        variant="add"
        icon="pi-plus"
        block
        class="wp-mi__add"
        data-test="mi-add-rule"
        @click="addRule"
      >Add rule</WpButton>
    </section>
  </div>
</template>

<style scoped>
/* Layout and tokens follow the Cleaner / Seed List. */

.wp-mi {
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: var(--wp-text);
  font: 12px var(--wp-font-sans, sans-serif);
  padding: 4px 0;
  min-width: 0;
}
.wp-mi--skipped { opacity: 0.45; }

.wp-mi__section { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.wp-mi__head { display: flex; align-items: center; gap: 8px; }
.wp-mi__label {
  font: 600 9px var(--wp-font-sans, sans-serif);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--wp-text-dim, var(--wp-text-muted, var(--wp-text2)));
}
.wp-mi__head-note {
  flex: 1;
  font-size: 9px;
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-mi__reset { margin-left: auto; }

/* DETECTED rows */
.wp-mi__vars {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
  padding: 4px;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: min(3px, var(--wp-radius-cap, 999px));
}
.wp-mi__var {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  min-height: 22px;
  padding: 0 4px;
  border-radius: min(3px, var(--wp-radius-cap, 999px));
}
.wp-mi__var:hover { background: var(--wp-row-hover, var(--wp-bg2)); }
/* Same 1px spacing as the Injector's row actions. */
.wp-mi__actions { display: flex; gap: 1px; }
.wp-mi__var-name {
  font: 10px var(--wp-font-sans, sans-serif);
  color: var(--wp-text-muted, var(--wp-text2));
  cursor: help;
}
.wp-mi__var-value {
  font: 11px var(--wp-font-mono, monospace);
  color: var(--wp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-mi__var.is-empty .wp-mi__var-value {
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 10px;
  font-style: italic;
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-mi__pin-input {
  min-width: 0;
  height: 20px;
  padding: 0 6px;
  background: var(--wp-bg, #111);
  color: var(--wp-text);
  border: 1px solid var(--wp-amber, var(--wp-warn, #fbbf24));
  border-radius: min(3px, var(--wp-radius-cap, 999px));
  font: 11px var(--wp-font-mono, monospace);
  outline: none;
}
.wp-mi__source {
  font-size: 9px;
  color: var(--wp-text-dim, var(--wp-text3));
  white-space: nowrap;
}
.wp-mi__source.is-pinned { color: var(--wp-amber, var(--wp-warn, #fbbf24)); }
/* VARIANT RULES */
.wp-mi__rules { display: grid; grid-template-columns: minmax(0, 1fr); gap: 3px; }
.wp-mi__rule {
  display: grid;
  grid-template-columns: 8px 92px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 6px;
  padding: 1px 2px;
  border-radius: min(3px, var(--wp-radius-cap, 999px));
}
.wp-mi__rule-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--wp-border2, var(--wp-border-strong, #444));
}
.wp-mi__rule.is-match .wp-mi__rule-dot { background: var(--wp-accent); }
.wp-mi__rule.is-match .wp-mi__rule-variant { color: var(--wp-accent-text, var(--wp-accent)); }
.wp-mi__rule-variant,
.wp-mi__rule-pattern {
  min-width: 0;
  height: 20px;
  padding: 0 6px;
  background: var(--wp-bg-deep, var(--wp-bg));
  color: var(--wp-text);
  border: 1px solid var(--wp-border);
  border-radius: min(3px, var(--wp-radius-cap, 999px));
  font: 11px var(--wp-font-mono, monospace);
  outline: none;
}
.wp-mi__rule-variant { font-family: var(--wp-font-sans, sans-serif); font-weight: 600; }
.wp-mi__rule-variant:focus,
.wp-mi__rule-pattern:focus { border-color: var(--wp-accent); }
.wp-mi__rule.is-problem .wp-mi__rule-variant,
.wp-mi__rule.is-problem .wp-mi__rule-pattern { border-color: var(--wp-danger, #ef4444); }
.wp-mi__ghost {
  padding: 6px 4px;
  font-size: 10px;
  font-style: italic;
  color: var(--wp-text-dim, var(--wp-text3));
}

.wp-mi__add { margin-top: 2px; }
</style>
