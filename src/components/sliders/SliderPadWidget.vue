<script setup lang="ts">
/**
 * SliderPadWidget — DOM widget for WP_Slider2D: one XY pad (kit `XYPad`),
 * and with `dims` 3 for WP_Slider3D: the pad plus a Z fader (kit `Slider`,
 * the pad's `ring` showing Z), or the Orbit style (kit `OrbitPad`: X turns
 * round the subject, Y is the height, Z the distance) for a camera or a
 * light, whose word presets (`orbitPreset`) add a phrase row joining the
 * three words, or the Mix style (kit `TrianglePad`: the three axes are
 * shares of a blend, `mixParts` / `mixValues`; `mixPreset` adds a weighted
 * phrase).
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
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from "vue";
import Button from "@/kit/Button.vue";
import Checkbox from "@/kit/Checkbox.vue";
import WpIconButton from "@/kit/WpIconButton.vue";
import WpNumber from "@/kit/WpNumber.vue";
import OrbitPad from "@/kit/OrbitPad.vue";
import TrianglePad from "@/kit/TrianglePad.vue";
import Slider from "@/kit/Slider.vue";
import WpSegmented from "@/kit/WpSegmented.vue";
import XYPad from "@/kit/XYPad.vue";
import { stepDots } from "@/kit/xy-pad";
import { vTooltip } from "@/kit/tooltip";
import { vToggleRow } from "@/kit/toggle-row";
import { varColorClass } from "../shared/var-color";
import {
  fineStepOf,
  fmtSlider,
  mixParts,
  mixPreset,
  mixStep,
  mixValues,
  orbitPreset,
  orbitReady,
  padAxes,
  padBands,
  padPhrase,
  padRatio,
  phrasePreview,
  type OrbitKind,
  sliderProblems,
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
    /** 2: WP Slider 2D (X, Y); 3: WP Slider 3D (X, Y, Z + a phrase). */
    dims?: 2 | 3;
    /** Litegraph mode: 2 = muted, 4 = bypassed (dims the widget). */
    nodeMode?: number;
    /** Bumped by the pencil in ComfyUI's selection toolbar. */
    editRequest?: number;
    upstreamVars?: string[];
    varProducers?: Map<string, VarProducerLike> | undefined;
    nodeTitle?: string;
  }>(),
  { dims: 2, nodeMode: 0, editRequest: 0, upstreamVars: () => [], varProducers: undefined, nodeTitle: "" },
);
const emit = defineEmits<{ "update:modelValue": [next: SlidersConfig] }>();

const STYLES = [
  { value: "pad", label: "Pad", icon: "pi-stop", hint: "The plain pad" },
  { value: "size", label: "Size", icon: "pi-expand", hint: "A picture size: the box is shaded, with 1:1, 4:3, 16:9 … guide lines and a W × H readout" },
  { value: "stick", label: "Stick", icon: "pi-circle", hint: "Round, with zero in the middle (set both ranges from -1 to 1)" },
  { value: "map", label: "Map", icon: "pi-map", hint: "Each Words axis shows its words on the pad" },
];
const ORBIT_STYLE = { value: "orbit", label: "Orbit", icon: "pi-video", hint: "A camera or a light round the subject: X turns round it, Y is the height, Z the distance" };
const MIX_STYLE = { value: "mix", label: "Mix", icon: "pi-percentage", hint: "A blend of three things: the closer the point to a corner, the more of it; the three add up to one" };
const LOOKS = [
  { value: "camera", label: "Camera", icon: "pi-camera", hint: "Drawn as a camera" },
  { value: "light", label: "Light", icon: "pi-sun", hint: "Drawn as a light (an amber sun)" },
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
const axes = computed(() => padAxes(props.modelValue, props.dims));
const ax = computed(() => axes.value[0]);
const ay = computed(() => axes.value[1]);
const az = computed(() => (props.dims === 3 ? axes.value[2] : undefined));
const phrase = computed(() => (props.dims === 3 ? padPhrase(props.modelValue) : undefined));
const phraseText = computed(() => phrasePreview(props.modelValue));
const styles = computed(() => (props.dims === 3 ? [...STYLES, ORBIT_STYLE, MIX_STYLE] : STYLES));
/** The rows to show and edit by number: the axes, then the phrase. */
const editRows = computed(() => [...axes.value, ...(phrase.value ? [phrase.value] : [])]);
const TAGS = ["X", "Y", "Z"] as const;
const windowAxis = computed(() => (editing.value === null ? undefined : (TAGS[editing.value] ?? "Phrase")));
const pad = computed<PadLooks>(() => props.modelValue.pad ?? {});
const problems = computed(() => sliderProblems(props.modelValue));
const problemText = computed(() => [...problems.value.values()].join(" · "));

/** New axes (and the phrase kept unless `withPhrase` says otherwise). */
function emitRows(rows: SliderRow[], padNext: PadLooks = pad.value, withPhrase = phrase.value): void {
  const next: SlidersConfig = { version: 1, rows: [...rows, ...(withPhrase ? [withPhrase] : [])] };
  if (Object.keys(padNext).length) next.pad = padNext;
  emit("update:modelValue", next);
}
function setPad(p: Partial<PadLooks>): void {
  const next: Record<string, unknown> = { ...pad.value, ...p };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  emitRows(axes.value, next as PadLooks);
}
function setValues(vals: number[]): void {
  emitRows(axes.value.map((s, i) => (vals[i] === undefined ? s : { ...s, value: vals[i] ?? s.value })));
}
function setZ(v: number): void {
  const z = az.value;
  if (z) setValues([ax.value?.value ?? 0, ay.value?.value ?? 0, v]);
}
/** The mouse wheel over the pad moves Z by a step. */
function onWheel(ev: WheelEvent): void {
  const z = az.value;
  if (!z || special.value || ev.deltaY === 0) return;
  ev.preventDefault();
  ev.stopPropagation();
  const next = z.value + (ev.deltaY < 0 ? 1 : -1) * z.step;
  setZ(Math.min(z.max, Math.max(z.min, Number(next.toFixed(z.decimals)))));
}
const zMax = computed(() => (az.value && az.value.max > az.value.min ? az.value.max : (az.value?.min ?? 0) + 1));
const ring = computed(() => (az.value ? (az.value.value - az.value.min) / (zMax.value - az.value.min) : undefined));
const fmtZ = (v: number): string => fmtSlider({ value: v, decimals: az.value?.decimals ?? 2 });
/** The Z fader stands as tall as the pad (less its value and name lines). */
const zLen = ref(120);
let zObs: ResizeObserver | null = null;
function watchPadHeight(el: unknown): void {
  zObs?.disconnect();
  zObs = null;
  const box = el instanceof HTMLElement ? el : null;
  const padEl = box?.querySelector<HTMLElement>(".wp-xypad");
  if (!padEl || typeof ResizeObserver === "undefined") return;
  zObs = new ResizeObserver(() => { zLen.value = Math.max(60, Math.round(padEl.getBoundingClientRect().height) - 76); });
  zObs.observe(padEl);
}
onBeforeUnmount(() => zObs?.disconnect());
/** Orbit: the light look, and the word sets. */
const orbitLook = computed<OrbitKind>(() => (pad.value.light ? "light" : "camera"));
function usePreset(kind: OrbitKind): void {
  emit("update:modelValue", orbitPreset(props.modelValue, kind));
}
const fmtOrbit = (v: number, part: "around" | "height" | "distance"): string => {
  const s = part === "around" ? ax.value : part === "height" ? ay.value : az.value;
  if (!s) return String(v);
  const row = { ...s, value: v };
  return s.mode === "words" ? (wordFor(row)?.word ?? fmtSlider(row)) : part === "distance" ? fmtSlider(row) : `${fmtSlider(row)}°`;
};
/** Mix: the three shares, set from the triangle. */
const mixShares = computed(() => mixParts(axes.value));
const mixLabels = computed<[string, string, string]>(() => [ax.value?.name ?? "X", ay.value?.name ?? "Y", az.value?.name ?? "Z"]);
function setMix(shares: number[]): void {
  setValues(mixValues(axes.value, shares));
}
function useMixExample(): void {
  emit("update:modelValue", mixPreset(props.modelValue));
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
/** Orbit and Mix draw their own pad: no shape, dots, lines or swap. */
const special = computed(() => style.value === "orbit" || style.value === "mix");
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
  // Orbit needs an angle round (-180..180) and a height: start from the camera words.
  if (v === "orbit" && !orbitReady(props.modelValue)) return usePreset(orbitLook.value);
  // Mix with nothing to blend yet (no phrase): start from the style example.
  if (v === "mix" && !phrase.value) return useMixExample();
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
const editing = ref<number | null>(null);
watch(() => props.editRequest, () => {
  editMode.value = !editMode.value;
  if (!editMode.value) editing.value = null;
});
const editingRow = computed(() => (editing.value === null ? undefined : editRows.value[editing.value]));
const valueVars = computed(() => [...new Set([...props.upstreamVars, ...axes.value.map((s) => s.var).filter(Boolean)])]);
function applyWindow(next: SliderRow): void {
  const i = editing.value;
  editing.value = null;
  if (i === null) return;
  if (i >= axes.value.length) {
    const p = phrase.value;
    if (p) emitRows(axes.value, pad.value, { ...next, id: p.id, kind: "slider", pin: false, out: 0 });
    return;
  }
  emitRows(axes.value.map((s, j) => (j === i ? { ...next, id: s.id, kind: "slider", pin: true, out: j + 1 } : s)));
}
</script>

<template>
  <div class="wp-pad" :class="{ 'wp-pad--skipped': isSkipped }" data-wp-reveal>
    <div class="wp-pad__read" :data-dims="dims">
      <template v-for="(s, i) in axes" :key="s.id">
        <span class="wp-pad__axis" :style="s.text_color ? { '--wp-pad-text': s.text_color } : undefined" :data-wp-vars="s.var || undefined" :data-test="`pad-axis-${i}`">
          <span class="wp-pad__tag">{{ TAGS[i] }}</span>
          <i v-if="s.icon" class="pi wp-pad__icon" :class="`pi-${s.icon}`" :style="s.icon_color ? { color: s.icon_color } : undefined" aria-hidden="true" />
          <span class="wp-pad__name">
            <b>{{ s.name }}</b>
            <span v-if="!s.hide_var" class="wp-pad__sub">
              <span :class="s.var ? varColorClass(s.var) : 'is-dim'">{{ s.var ? `$${s.var}` : "no variable" }}</span>
              <span v-if="holds(s) && !phrase" class="wp-pad__holds">{{ holds(s) }}</span>
            </span>
          </span>
          <span class="wp-pad__num">{{ fmtSlider(s) }}</span>
          <WpIconButton v-if="editMode" icon="pi-pencil" :pressed="editing === i" :label="`Edit ${s.name}`" :data-test="`pad-edit-${i}`" @click="editing = editing === i ? null : i" />
        </span>
      </template>
      <i v-if="problemText" v-tooltip="problemText" class="pi pi-exclamation-triangle wp-pad__warn" role="img" :aria-label="problemText" />
    </div>
    <div v-if="phrase" class="wp-pad__phrase" :data-wp-vars="phrase.var || undefined" data-test="pad-phrase">
      <span :class="phrase.var ? varColorClass(phrase.var) : 'is-dim'">{{ phrase.var ? `$${phrase.var}` : "no variable" }}</span>
      <span class="wp-pad__phrase-text">{{ phraseText }}</span>
      <WpIconButton v-if="editMode" icon="pi-pencil" :pressed="editing === axes.length" :label="`Edit ${phrase.name}`" data-test="pad-edit-phrase" @click="editing = editing === axes.length ? null : axes.length" />
    </div>
    <!-- Stops the pointer here so a drag on the pad never drags the node. -->
    <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
    <div v-if="ax && ay && az && style === 'orbit'" class="wp-pad__box" :data-size="pad.size ?? 'l'" @pointerdown.stop>
      <OrbitPad
        :model-value="[ax.value, ay.value, az.value]"
        :around-step="stepOf(ax)"
        :height-min="Math.max(-90, ay.min)"
        :height-max="Math.min(90, ay.max > ay.min ? ay.max : ay.min + 1)"
        :height-step="stepOf(ay)"
        :distance-min="az.min"
        :distance-max="zMax"
        :distance-step="stepOf(az)"
        :variant="orbitLook"
        :around-label="ax.name"
        :height-label="ay.name"
        :distance-label="az.name"
        :format="fmtOrbit"
        :aria-label="phrase?.name ?? 'Orbit'"
        size="sm"
        data-test="orbit"
        @update:model-value="setValues"
      />
    </div>
    <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
    <div v-else-if="ax && ay && az && style === 'mix'" class="wp-pad__box" :data-size="pad.size ?? 'l'" @pointerdown.stop>
      <TrianglePad
        :model-value="mixShares"
        :labels="mixLabels"
        :step="mixStep(axes)"
        :aria-label="phrase?.name ?? 'Mix'"
        size="sm"
        data-test="mix"
        @update:model-value="setMix"
      />
    </div>
    <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
    <div v-else-if="ax && ay" :ref="az ? watchPadHeight : undefined" class="wp-pad__box" :data-size="pad.size ?? 'l'" :data-z="az ? '' : undefined" :style="ay.tint || ax.tint ? { '--wp-accent': ax.tint ?? ay.tint } : undefined" @pointerdown.stop @wheel="onWheel">
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
        :ring="ring"
        size="sm"
        data-test="pad"
        @update:model-value="setValues"
      />
      <Slider
        v-if="az"
        class="wp-pad__z"
        :model-value="az.value"
        variant="fader"
        :min="az.min"
        :max="zMax"
        :step="stepOf(az)"
        :format="fmtZ"
        :style="{ '--wp-slider-len': `${zLen}px` }"
        :aria-label="az.name"
        size="sm"
        data-test="pad-z"
        @update:model-value="setZ"
      ><template #label>{{ az.name }}</template></Slider>
    </div>
    <div v-if="editMode" class="wp-pad__looks" data-test="pad-looks">
      <div class="wp-pad__looks-row">
        <span class="wp-pad__lbl">Style</span>
        <WpSegmented :model-value="style" :options="styles" size="sm" aria-label="Pad style" test-prefix="pad-style" @update:model-value="setStyle" />
      </div>
      <div v-if="style === 'orbit'" class="wp-pad__looks-row">
        <span class="wp-pad__lbl">Look</span>
        <WpSegmented :model-value="orbitLook" :options="LOOKS" size="sm" aria-label="Orbit look" test-prefix="orbit-look" @update:model-value="(v: string) => setPad({ light: v === 'light' ? true : undefined })" />
      </div>
      <div v-if="style === 'orbit'" class="wp-pad__looks-row">
        <span class="wp-pad__lbl">Words</span>
        <Button size="sm" icon="pi-camera" hint="Camera words on all three axes: front-left view, high angle, medium shot (replaces their ranges and words)" data-test="orbit-camera" @click="usePreset('camera')">Camera words</Button>
        <Button size="sm" icon="pi-sun" hint="Light words on all three axes: light from the front-left, high light, soft light (replaces their ranges and words)" data-test="orbit-light" @click="usePreset('light')">Light words</Button>
      </div>
      <div v-if="style === 'mix'" class="wp-pad__looks-row">
        <span class="wp-pad__lbl">Start</span>
        <Button size="sm" icon="pi-palette" hint="Three art styles 0 to 1 and a phrase that weights them: (watercolor:0.40), (ink sketch:0.30), (oil painting:0.30) (replaces the axes and the phrase)" data-test="mix-example" @click="useMixExample">Style example</Button>
        <WpSegmented :model-value="pad.size ?? 'l'" :options="SIZES" size="sm" aria-label="Pad size" test-prefix="mix-size" @update:model-value="(v: string) => setPad({ size: v === 'l' ? undefined : (v as 's' | 'm') })" />
      </div>
      <div v-if="!special" class="wp-pad__looks-row">
        <span class="wp-pad__lbl">Shape</span>
        <WpSegmented :model-value="shape" :options="SHAPES" size="sm" aria-label="Pad shape" test-prefix="pad-shape" :disabled="style === 'stick'" @update:model-value="setShape" />
        <WpSegmented :model-value="pad.size ?? 'l'" :options="SIZES" size="sm" aria-label="Pad size" test-prefix="pad-size" @update:model-value="(v: string) => setPad({ size: v === 'l' ? undefined : (v as 's' | 'm') })" />
      </div>
      <div v-if="!special" class="wp-pad__looks-row">
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
        <Button v-if="!special" size="sm" icon="pi-arrow-right-arrow-left" hint="Swap the axes: X's settings go up, Y's across" data-test="pad-swap" @click="swap">Swap</Button>
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
      :node-title="nodeTitle || (dims === 3 ? 'WP Slider 3D' : 'WP Slider 2D')"
      :axis="windowAxis"
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
.wp-pad__read[data-dims="3"] { grid-template-columns: repeat(3, minmax(0, 1fr)) auto; }
.wp-pad__phrase {
  display: flex; align-items: center; gap: 6px; min-width: 0; padding: 2px 6px;
  font: 10.5px/16px var(--wp-font-mono, monospace);
  background: var(--wp-bg2, var(--wp-bg-1)); border-radius: min(4px, var(--wp-radius-cap, 999px));
}
.wp-pad__phrase > span { flex: none; }
.wp-pad__phrase .is-dim { font-family: var(--wp-font-sans, sans-serif); font-style: italic; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-pad__phrase .wp-pad__phrase-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--wp-font-sans, sans-serif); font-size: 11.5px; color: var(--wp-text); }
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
.wp-pad__box[data-z] { gap: 8px; align-items: stretch; }
.wp-pad__box[data-z] > .wp-xypad { flex: 1 1 auto; min-width: 0; }
.wp-pad__box > .wp-pad__z { flex: none; }
.wp-pad__box > * { max-height: 420px; }
.wp-pad__box > .wp-tri { max-width: 320px; }
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
