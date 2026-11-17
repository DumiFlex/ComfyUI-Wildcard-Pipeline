<script setup lang="ts">
/**
 * SliderPadWidget — DOM widget for WP_Slider2D: one XY pad (kit `XYPad`).
 *
 * The config is a `SlidersConfig` with two slider rows, X then Y
 * (`padConfig`), so each axis is a slider: its window
 * (`SliderEditWindow.vue` with `axis`) sets its name, variable, range,
 * value mode, negative and output type. The pad sets both values at once.
 *
 * The pencil in ComfyUI's selection toolbar (`editRequest`) shows the edit
 * strip: a pencil per axis, the pad's style (Pad / Size / Stick / Map),
 * shape (or Auto from the ranges), width, looks, dots (Auto = one per step)
 * with Snap to dots, and Swap.
 */
import { computed, defineAsyncComponent, ref, watch } from "vue";
import Button from "@/kit/Button.vue";
import Checkbox from "@/kit/Checkbox.vue";
import WpIconButton from "@/kit/WpIconButton.vue";
import WpNumber from "@/kit/WpNumber.vue";
import WpSegmented from "@/kit/WpSegmented.vue";
import XYPad from "@/kit/XYPad.vue";
import { stepDots } from "@/kit/xy-pad";
import { vTooltip } from "@/kit/tooltip";
import { vToggleRow } from "@/kit/toggle-row";
import { varColorClass } from "../shared/var-color";
import {
  fineStepOf,
  fmtSlider,
  padBands,
  padRatio,
  sliderProblems,
  sliderRows,
  wordFor,
  type PadLooks,
  type SliderRow,
  type SlidersConfig,
} from "../../extension/sliders";
import type { VarProducerLike } from "../../manager/components/RefChip.vue";

const SliderEditWindow = defineAsyncComponent(() => import("./SliderEditWindow.vue"));

const props = withDefaults(
  defineProps<{
    modelValue: SlidersConfig;
    /** Litegraph mode: 2 = muted, 4 = bypassed (dims the widget). */
    nodeMode?: number;
    /** Bumped by the pencil in ComfyUI's selection toolbar. */
    editRequest?: number;
    upstreamVars?: string[];
    varProducers?: Map<string, VarProducerLike> | undefined;
    nodeTitle?: string;
  }>(),
  { nodeMode: 0, editRequest: 0, upstreamVars: () => [], varProducers: undefined, nodeTitle: "" },
);
const emit = defineEmits<{ "update:modelValue": [next: SlidersConfig] }>();

const STYLES = [
  { value: "pad", label: "Pad", icon: "pi-stop", hint: "The plain pad" },
  { value: "size", label: "Size", icon: "pi-expand", hint: "A picture size: the box is shaded, with 1:1, 4:3, 16:9 … guide lines and a W × H readout" },
  { value: "stick", label: "Stick", icon: "pi-circle", hint: "Round, with zero in the middle (set both ranges from -1 to 1)" },
  { value: "map", label: "Map", icon: "pi-map", hint: "Each Words axis shows its words on the pad" },
];
const SHAPES = [
  { value: "1", label: "Square", hint: "A square pad" },
  { value: "1.5", label: "Wide", hint: "3:2, wider than tall" },
  { value: "0.6667", label: "Tall", hint: "2:3, taller than wide" },
  { value: "fit", label: "Auto", hint: "Follows the two ranges: 0–1024 across and 0–1344 up is a 3:4 pad" },
];
const SIZES = [
  { value: "s", label: "S", hint: "A small pad" },
  { value: "m", label: "M", hint: "A medium pad" },
  { value: "l", label: "L", hint: "Fills the node" },
];

const isSkipped = computed(() => props.nodeMode === 2 || props.nodeMode === 4);
const axes = computed(() => sliderRows(props.modelValue));
const ax = computed(() => axes.value[0]);
const ay = computed(() => axes.value[1]);
const pad = computed<PadLooks>(() => props.modelValue.pad ?? {});
const problems = computed(() => sliderProblems(props.modelValue));
const problemText = computed(() => [...problems.value.values()].join(" · "));

function emitRows(rows: SliderRow[], padNext: PadLooks = pad.value): void {
  const next: SlidersConfig = { version: 1, rows };
  if (Object.keys(padNext).length) next.pad = padNext;
  emit("update:modelValue", next);
}
function setPad(p: Partial<PadLooks>): void {
  const next: Record<string, unknown> = { ...pad.value, ...p };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  emitRows(axes.value, next as PadLooks);
}
function setValues([x, y]: [number, number]): void {
  const [sx, sy] = axes.value;
  if (!sx || !sy) return;
  emitRows([{ ...sx, value: x }, { ...sy, value: y }]);
}
/** Swap the axes: X's settings go up, Y's across (outputs keep their slot). */
function swap(): void {
  const [sx, sy] = axes.value;
  if (!sx || !sy) return;
  emitRows([{ ...sy, out: 1 }, { ...sx, out: 2 }]);
}

/** One step that is finer while Shift is held (or always, with Snap off). */
function stepOf(s: SliderRow): number {
  const fine = fineStepOf(s);
  return s.free && fine ? fine : s.step;
}
const fineStep = computed(() => {
  const fx = ax.value ? fineStepOf(ax.value) : undefined;
  const fy = ay.value ? fineStepOf(ay.value) : undefined;
  return fx && fy ? Math.min(fx, fy) : undefined;
});

function holds(s: SliderRow): string {
  if (s.mode === "words") return wordFor(s)?.word ?? "";
  if (s.mode === "text") return "text";
  return "";
}
const style = computed(() => pad.value.style ?? "pad");
const shape = computed(() => (pad.value.fit ? "fit" : String(pad.value.ratio ?? 1)));
const ratio = computed(() => (ax.value && ay.value ? padRatio(pad.value, ax.value, ay.value) : 1));
/** Dots along one axis: one per step (Auto), N on steps, or none. */
function dotsOf(s: SliderRow): number[] {
  const g = pad.value.grid;
  if (g === 0) return [];
  const max = s.max > s.min ? s.max : s.min + 1;
  return stepDots(s.min, max, s.step, g ?? undefined);
}
const xDots = computed(() => (ax.value ? dotsOf(ax.value) : []));
const yDots = computed(() => (ay.value ? dotsOf(ay.value) : []));
const xBands = computed(() => (style.value === "map" && ax.value ? padBands(ax.value) : []));
const yBands = computed(() => (style.value === "map" && ay.value ? padBands(ay.value) : []));
function setStyle(v: string): void {
  setPad({ style: v === "pad" ? undefined : (v as PadLooks["style"]) });
}
function setShape(v: string): void {
  if (v === "fit") setPad({ fit: true, ratio: undefined });
  else setPad({ fit: undefined, ratio: v === "1" ? undefined : Number(v) });
}

const fmtAxis = (v: number, axis: "x" | "y"): string => {
  const s = axis === "x" ? ax.value : ay.value;
  return s ? fmtSlider({ value: v, decimals: s.decimals }) : String(v);
};

/* ── edit strip + windows ─────────────────────────────────────────────── */

const editMode = ref(false);
const editing = ref<0 | 1 | null>(null);
watch(() => props.editRequest, () => {
  editMode.value = !editMode.value;
  if (!editMode.value) editing.value = null;
});
const editingRow = computed(() => (editing.value === null ? undefined : axes.value[editing.value]));
const valueVars = computed(() => [...new Set([...props.upstreamVars, ...axes.value.map((s) => s.var).filter(Boolean)])]);
function applyWindow(next: SliderRow): void {
  const i = editing.value;
  editing.value = null;
  if (i === null) return;
  emitRows(axes.value.map((s, j) => (j === i ? { ...next, id: s.id, kind: "slider", pin: true, out: j + 1 } : s)));
}
</script>

<template>
  <div class="wp-pad" :class="{ 'wp-pad--skipped': isSkipped }" data-wp-reveal>
    <div class="wp-pad__read">
      <template v-for="(s, i) in axes" :key="s.id">
        <span class="wp-pad__axis" :style="s.text_color ? { '--wp-pad-text': s.text_color } : undefined" :data-wp-vars="s.var || undefined" :data-test="`pad-axis-${i}`">
          <span class="wp-pad__tag">{{ i === 0 ? 'X' : 'Y' }}</span>
          <i v-if="s.icon" class="pi wp-pad__icon" :class="`pi-${s.icon}`" :style="s.icon_color ? { color: s.icon_color } : undefined" aria-hidden="true" />
          <span class="wp-pad__name">
            <b>{{ s.name }}</b>
            <span v-if="!s.hide_var" class="wp-pad__sub">
              <span :class="s.var ? varColorClass(s.var) : 'is-dim'">{{ s.var ? `$${s.var}` : "no variable" }}</span>
              <span v-if="holds(s)" class="wp-pad__holds">{{ holds(s) }}</span>
            </span>
          </span>
          <span class="wp-pad__num">{{ fmtSlider(s) }}</span>
          <WpIconButton v-if="editMode" icon="pi-pencil" :pressed="editing === i" :label="`Edit ${s.name}`" :data-test="`pad-edit-${i}`" @click="editing = editing === i ? null : (i as 0 | 1)" />
        </span>
      </template>
      <i v-if="problemText" v-tooltip="problemText" class="pi pi-exclamation-triangle wp-pad__warn" role="img" :aria-label="problemText" />
    </div>
    <!-- Stops the pointer here so a drag on the pad never drags the node. -->
    <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
    <div v-if="ax && ay" class="wp-pad__box" :data-size="pad.size ?? 'l'" :style="ay.tint || ax.tint ? { '--wp-accent': ax.tint ?? ay.tint } : undefined" @pointerdown.stop>
      <XYPad
        :model-value="[ax.value, ay.value]"
        :x-min="ax.min"
        :x-max="ax.max > ax.min ? ax.max : ax.min + 1"
        :x-step="stepOf(ax)"
        :y-min="ay.min"
        :y-max="ay.max > ay.min ? ay.max : ay.min + 1"
        :y-step="stepOf(ay)"
        :fine-step="fineStep"
        :ratio="ratio"
        :variant="style === 'size' || style === 'stick' ? style : 'pad'"
        :area="!!pad.area"
        :crosshair="!pad.no_crosshair"
        :tint="style === 'map' && !pad.no_tint"
        :x-dots="xDots"
        :y-dots="yDots"
        :snap-dots="!!pad.snap_dots"
        :x-bands="xBands"
        :y-bands="yBands"
        :x-label="ax.name"
        :y-label="ay.name"
        :format="fmtAxis"
        :aria-label="`${ax.name} and ${ay.name}`"
        size="sm"
        data-test="pad"
        @update:model-value="setValues"
      />
    </div>
    <div v-if="editMode" class="wp-pad__looks" data-test="pad-looks">
      <div class="wp-pad__looks-row">
        <span class="wp-pad__lbl">Style</span>
        <WpSegmented :model-value="style" :options="STYLES" size="sm" aria-label="Pad style" test-prefix="pad-style" @update:model-value="setStyle" />
      </div>
      <div class="wp-pad__looks-row">
        <span class="wp-pad__lbl">Shape</span>
        <WpSegmented :model-value="shape" :options="SHAPES" size="sm" aria-label="Pad shape" test-prefix="pad-shape" :disabled="style === 'stick'" @update:model-value="setShape" />
        <WpSegmented :model-value="pad.size ?? 'l'" :options="SIZES" size="sm" aria-label="Pad size" test-prefix="pad-size" @update:model-value="(v: string) => setPad({ size: v === 'l' ? undefined : (v as 's' | 'm') })" />
      </div>
      <div class="wp-pad__looks-row">
        <label v-tooltip="'Dots per side. Empty (Auto) puts one on every step, 0 hides them'" class="wp-pad__grid">
          <span>Dots</span>
          <WpNumber class="wp-pad__grid-num" :model-value="pad.grid ?? null" nullable placeholder="Auto" :min="0" :max="16" :step="1" size="sm" aria-label="Dots per side" data-test="pad-grid" @update:model-value="(v: number | null) => setPad({ grid: v === null ? undefined : v })" />
        </label>
        <span v-tooltip="'The point lands on a dot (or an edge); the arrow keys walk dot to dot'" v-toggle-row class="wp-pad__check">
          <Checkbox :model-value="!!pad.snap_dots" size="sm" aria-label="Snap to dots" data-test="pad-snap-dots" @update:model-value="(v: boolean) => setPad({ snap_dots: v ? true : undefined })" />
          <span aria-hidden="true">Snap to dots</span>
        </span>
        <span v-if="style !== 'size'" v-tooltip="'Shade the box from the bottom-left corner to the point, like a picture size'" v-toggle-row class="wp-pad__check">
          <Checkbox :model-value="!!pad.area" size="sm" aria-label="Area" data-test="pad-area" @update:model-value="(v: boolean) => setPad({ area: v ? true : undefined })" />
          <span aria-hidden="true">Area</span>
        </span>
        <span v-if="style === 'map'" v-tooltip="'A colour for each word section, the point\'s one a little stronger'" v-toggle-row class="wp-pad__check">
          <Checkbox :model-value="!pad.no_tint" size="sm" aria-label="Colours" data-test="pad-tint" @update:model-value="(v: boolean) => setPad({ no_tint: v ? undefined : true })" />
          <span aria-hidden="true">Colours</span>
        </span>
        <span v-tooltip="'Lines through the point'" v-toggle-row class="wp-pad__check">
          <Checkbox :model-value="!pad.no_crosshair" size="sm" aria-label="Lines" data-test="pad-lines" @update:model-value="(v: boolean) => setPad({ no_crosshair: v ? undefined : true })" />
          <span aria-hidden="true">Lines</span>
        </span>
      </div>
      <div class="wp-pad__looks-row wp-pad__looks-end">
        <Button size="sm" icon="pi-arrow-right-arrow-left" hint="Swap the axes: X's settings go up, Y's across" data-test="pad-swap" @click="swap">Swap</Button>
        <Button size="sm" variant="primary" icon="pi-check" data-test="pad-done" @click="editMode = false; editing = null">Done</Button>
      </div>
    </div>
    <SliderEditWindow
      v-if="editingRow"
      :key="editingRow.id"
      :s="editingRow"
      :problem="problems.get(editingRow.id)"
      :group-options="[]"
      group-id=""
      :outputs-full="false"
      :var-suggestions="valueVars"
      :var-producers="varProducers"
      :node-title="nodeTitle || 'WP Slider 2D'"
      :axis="editing === 0 ? 'X' : 'Y'"
      @done="(next: SliderRow) => applyWindow(next)"
      @cancel="editing = null"
    />
  </div>
</template>

<style scoped>
.wp-pad {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0;
  min-width: 0;
  color: var(--wp-text);
  font: 12px var(--wp-font-sans, sans-serif);
}
.wp-pad--skipped { opacity: 0.45; }
.wp-pad__read { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 6px; align-items: center; min-width: 0; }
.wp-pad__axis {
  display: flex; align-items: center; gap: 6px; min-width: 0; min-height: 34px;
  padding: 2px 6px; box-sizing: border-box;
  background: var(--wp-bg2, var(--wp-bg-1)); border-radius: min(4px, var(--wp-radius-cap, 999px));
}
.wp-pad__tag { flex: none; font: 600 10px var(--wp-font-mono, monospace); color: var(--wp-text-dim, var(--wp-text3)); }
.wp-pad__icon { flex: none; font-size: 12px; color: var(--wp-text-muted, var(--wp-text2)); }
.wp-pad__name { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; }
.wp-pad__name b { font-weight: 600; font-size: 12px; line-height: 16px; color: var(--wp-pad-text, inherit); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-pad__sub { display: flex; gap: 5px; min-width: 0; font: 10.5px/14px var(--wp-font-mono, monospace); overflow: hidden; white-space: nowrap; }
.wp-pad__sub > span { overflow: hidden; text-overflow: ellipsis; }
.wp-pad__sub .is-dim { font-family: var(--wp-font-sans, sans-serif); font-style: italic; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-pad__holds { font-family: var(--wp-font-sans, sans-serif); color: var(--wp-text-muted, var(--wp-text2)); }
.wp-pad__num { flex: none; font: 500 12px var(--wp-font-mono, monospace); }
.wp-pad__warn { font-size: 11px; color: var(--wp-amber, var(--wp-warn)); }
.wp-pad__box { display: flex; justify-content: center; min-width: 0; }
.wp-pad__box > * { max-height: 420px; }
.wp-pad__box[data-size="s"] > * { max-width: 160px; }
.wp-pad__box[data-size="m"] > * { max-width: 260px; }
.wp-pad__looks { display: flex; flex-direction: column; gap: 6px; }
.wp-pad__looks-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.wp-pad__looks-end { justify-content: flex-end; }
.wp-pad__lbl { width: 38px; flex: none; font-size: 11px; color: var(--wp-text-muted, var(--wp-text2)); }
.wp-pad__check { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; cursor: pointer; }
.wp-pad__grid { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--wp-text-muted, var(--wp-text2)); }
.wp-pad__grid { flex: none; }
.wp-pad__grid-num { width: 72px; flex: none; }
</style>
