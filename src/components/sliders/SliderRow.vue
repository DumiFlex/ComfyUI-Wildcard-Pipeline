<script setup lang="ts">
/**
 * One slider row of WP Slider (its settings open in `SliderEditWindow.vue`).
 * Its `style` picks the kit Slider's look: `row` (name column, thin track),
 * `bar` (the name inside a filled bar) or `fader` (an upright track with the
 * name under it; `SlidersWidget.vue` stands neighbouring faders side by
 * side, and the edit view draws a fader as a row with `flat`). Stateless: the parent (`SlidersWidget.vue`) applies every change this
 * emits.
 *
 * The row carries `data-wp-out="value_<out>"` while it has an output, so
 * `extension/row-outputs.ts` puts that number dot at the row's right edge.
 * The track stops pointer events at the row, so dragging the thumb never
 * drags the node (Nodes 2.0 starts a node drag from any pointerdown that
 * reaches the node).
 */
import { computed } from "vue";
import Slider from "@/kit/Slider.vue";
import WpIconButton from "@/kit/WpIconButton.vue";
import { vTooltip } from "@/kit/tooltip";
import { varColorClass } from "../shared/var-color";
import { fineStepOf, fmtSlider, hasSliderDot, sliderMarks, wordFor, type SliderRow } from "../../extension/sliders";
import ToggleCtlButton from "../toggles/ToggleCtlButton.vue";
import { ctlInputName, type ControlState, type FocusSpotView } from "../../extension/toggle-control";

const props = defineProps<{
  s: SliderRow;
  problem?: string | undefined;
  editing: boolean;
  /** Edit view: show the pencil, globe and remove buttons. */
  editable: boolean;
  /** Draw a fader as a row (the edit view's list). */
  flat?: boolean | undefined;
  /** What the variable gets now (`sliderWrites`), for the hover. */
  writes?: string | undefined;
  /** What its levels do to other nodes now (WP Slider), for the row icon. */
  control?: ControlState | undefined;
  /** Where those nodes are, for the icon's menu. */
  spots?: FocusSpotView[] | undefined;
}>();

const emit = defineEmits<{
  "set-value": [value: number];
  patch: [patch: Partial<SliderRow>];
  edit: [];
  remove: [];
  /** Glide the canvas to one of its mute / bypass targets. */
  show: [key: string];
}>();

const looks = computed(() => {
  const st: Record<string, string> = {};
  if (props.s.icon_color) st["--wp-sl-icon"] = props.s.icon_color;
  if (props.s.text_color) st["--wp-sl-text"] = props.s.text_color;
  return st;
});
/** `tint` stands in for the accent the track and thumb are drawn with. */
const tintStyle = computed(() => (props.s.tint ? { "--wp-accent": props.s.tint } : undefined));
/** What the variable holds now, beside `$var`: the word in Words mode. */
const holds = computed(() => {
  if (props.s.mode === "words") return wordFor(props.s)?.word ?? "";
  if (props.s.mode === "text") return "text";
  return "";
});
const marks = computed(() => sliderMarks(props.s));
/** The hover: the whole name and what the variable gets, which a narrow
 *  row or a long word cuts short. */
const tip = computed(() => {
  const head = props.s.name || "Slider";
  if (!props.s.var) return head;
  const got = props.writes ?? "";
  return `${head}\n$${props.s.var} → ${got === "" ? "(empty)" : got}`;
});
const fmt = (v: number): string => fmtSlider({ value: v, decimals: props.s.decimals });
const broken = computed(() => props.s.max <= props.s.min);
/** The wire dot of its levels sits level with the row (not in the edit
 *  view's list, which is another copy of the row). */
const socket = computed(() => (!props.editable && hasSliderDot(props.s) ? ctlInputName(props.s.id) : undefined));
const variant = computed(() => {
  if (props.s.style === "bar") return "bar";
  return props.s.style === "fader" && !props.flat ? "fader" : "line";
});
const fine = computed(() => fineStepOf(props.s));

function internalHint(): string {
  const v = `$${props.s.var}`;
  return props.s.internal
    ? `Internal: ${v} is for rules only and stays out of the Assembler. Click to show it there`
    : `${v} shows in the Assembler. Mark internal to keep it for rules only`;
}
</script>

<template>
  <div class="wp-slr" :class="`wp-slr--${variant}`" :data-wp-vars="s.var || undefined">
    <div
      class="wp-slr__row"
      :class="{ 'is-editing': editing, 'is-editable': editable, 'has-text-color': !!s.text_color, 'is-locked': !!s.lock }"
      :data-wp-socket="socket"
      :data-wp-out="s.pin && s.out && variant !== 'fader' ? `value_${s.out}` : undefined"
      :data-test="`sl-row-${s.id}`"
      :style="looks"
    >
      <span v-if="variant === 'line'" class="wp-slr__head">
      <i v-if="s.icon" class="pi wp-slr__icon" :class="`pi-${s.icon}`" aria-hidden="true" />
      <span v-tooltip="editable ? undefined : tip" class="wp-slr__name">
        <b>{{ s.name }}</b>
        <span v-if="!s.hide_var" class="wp-slr__sub">
          <span :class="s.var ? varColorClass(s.var) : 'is-dim'">{{ s.var ? `$${s.var}` : "no variable" }}</span>
          <span v-if="holds" class="wp-slr__holds" :data-test="`sl-holds-${s.id}`">{{ holds }}</span>
        </span>
      </span>
      </span>
      <!-- Stops the pointer here so a drag on the track never drags the node. -->
      <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
      <span class="wp-slr__ctl" :style="tintStyle" @pointerdown.stop>
        <Slider
          :model-value="s.value"
          :min="s.min"
          :max="broken ? s.min + 1 : s.max"
          :step="s.step"
          :fine-step="fine"
          :free="!!s.free && !!fine"
          :marks="marks.length ? marks : undefined"
          :format="fmt"
          :disabled="broken || !!s.lock"
          :variant="variant"
          size="sm"
          :with-input="variant !== 'fader'"
          :show-value="variant === 'fader'"
          :aria-label="s.name"
          :data-test="`sl-ctl-${s.id}`"
          @update:model-value="(v: number) => emit('set-value', v)"
        >
          <template v-if="variant !== 'line'" #label>
            <span class="wp-slr__in">
              <span v-tooltip="editable ? undefined : tip" class="wp-slr__in-head">
                <i v-if="s.icon" class="pi wp-slr__icon" :class="`pi-${s.icon}`" aria-hidden="true" />
                <span class="wp-slr__in-name">{{ s.name }}</span>
              </span>
              <span v-if="!s.hide_var && s.var" class="wp-slr__in-var" :class="varColorClass(s.var)">${{ s.var }}</span>
              <span v-if="variant === 'bar' && holds" class="wp-slr__holds">{{ holds }}</span>
            </span>
          </template>
        </Slider>
      </span>
      <ToggleCtlButton v-if="control" :state="control" :spots="spots ?? []" :toggle-id="s.id" @show="(k: string) => emit('show', k)" />
      <WpIconButton
        v-if="s.lock || editable"
        icon="pi-lock"
        :pressed="!!s.lock"
        :label="s.lock ? `Unlock ${s.name}` : `Lock ${s.name}`"
        :hint="s.lock ? 'Locked: the value can\'t be dragged. Click to unlock' : 'Lock the value so a drag can\'t move it'"
        :data-test="`sl-lock-${s.id}`"
        @click="emit('patch', { lock: s.lock ? undefined : true })"
      />
      <i
        v-if="problem"
        v-tooltip="problem"
        class="pi pi-exclamation-triangle wp-slr__warn"
        role="img"
        :aria-label="problem"
      />
      <span v-if="editable" class="wp-slr__btns">
        <WpIconButton icon="pi-pencil" :pressed="editing" :label="`Edit ${s.name}`" :data-test="`sl-edit-${s.id}`" @click="emit('edit')" />
        <WpIconButton
          v-if="s.var"
          icon="pi-globe"
          tone="accent"
          :pressed="!!s.internal"
          :label="s.internal ? 'Unmark internal' : 'Mark internal'"
          :hint="internalHint()"
          :data-test="`sl-internal-${s.id}`"
          @click="emit('patch', { internal: s.internal ? undefined : true })"
        />
        <WpIconButton icon="pi-trash" tone="danger" :label="`Remove ${s.name}`" :data-test="`sl-remove-${s.id}`" @click="emit('remove')" />
      </span>
    </div>
  </div>
</template>

<style scoped>
.wp-slr { display: flex; flex-direction: column; min-width: 0; }
.wp-slr__row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 2px 6px 2px 8px;
  background: var(--wp-bg2, var(--wp-bg-1));
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  box-sizing: border-box;
  min-width: 0;
}
.wp-slr__row.is-editing { box-shadow: inset 0 0 0 1px var(--wp-accent); }
.wp-slr__icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: 13px;
  line-height: 1;
  color: var(--wp-sl-icon, var(--wp-text-muted, var(--wp-text2)));
}
/* Icon + name share one column, so every track starts at the same x. */
.wp-slr__head { display: flex; align-items: center; gap: 6px; flex: 0 1 36%; min-width: 56px; max-width: 170px; }
.wp-slr__name { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; }
/* The row buttons take room in the edit view: the name gives it up first. */
.wp-slr__row.is-editable .wp-slr__head { flex-basis: 28%; }
.wp-slr__name b {
  font-weight: 600;
  font-size: 12px;
  line-height: 16px;
  color: var(--wp-sl-text, inherit);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-slr__sub {
  display: flex;
  gap: 5px;
  min-width: 0;
  font: 10.5px/14px var(--wp-font-mono, monospace);
  overflow: hidden;
  white-space: nowrap;
}
.wp-slr__sub > span { overflow: hidden; text-overflow: ellipsis; }
.wp-slr__row.has-text-color .wp-slr__sub > span:first-child { color: var(--wp-sl-text); }
.wp-slr__sub .is-dim { font-family: var(--wp-font-sans, sans-serif); font-style: italic; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-slr__holds { font-family: var(--wp-font-sans, sans-serif); color: var(--wp-text-muted, var(--wp-text2)); }
.wp-slr__ctl { display: flex; flex: 1 1 0; min-width: 0; }
.wp-slr__ctl > * { flex: 1 1 auto; min-width: 0; }
/* Bar and fader: the name sits in the kit Slider's label slot. */
.wp-slr__in { display: inline-flex; align-items: center; gap: 5px; min-width: 0; overflow: hidden; white-space: nowrap; }
.wp-slr__in-head { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.wp-slr__in-name { font-weight: 600; font-size: 11.5px; color: var(--wp-sl-text, inherit); overflow: hidden; text-overflow: ellipsis; }
.wp-slr__in-var { font: 10.5px var(--wp-font-mono, monospace); overflow: hidden; text-overflow: ellipsis; }
.wp-slr__row.has-text-color .wp-slr__in-var { color: var(--wp-sl-text); }
.wp-slr--bar .wp-slr__row { padding-left: 4px; }
/* A fader: one upright column, no row box (the strip draws it). */
.wp-slr--fader .wp-slr__row { flex-direction: column; min-height: 0; padding: 4px 2px; background: transparent; }
.wp-slr--fader .wp-slr__ctl { --wp-slider-len: 104px; justify-content: center; }
.wp-slr--fader .wp-slr__ctl > * { flex: none; }
.wp-slr--fader .wp-slr__in { flex-direction: column; gap: 1px; max-width: 72px; }
/* One line for icon + name, so faders with and without an icon line up. */
.wp-slr--fader .wp-slr__in-head { max-width: 100%; }
.wp-slr--fader .wp-slr__icon { width: 12px; height: 12px; font-size: 11px; }
.wp-slr--fader .wp-slr__in-name { font-size: 10.5px; text-align: center; }
.wp-slr--fader .wp-slr__in-var { max-width: 100%; font-size: 9.5px; }
/* Muted / bypassed: the row stays readable but steps back. */
/* The levels' mute / bypass icon (ToggleCtlButton), coloured like WP Toggles'. */
.wp-tgr__ctlicon { flex: none; font-size: 10px; color: var(--wp-text-dim, var(--wp-text3)); opacity: 0.7; }
.wp-tgr__ctlicon.is-active { opacity: 1; }
.wp-tgr__ctlicon.is-active.is-bypass { color: var(--wp-violet); }
.wp-tgr__ctlicon.is-active.is-mute { color: var(--wp-amber, var(--wp-warn)); }
/* A locked track keeps its colour; only the drag is off. */
.wp-slr__row.is-locked :deep(.wp-slider[data-disabled]) { opacity: 1; }
.wp-slr__row.is-locked :deep(.wp-slider[data-disabled] .wp-slider__thumb) { cursor: not-allowed; }
.wp-slr__warn { flex: none; font-size: 11px; color: var(--wp-amber, var(--wp-warn)); }
.wp-slr__btns { display: inline-flex; align-items: center; gap: 2px; flex: none; }
/* A narrow node (the host is the `wp-node` container): a line row puts its
   name over the track, so neither is squeezed. */
@container wp-node (max-width: 299px) {
  .wp-slr--line .wp-slr__row { flex-wrap: wrap; row-gap: 2px; padding-block: 4px; }
  .wp-slr--line .wp-slr__head { flex: 1 0 100%; max-width: none; }
  .wp-slr--line .wp-slr__ctl { flex-basis: 0; }
}
</style>
