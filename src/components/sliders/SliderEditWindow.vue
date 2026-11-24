<script setup lang="ts">
/**
 * One WP Slider slider's settings, in a kit `Modal` (like the Toggles
 * window): the node keeps its edit view (order, globe, remove, labels) and
 * the row's pencil opens this. It edits a draft; Done hands the draft and
 * its group back to `SlidersWidget.vue`. The strip on top is the row as the
 * node will draw it, and its track moves the draft's value.
 */
import { computed, defineAsyncComponent, ref } from "vue";
import Input from "@/kit/Input.vue";
import WpNumber from "@/kit/WpNumber.vue";
import WpSegmented from "@/kit/WpSegmented.vue";
import Checkbox from "@/kit/Checkbox.vue";
import WpSelect from "@/kit/WpSelect.vue";
import ColorField from "@/kit/ColorField.vue";
import IconPicker from "@/kit/IconPicker.vue";
import WpIconButton from "@/kit/WpIconButton.vue";
import { vTooltip } from "@/kit/tooltip";
import { vToggleRow } from "@/kit/toggle-row";
import Modal from "@/kit/Modal.vue";
import ConfirmModal from "@/kit/ConfirmModal.vue";
import Button from "@/kit/Button.vue";
import Kbd from "@/kit/Kbd.vue";
import Banner from "@/kit/Banner.vue";
import SliderRowView from "./SliderRow.vue";
import { varColorClass } from "../shared/var-color";
import { MAX_DECIMALS, fineStepOf, fitRange, matchAxis, sliderOutputType, wordFor, type SliderMode, type SliderStyle, type SliderRow, type SliderWord } from "../../extension/sliders";
import type { VarProducerLike } from "../../manager/components/RefChip.vue";
import { INLINE_PICKS_NOTE, hasInlinePicks, tokenize } from "../context/editors/_shared/preview-tokens";

const RichTextInput = defineAsyncComponent(() => import("../../manager/components/RichTextInput.vue"));
const NegativeField = defineAsyncComponent(() => import("../../manager/components/NegativeField.vue"));

interface Choice { value: string; label: string }

const props = defineProps<{
  s: SliderRow;
  problem?: string | undefined;
  /** Label groups to move to; empty hides the field. */
  groupOptions: Choice[];
  groupId: string;
  /** All 16 outputs are taken (an unpinned slider can't get one). */
  outputsFull: boolean;
  varSuggestions?: string[] | undefined;
  varProducers?: Map<string, VarProducerLike> | undefined;
  nodeTitle?: string | undefined;
  /** A WP Slider 2D / 3D axis: its output is always there (no Output box,
   *  no Style), and the chip names the axis. "Phrase": WP Slider 3D's text
   *  row (no Style and no output). */
  axis?: "X" | "Y" | "Z" | "Phrase" | undefined;
  /** A pad axis's other axes: "Match X" copies one's range, decimals,
   *  snap, marks and words here. */
  matchRows?: { label: string; row: SliderRow; index: number }[] | undefined;
}>();
const emit = defineEmits<{ done: [next: SliderRow, groupId: string]; cancel: []; swap: [next: SliderRow, index: number] }>();

// Plain copies: the props are reactive proxies.
const d = ref<SliderRow>(JSON.parse(JSON.stringify(props.s)) as SliderRow);
const draftGroup = ref(props.groupId);
const dirty = computed(() => JSON.stringify(d.value) !== JSON.stringify(props.s) || draftGroup.value !== props.groupId);

function patch(p: Partial<SliderRow>): void {
  const next: Record<string, unknown> = { ...d.value, ...p };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  d.value = next as unknown as SliderRow;
}
function value(ev: Event): string {
  return (ev.target as HTMLInputElement).value.trim();
}

type OutPick = "auto" | "int" | "float";
const OUT_TYPES: { value: OutPick; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "INT at 0 decimals, else FLOAT" },
  { value: "int", label: "INT", hint: "A whole number, rounded (steps, seeds, sizes)" },
  { value: "float", label: "FLOAT", hint: "The number at the slider's decimals (cfg, LoRA strength)" },
];
const STYLES: { value: SliderStyle; label: string; hint: string }[] = [
  { value: "row", label: "Row", hint: "The name, then a thin track" },
  { value: "bar", label: "Bar", hint: "The whole row is the track, the name inside it" },
  { value: "fader", label: "Fader", hint: "An upright track; faders next to each other stand side by side" },
];
const MODES: { value: SliderMode; label: string; hint: string }[] = [
  { value: "number", label: "Number", hint: "The variable gets the number, e.g. 0.45" },
  { value: "text", label: "Text", hint: "The variable gets your text, which can read the number as $name.num" },
  { value: "words", label: "Words", hint: "The variable gets the word of the range the number falls in" },
];

/** Range fields: Max stays above Min; the value is kept inside. */
function setRange(p: { min?: number | null; max?: number | null; step?: number | null; decimals?: number | null }): void {
  const next = fitRange(d.value, p);
  patch({ ...next, value: Math.min(Math.max(d.value.value, next.min), Math.max(next.min, next.max)) });
}

/* ── words ───────────────────────────────────────────────────────────── */

const words = computed<SliderWord[]>(() => d.value.words ?? []);
const matched = computed(() => (d.value.mode === "words" ? wordFor(d.value) : undefined));
function setWords(list: SliderWord[]): void {
  patch({ words: list.length ? list : undefined });
}
function patchWord(i: number, p: Partial<SliderWord>): void {
  setWords(words.value.map((w, j) => {
    if (j !== i) return w;
    const next: Record<string, unknown> = { ...w, ...p };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    return next as unknown as SliderWord;
  }));
}
/** A new range goes before the last one (which catches the rest), ending
 *  halfway between the previous end and the max. */
function addWord(): void {
  const list = [...words.value];
  const ends = list.map((w) => w.upto).filter((u): u is number => u !== undefined);
  const from = ends.length ? Math.max(...ends) : d.value.min;
  const upto = Number((from + (d.value.max - from) / 2).toFixed(d.value.decimals));
  if (!list.length) {
    setWords([{ word: "", upto }, { word: "" }]);
    return;
  }
  const last = list[list.length - 1];
  if (last && last.upto === undefined) list.splice(list.length - 1, 0, { word: "", upto });
  else list.push({ word: "" });
  setWords(list);
}
function removeWord(i: number): void {
  setWords(words.value.filter((_, j) => j !== i));
}

/** `$names` the Text reads that nothing upstream (nor this node) sets. */
const missingVars = computed(() => {
  const known = props.varSuggestions;
  const text = d.value.mode === "text" ? d.value.text ?? "" : "";
  if (!known || !text.includes("$")) return [];
  const names = tokenize(text, "assembler").filter((tok) => tok.kind === "var" && tok.varName).map((tok) => tok.varName ?? "");
  return [...new Set(names)].filter((n) => !known.includes(n) && n !== d.value.var);
});

function colorValue(v: string | undefined): string {
  return v ?? "none";
}
function pickColor(v: string): string | undefined {
  const c = v.slice(0, 7).toLowerCase();
  return /^#[0-9a-f]{6}$/.test(c) ? c : undefined;
}
const headStyle = computed(() => {
  const st: Record<string, string> = {};
  if (d.value.icon_color) st["--wp-slw-icon"] = d.value.icon_color;
  if (d.value.tint) st["--wp-slw-tint"] = d.value.tint;
  if (d.value.text_color) st["--wp-slw-text"] = d.value.text_color;
  return st;
});
const fineUnit = computed(() => fineStepOf(d.value));
const numHint = computed(() => `$${d.value.var || "name"}.num`);
const outType = computed(() => sliderOutputType(d.value));

const asking = ref(false);
function cancel(): void {
  if (dirty.value) asking.value = true;
  else emit("cancel");
}
function onKey(ev: KeyboardEvent): void {
  if (!asking.value && ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    emit("done", d.value, draftGroup.value);
  }
}
</script>

<template>
  <Modal :open="true" size="md" @update:open="(v: boolean) => { if (!v) cancel(); }" @keydown="onKey">
    <template #header="{ titleId }">
      <i class="pi wp-slw__icon" :class="d.icon ? `pi-${d.icon}` : 'pi-sliders-h'" :style="headStyle" aria-hidden="true" />
      <div class="wp-slw__titles">
        <div class="wp-slw__title-row">
          <h3 :id="titleId" class="wp-slw__title">{{ nodeTitle || 'WP Slider' }}</h3>
          <span class="wp-slw__chip" :style="headStyle">{{ axis === 'Phrase' ? 'Phrase' : axis ? `${axis} axis` : 'Slider' }}</span>
        </div>
        <div class="wp-slw__sub" :style="headStyle">
          <span class="wp-slw__subname">{{ d.name }}</span>
          <template v-if="d.var">
            <span aria-hidden="true"> · </span>
            <span class="wp-slw__subvar" :class="d.text_color ? 'has-text' : varColorClass(d.var)">${{ d.var }}</span>
          </template>
        </div>
      </div>
    </template>
    <div class="wp-slw__preview" data-test="sl-window-preview">
      <span class="wp-slw__cap">ON THE NODE</span>
      <SliderRowView :s="d" :problem="problem" :editing="false" :editable="false" @set-value="(v: number) => patch({ value: v })" />
    </div>
    <div class="wp-slw__body">
      <label class="wp-slw__field">
        <span>Name <em>on the row and its output</em></span>
        <Input size="sm" :model-value="d.name" spellcheck="false" data-test="sl-name" @keydown.stop @change="patch({ name: value($event) })" />
      </label>
      <label class="wp-slw__field">
        <span>Variable <em>{{ d.mode === 'number' ? 'gets the number' : `${numHint} always reads the number` }}</em></span>
        <span class="wp-slw__var-row">
          <Input
            size="sm"
            mono
            prefix="$"
            class="wp-slw__var"
            :class="d.var ? varColorClass(d.var) : undefined"
            :tone="problem ? 'warn' : undefined"
            :model-value="d.var"
            placeholder="variable_name"
            spellcheck="false"
            data-test="sl-var"
            @keydown.stop
            @change="patch({ var: value($event).replace(/^\$/, '') })"
          />
          <span v-tooltip="'Show the $variable under the name'" v-toggle-row class="wp-slw__check">
            <Checkbox :model-value="!d.hide_var" size="sm" aria-label="Show the variable under the name" data-test="sl-show-var" @update:model-value="(v: boolean) => patch({ hide_var: v ? undefined : true })" />
            <span aria-hidden="true">Show</span>
          </span>
        </span>
      </label>
      <div v-if="axis !== 'Phrase'" class="wp-slw__field">
        <span class="wp-slw__range-head">
          <span>Range <em>min, max, step and the decimals it writes (0 makes a whole number)</em></span>
          <Button
            v-for="m in matchRows ?? []"
            :key="m.row.id"
            size="sm"
            variant="ghost"
            icon="pi-copy"
            :hint="`Copy ${m.label}'s range, step, decimals, snap, marks and words (${m.row.name})`"
            :data-test="`sl-match-${m.label}`"
            @click="d = matchAxis(d, m.row)"
          >Match {{ m.label }}</Button>
          <Button
            v-for="m in matchRows ?? []"
            :key="`swap-${m.row.id}`"
            size="sm"
            variant="ghost"
            icon="pi-arrow-right-arrow-left"
            :hint="`Trade every setting with ${m.label} (${m.row.name}), these edits included; each keeps its output`"
            :data-test="`sl-swap-${m.label}`"
            @click="emit('swap', d, m.index)"
          >Swap with {{ m.label }}</Button>
        </span>
        <span class="wp-slw__range">
          <label class="wp-slw__num"><span>Min</span><WpNumber :model-value="d.min" :step="d.step" size="sm" aria-label="Min" data-test="sl-min" @update:model-value="(v: number | null) => setRange({ min: v })" /></label>
          <label class="wp-slw__num"><span>Max</span><WpNumber :model-value="d.max" :step="d.step" size="sm" aria-label="Max" data-test="sl-max" @update:model-value="(v: number | null) => setRange({ max: v })" /></label>
          <label class="wp-slw__num"><span>Step</span><WpNumber :model-value="d.step" :min="0" :step="d.decimals ? Number((0.1 ** d.decimals).toFixed(d.decimals)) : 1" size="sm" aria-label="Step" data-test="sl-step" @update:model-value="(v: number | null) => setRange({ step: v })" /></label>
          <label class="wp-slw__num"><span>Decimals</span><WpNumber :model-value="d.decimals" :min="0" :max="MAX_DECIMALS" :step="1" size="sm" aria-label="Decimals" data-test="sl-decimals" @update:model-value="(v: number | null) => setRange({ decimals: v })" /></label>
        </span>
        <span
          v-tooltip="fineUnit ? `Off: a drag lands on any value to ${fineUnit} (the arrows still move by the step). On: hold Shift while dragging for that` : 'The decimals can\'t write anything finer than the step'"
          v-toggle-row
          class="wp-slw__check"
        >
          <Checkbox :model-value="!d.free" size="sm" :disabled="!fineUnit" aria-label="Snap to step" data-test="sl-snap" @update:model-value="(v: boolean) => patch({ free: v ? undefined : true })" />
          <span aria-hidden="true">Snap to step</span>
        </span>
      </div>
      <!-- The phrase is always text: a Number or Words phrase stopped being one and vanished. -->
      <div v-if="axis !== 'Phrase'" class="wp-slw__field">
        <span>Value <em>what ${{ d.var || 'name' }} holds</em></span>
        <WpSegmented :model-value="d.mode" :options="MODES" size="sm" block aria-label="Value" test-prefix="sl-mode" @update:model-value="(v: SliderMode) => patch({ mode: v })" />
      </div>
      <div v-if="d.mode === 'text'" class="wp-slw__field">
        <span>Text <em>may read {{ numHint }} and other $variables</em></span>
        <RichTextInput
          :model-value="d.text ?? ''"
          surface="combine"
          multiline
          :rows="2"
          :placeholder="`(intricate details:${numHint})`"
          :var-suggestions="varSuggestions ?? []"
          :var-producers="varProducers"
          :graph-aware="!!varProducers"
          aria-label="Text"
          data-test="sl-text"
          @update:model-value="(v: string) => patch({ text: v.trim() ? v : undefined })"
        />
      </div>
      <div v-if="d.mode === 'words'" class="wp-slw__field" data-test="sl-words">
        <span>Words <em>the first range the number is at most; the last catches the rest</em></span>
        <div v-for="(w, i) in words" :key="i" class="wp-slw__word" :class="{ 'is-hit': matched === w }" :data-test="`sl-word-${i}`">
          <span class="wp-slw__upto">
            <template v-if="w.upto !== undefined || i < words.length - 1">
              <span>up to</span>
              <WpNumber :model-value="w.upto ?? null" nullable :step="d.step" size="sm" aria-label="Up to" @update:model-value="(v: number | null) => patchWord(i, { upto: v ?? undefined })" />
            </template>
            <span v-else class="wp-slw__rest">the rest</span>
          </span>
          <Input size="sm" :model-value="w.word" placeholder="word" spellcheck="false" aria-label="Word" @keydown.stop @change="patchWord(i, { word: ($event.target as HTMLInputElement).value })" />
          <Input size="sm" :model-value="w.negative ?? ''" placeholder="negative (optional)" spellcheck="false" aria-label="Negative for this word" @keydown.stop @change="patchWord(i, { negative: value($event) || undefined })" />
          <WpIconButton icon="pi-times" tone="danger" label="Remove range" @click="removeWord(i)" />
        </div>
        <Button size="sm" variant="add" icon="pi-plus" block data-test="sl-word-add" @click="addWord">Add range</Button>
      </div>
      <div class="wp-slw__field">
        <NegativeField
          :model-value="d.negative"
          surface="combine"
          :label="d.mode === 'words' ? 'slider (when the word has none)' : 'slider'"
          test-id="sl-negative"
          :var-suggestions="varSuggestions ?? []"
          :var-producers="varProducers"
          :graph-aware="!!varProducers"
          @update:model-value="(v: string | undefined) => patch({ negative: v })"
        />
      </div>
      <Banner v-if="missingVars.length" tone="warn" size="sm" data-test="sl-missing-vars">{{ missingVars.map((v) => '$' + v).join(', ') }}: nothing upstream sets {{ missingVars.length > 1 ? 'these' : 'this' }}, so it prints nothing</Banner>
      <Banner v-if="d.mode === 'text' && hasInlinePicks(d.text ?? '')" tone="warn" size="sm">{{ INLINE_PICKS_NOTE }}</Banner>
      <div v-if="!axis" class="wp-slw__field">
        <span>Style <em>how the slider is drawn on the node</em></span>
        <WpSegmented :model-value="d.style" :options="STYLES" size="sm" block aria-label="Style" test-prefix="sl-style" @update:model-value="(v: SliderStyle) => patch({ style: v })" />
      </div>
      <div v-if="axis !== 'Phrase'" class="wp-slw__field">
        <span>Looks <em>icon and colours; None keeps the theme's</em></span>
        <span class="wp-slw__looks">
          <IconPicker :model-value="d.icon ?? null" all size="sm" :color="d.icon_color" aria-label="Icon" data-test="sl-icon" @update:model-value="(v: string | null) => patch({ icon: v || undefined })" />
          <span class="wp-slw__look"><ColorField :model-value="colorValue(d.icon_color)" allow-none presets compact aria-label="Icon colour" @update:model-value="(v: string) => patch({ icon_color: pickColor(v) })" />Icon</span>
          <span class="wp-slw__look"><ColorField :model-value="colorValue(d.text_color)" allow-none presets compact aria-label="Name colour" @update:model-value="(v: string) => patch({ text_color: pickColor(v) })" />Name</span>
          <span class="wp-slw__look"><ColorField :model-value="colorValue(d.tint)" allow-none presets compact aria-label="Track colour" data-test="sl-tint" @update:model-value="(v: string) => patch({ tint: pickColor(v) })" />Track</span>
          <span v-tooltip="'Ticks along the track: where each Words range ends, else on the steps'" v-toggle-row class="wp-slw__check">
            <Checkbox :model-value="!!d.marks" size="sm" aria-label="Marks" data-test="sl-marks" @update:model-value="(v: boolean) => patch({ marks: v ? true : undefined })" />
            <span aria-hidden="true">Marks</span>
          </span>
        </span>
      </div>
      <div v-if="groupOptions.length" class="wp-slw__field">
        <span>Group</span>
        <WpSelect :model-value="draftGroup" :options="groupOptions" aria-label="Group" data-test="sl-group" @update:model-value="(v: string) => (draftGroup = v)" />
      </div>
      <div v-if="axis && axis !== 'Phrase'" class="wp-slw__field">
        <span>Output <em>the {{ axis.toLowerCase() }} output's type</em></span>
        <WpSegmented
          :model-value="d.out_type ?? 'auto'"
          :options="OUT_TYPES"
          size="sm"
          aria-label="Output type"
          test-prefix="sl-out-type"
          @update:model-value="(v: OutPick) => patch({ out_type: v === 'auto' ? undefined : v })"
        />
      </div>
      <div v-else-if="!axis" class="wp-slw__out">
        <span v-tooltip="!d.pin && outputsFull ? 'All 16 outputs are in use' : `Show an ${outType} output with the number, for a sampler, LoRA strength or any number input`" v-toggle-row class="wp-slw__check">
          <Checkbox :model-value="d.pin" size="sm" :disabled="!d.pin && outputsFull" :aria-label="`${outType} output`" data-test="sl-pin" @update:model-value="(v: boolean) => patch({ pin: v })" />
          <span aria-hidden="true">{{ outType }} output</span>
        </span>
        <WpSegmented
          v-if="d.pin"
          :model-value="d.out_type ?? 'auto'"
          :options="OUT_TYPES"
          size="sm"
          aria-label="Output type"
          test-prefix="sl-out-type"
          @update:model-value="(v: OutPick) => patch({ out_type: v === 'auto' ? undefined : v })"
        />
      </div>
    </div>
    <template #footer>
      <span class="wp-slw__hint"><Kbd keys="Mod+Enter" size="sm" /> Done · Changes save with the node when you press Done.</span>
      <Button size="sm" data-test="sl-window-cancel" @click="cancel">Cancel</Button>
      <Button size="sm" variant="primary" data-test="sl-window-done" @click="emit('done', d, draftGroup)">Done</Button>
    </template>
  </Modal>
  <ConfirmModal
    :open="asking"
    title="Discard your changes?"
    body="What you changed in this window isn't on the node yet."
    confirm-label="Discard"
    cancel-label="Keep editing"
    tone="warn"
    @confirm="asking = false; emit('cancel')"
    @cancel="asking = false"
  />
</template>

<style scoped>
.wp-slw__preview {
  position: sticky;
  top: calc(-1 * var(--wp-space-5));
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: calc(-1 * var(--wp-space-5)) calc(-1 * var(--wp-space-5)) var(--wp-space-5);
  padding: 10px var(--wp-space-5);
  border-bottom: 1px solid var(--wp-border);
  background: var(--wp-bg-deep, var(--wp-bg));
}
.wp-slw__icon { color: var(--wp-slw-icon, var(--wp-slw-tint, var(--wp-accent))); font-size: 14px; }
.wp-slw__titles { flex: 1; min-width: 0; }
.wp-slw__title-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.wp-slw__title { margin: 0; font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-slw__chip {
  flex: none;
  padding: 2px 6px;
  border-radius: min(2px, var(--wp-radius-cap, 999px));
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: color-mix(in srgb, var(--wp-slw-tint, var(--wp-accent)) 22%, transparent);
  color: var(--wp-slw-tint, var(--wp-accent));
}
.wp-slw__subname { color: var(--wp-slw-text, var(--wp-text)); font-weight: 600; }
.wp-slw__subvar { font-family: var(--wp-font-mono, monospace); }
.wp-slw__subvar.has-text { color: var(--wp-slw-text); }
.wp-slw__sub { margin-top: 3px; font-size: 11px; color: var(--wp-text-dim); }
.wp-slw__hint { display: inline-flex; align-items: center; gap: 4px; margin-right: auto; font-size: 11px; color: var(--wp-text-dim); }
.wp-slw__cap { font: 600 9px var(--wp-font-sans, sans-serif); letter-spacing: 0.08em; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-slw__body { display: flex; flex-direction: column; gap: 10px; }
.wp-slw__field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.wp-slw__field > span:first-child { font-size: 10.5px; font-weight: 600; color: var(--wp-text-muted, var(--wp-text2)); }
.wp-slw__range-head { display: flex; align-items: center; gap: 4px; }
.wp-slw__range-head > span { flex: 1; min-width: 0; }
.wp-slw__field em { font-style: normal; font-weight: 400; color: var(--wp-text-dim, var(--wp-text3)); margin-left: 4px; }
.wp-slw__out { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.wp-slw__check { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; cursor: pointer; }
.wp-slw__var-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.wp-slw__var-row .wp-slw__var { flex: 1 1 0; min-width: 80px; }
.wp-slw__range + .wp-slw__check { align-self: flex-start; margin-top: 4px; }
.wp-slw__range { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.wp-slw__num { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 10px; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-slw__word { display: grid; grid-template-columns: 128px minmax(0, 1fr) minmax(0, 1fr) auto; align-items: center; gap: 6px; padding: 2px 4px; border-radius: min(4px, var(--wp-radius-cap, 999px)); }
.wp-slw__word.is-hit { box-shadow: inset 0 0 0 1px var(--wp-accent); }
.wp-slw__upto { display: flex; align-items: center; gap: 4px; white-space: nowrap; font-size: 10.5px; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-slw__upto :deep(.wp-number) { flex: 1; min-width: 0; }
.wp-slw__rest { font-style: italic; }
.wp-slw__looks { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
.wp-slw__look { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--wp-text-muted, var(--wp-text2)); }
</style>
