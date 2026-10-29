<script setup lang="ts">
/**
 * LabelGridWidget — DOM widget for WP_LabelGrid.
 *
 * Two sections:
 *  - LABEL: the text drawn on each image (a template over the incoming
 *    label), where it sits, its font and colours.
 *  - GRID: on/off, a row of presets that follow the shape of the run (one
 *    batch, single images, a loop's batches, a sweep), then the layout,
 *    headers, title, spacing and colours the preset leaves to you.
 *
 * After a run the node sends what came in (`LabelGridRun`); the widget says
 * it in one line and marks the preset that fits it.
 *
 * Value contract: `modelValue` is a `LabelGridConfig`; every edit emits the
 * whole next config (`src/widgets/label_grid.ts` serializes it).
 */
import { computed } from "vue";
import WpButton from "../shared/WpButton.vue";
import WpNumber from "../shared/WpNumber.vue";
import WpSegmented from "../shared/WpSegmented.vue";
import WpSelect from "../shared/WpSelect.vue";
import WpSwitch from "../shared/WpSwitch.vue";
import Combobox from "../shared/Combobox.vue";
import ColorField from "../shared/ColorField.vue";
import { vTooltip } from "../shared/tooltip";
import {
  DEFAULT_LABEL_GRID_CONFIG,
  type GridArrange,
  type LabelAlign,
  type LabelGridConfig,
  type LabelGridRun,
} from "../../extension/label-grid";
import {
  PRESETS,
  applyPreset,
  describeRun,
  headerSourceOptions,
  matchPreset,
  suggestPreset,
  type PresetId,
} from "./presets";

const props = withDefaults(
  defineProps<{
    modelValue: LabelGridConfig;
    lastRun?: LabelGridRun | null;
    /** Fonts this machine has ("default" first). */
    fonts?: string[];
    /** Litegraph mode: 2 = muted, 4 = bypassed (dims the widget). */
    nodeMode?: number;
    /** Text inputs wired from other nodes (`title`, `row_headers`,
     *  `column_headers`); a wired one replaces the panel's value. */
    wired?: string[];
  }>(),
  { lastRun: null, fonts: () => ["default"], nodeMode: 0, wired: () => [] },
);
const emit = defineEmits<{ "update:modelValue": [next: LabelGridConfig] }>();

const cfg = computed(() => props.modelValue);
const isSkipped = computed(() => props.nodeMode === 2 || props.nodeMode === 4);

function set<K extends keyof LabelGridConfig>(key: K, value: LabelGridConfig[K]): void {
  if (cfg.value[key] === value) return;
  emit("update:modelValue", { ...cfg.value, [key]: value });
}

/* ── label ────────────────────────────────────────────────────────────── */

type Side = "top" | "bottom" | "left" | "right" | "none";
const SIDES: { value: Side; label: string; icon: string }[] = [
  { value: "top", label: "Above the image", icon: "pi-arrow-up" },
  { value: "bottom", label: "Below the image", icon: "pi-arrow-down" },
  { value: "left", label: "Left of the image", icon: "pi-arrow-left" },
  { value: "right", label: "Right of the image", icon: "pi-arrow-right" },
  { value: "none", label: "No label", icon: "pi-ban" },
];
const side = computed<Side>(() => {
  const p = cfg.value.position;
  return p === "over_top" ? "top" : p === "over_bottom" ? "bottom" : p;
});
const over = computed(() => cfg.value.position.startsWith("over_"));
const canOver = computed(() => side.value === "top" || side.value === "bottom");

function setSide(next: Side): void {
  set("position", over.value && (next === "top" || next === "bottom") ? `over_${next}` : next);
}
/** A band over the image starts see-through when the strip was the plain
 *  default black, so the picture shows under it. */
const SEE_THROUGH_BAND = `${DEFAULT_LABEL_GRID_CONFIG.label_color}99`;

function setOver(on: boolean): void {
  if (!canOver.value) return;
  const s = side.value as "top" | "bottom";
  const next = { ...cfg.value, position: on ? `over_${s}` as const : s };
  if (on && cfg.value.label_color === DEFAULT_LABEL_GRID_CONFIG.label_color) next.label_color = SEE_THROUGH_BAND;
  if (!on && cfg.value.label_color === SEE_THROUGH_BAND) next.label_color = DEFAULT_LABEL_GRID_CONFIG.label_color;
  emit("update:modelValue", next);
}

const ALIGN_OPTIONS: { value: LabelAlign; label: string; icon: string }[] = [
  { value: "left", label: "Align left", icon: "pi-align-left" },
  { value: "center", label: "Centre", icon: "pi-align-center" },
  { value: "right", label: "Align right", icon: "pi-align-right" },
];

const fontOptions = computed(() => {
  const names = props.fonts.includes(cfg.value.font) ? props.fonts : [...props.fonts, cfg.value.font];
  return names.map((f) => ({
    value: f,
    label: f === "default" ? "Default" : f.replace(/\.(ttf|otf|ttc)$/i, ""),
    hint: props.fonts.includes(f) ? undefined : "not on this machine: the default is used",
  }));
});

function setFontSize(v: number | null): void {
  set("font_size", v ?? 0);
}

/** What each token in the label text stands for (shown on hover). */
const TOKENS: { token: string; hint: string }[] = [
  { token: "{label}", hint: "The incoming label from the labels input, e.g. the Image Filter's \"#3 · dawn · pastel\". Empty when nothing is wired." },
  { token: "{frame}", hint: "Which input item the image came from (a loop frame or list entry), counting from 1." },
  { token: "{image}", hint: "The image's place inside its item's batch, counting from 1." },
  { token: "{index}", hint: "The image's place across every image, counting from 1." },
  { token: "{count}", hint: "How many images came in." },
];

const labelPlaceholder = computed(() => (props.lastRun && !props.lastRun.labelled ? "e.g. #{index}" : "{label}"));

/* ── grid ─────────────────────────────────────────────────────────────── */

const activePreset = computed(() => matchPreset(cfg.value));
const suggested = computed(() => suggestPreset(props.lastRun));

function pickPreset(id: PresetId): void {
  emit("update:modelValue", applyPreset(cfg.value, id, props.lastRun));
}
function setGrid(on: boolean): void {
  if (on && activePreset.value === "off") {
    emit("update:modelValue", { ...applyPreset(cfg.value, suggested.value && suggested.value !== "off" ? suggested.value : "auto", props.lastRun) });
    return;
  }
  set("grid", on);
}

const ARRANGE_OPTIONS: { value: GridArrange; label: string }[] = [
  { value: "auto", label: "Fit the run" },
  { value: "rows", label: "One row per frame" },
  { value: "columns", label: "One column per frame" },
  { value: "fill", label: "Fill rows" },
  { value: "strip", label: "All in one row" },
  { value: "stack", label: "All in one column" },
];
const autoNote = computed(() => {
  const a = props.lastRun?.auto;
  if (cfg.value.arrange !== "auto" || !a || a === "auto") return "";
  return `last run: ${ARRANGE_OPTIONS.find((o) => o.value === a)?.label.toLowerCase() ?? a}`;
});

const textWired = computed(() => props.wired.includes("label_text"));
const titleWired = computed(() => props.wired.includes("title"));
const rowsWired = computed(() => props.wired.includes("row_headers"));
const colsWired = computed(() => props.wired.includes("column_headers"));

const headerOptions = computed(() => headerSourceOptions(props.lastRun));
const headersLift = computed(() =>
  (!rowsWired.value && cfg.value.rows_from.startsWith("part:"))
  || (!colsWired.value && cfg.value.columns_from.startsWith("part:")));

function setCellWidth(v: number | null): void {
  set("cell_width", v ?? 0);
}
function setColumns(v: number | null): void {
  set("columns", v ?? 0);
}

const runLine = computed(() => {
  const run = props.lastRun;
  if (!run) return "";
  const bits = [describeRun(run)];
  if (run.labelled) bits.push("labelled");
  if (run.grid) bits.push(`grid ${run.grid[0]}×${run.grid[1]}`);
  return bits.join(" · ");
});
const suggestedLabel = computed(() => PRESETS.find((p) => p.id === suggested.value)?.label ?? "");

const isDefaultStyle = computed(() => {
  const d = DEFAULT_LABEL_GRID_CONFIG;
  return cfg.value.gap === d.gap && cfg.value.margin === d.margin && cfg.value.cell_width === d.cell_width
    && cfg.value.background === d.background && cfg.value.header_color === d.header_color;
});
function resetStyle(): void {
  const d = DEFAULT_LABEL_GRID_CONFIG;
  emit("update:modelValue", {
    ...cfg.value, gap: d.gap, margin: d.margin, cell_width: d.cell_width,
    background: d.background, header_color: d.header_color,
  });
}

function text(ev: Event): string {
  return (ev.target as HTMLInputElement | HTMLTextAreaElement).value;
}
</script>

<template>
  <div class="wp-lg" :class="{ 'wp-lg--skipped': isSkipped }">
    <div v-if="runLine" class="wp-lg__run" data-test="lg-run">
      <i class="pi pi-images" aria-hidden="true" />
      <span class="wp-lg__run-text">{{ runLine }}</span>
    </div>

    <!-- LABEL ───────────────────────────────────────────────────────── -->
    <section class="wp-lg__section">
      <div class="wp-lg__head">
        <span class="wp-lg__label">LABEL</span>
        <span class="wp-lg__head-note wp-lg__tokens">
          <span
            v-for="t in TOKENS"
            :key="t.token"
            v-tooltip="t.hint"
            class="wp-lg__token"
            tabindex="0"
            :aria-label="`${t.token}: ${t.hint}`"
            :data-test="`lg-token-${t.token.slice(1, -1)}`"
          >{{ t.token }}</span>
        </span>
      </div>
      <span v-if="textWired" class="wp-lg__wired" data-test="lg-template-wired">
        <i class="pi pi-link" aria-hidden="true" />from the label_text input (tokens still work)
      </span>
      <input
        v-else
        class="wp-lg__input wp-lg__template"
        :value="cfg.label"
        :placeholder="labelPlaceholder"
        spellcheck="false"
        aria-label="Label text"
        title="Text drawn on each image. {label} = the incoming label, {frame} and {image} count from 1, {index} across all images, {count} = how many. \n breaks a line. Empty = the incoming label."
        data-test="lg-template"
        @keydown.stop
        @change="set('label', text($event))"
      >
      <div class="wp-lg__row">
        <span class="wp-lg__key">Place</span>
        <WpSegmented
          :model-value="side"
          :options="SIDES"
          size="sm"
          icon-only
          aria-label="Label position"
          test-prefix="lg-side"
          @update:model-value="setSide"
        />
        <WpSwitch
          :model-value="over"
          variant="chip"
          icon="pi-clone"
          label="Over image"
          :disabled="!canOver"
          data-test="lg-over"
          @update:model-value="setOver"
        />
      </div>
      <div v-if="side !== 'none'" class="wp-lg__row">
        <span class="wp-lg__key">Font</span>
        <div class="wp-lg__font" data-test="lg-font">
          <Combobox
            :model-value="cfg.font"
            :options="fontOptions"
            size="sm"
            aria-label="Font"
            @update:model-value="(v) => set('font', typeof v === 'string' && v ? v : 'default')"
          />
        </div>
        <WpNumber
          class="wp-lg__num"
          :model-value="cfg.font_size || null"
          :min="0"
          :max="1024"
          nullable
          placeholder="auto"
          suffix="px"
          aria-label="Font size (empty = automatic)"
          data-test="lg-font-size"
          @update:model-value="setFontSize"
        />
        <WpSegmented
          :model-value="cfg.align"
          :options="ALIGN_OPTIONS"
          size="sm"
          icon-only
          aria-label="Text alignment"
          test-prefix="lg-align"
          @update:model-value="(v) => set('align', v)"
        />
      </div>
      <div v-if="side !== 'none'" class="wp-lg__row">
        <span class="wp-lg__key">Colour</span>
        <ColorField
          :model-value="cfg.text_color"
          aria-label="Text colour"
          data-test="lg-text-color"
          @update:model-value="(v) => set('text_color', v)"
        />
        <span class="wp-lg__key wp-lg__key--inline">{{ over ? 'band' : 'strip' }}</span>
        <ColorField
          :model-value="cfg.label_color"
          alpha
          allow-none
          :aria-label="over ? 'Band colour' : 'Strip colour'"
          data-test="lg-label-color"
          @update:model-value="(v) => set('label_color', v)"
        />
      </div>
    </section>

    <!-- GRID ────────────────────────────────────────────────────────── -->
    <section class="wp-lg__section">
      <div class="wp-lg__head">
        <span class="wp-lg__label">GRID</span>
        <span class="wp-lg__head-note">{{ cfg.grid ? 'one image of every image' : 'off: only the labelled images' }}</span>
        <WpSwitch
          :model-value="cfg.grid"
          aria-label="Make a grid"
          data-test="lg-grid"
          @update:model-value="setGrid"
        />
      </div>

      <div class="wp-lg__presets" role="group" aria-label="Grid presets">
        <WpButton
          v-for="p in PRESETS"
          :key="p.id"
          size="sm"
          :icon="p.icon"
          :pressed="activePreset === p.id"
          :hint="suggested === p.id ? `${p.hint}. Fits the last run.` : p.hint"
          class="wp-lg__preset"
          :class="{ 'is-suggested': suggested === p.id }"
          :data-test="`lg-preset-${p.id}`"
          @click="pickPreset(p.id)"
        >{{ p.label }}</WpButton>
      </div>
      <div v-if="suggested && suggested !== activePreset" class="wp-lg__suggest" data-test="lg-suggest">
        <i class="pi pi-lightbulb" aria-hidden="true" />
        <span><b>{{ suggestedLabel }}</b> fits the last run.</span>
        <WpButton size="sm" variant="link" data-test="lg-suggest-use" @click="pickPreset(suggested)">Use it</WpButton>
      </div>

      <template v-if="cfg.grid">
        <div class="wp-lg__row">
          <span class="wp-lg__key">Layout</span>
          <WpSelect
            class="wp-lg__select"
            :model-value="cfg.arrange"
            :options="ARRANGE_OPTIONS"
            :disabled="headersLift"
            aria-label="Layout"
            data-test="lg-arrange"
            @update:model-value="(v) => set('arrange', v)"
          />
          <WpNumber
            v-if="cfg.arrange === 'fill' && !headersLift"
            class="wp-lg__num"
            :model-value="cfg.columns || null"
            :min="0"
            :max="256"
            nullable
            placeholder="auto"
            suffix="cols"
            aria-label="Columns (empty = near square)"
            data-test="lg-columns"
            @update:model-value="setColumns"
          />
          <span v-else-if="headersLift" class="wp-lg__note">from the label parts</span>
          <span v-else-if="autoNote" class="wp-lg__note">{{ autoNote }}</span>
        </div>
        <div class="wp-lg__row">
          <span class="wp-lg__key">Rows</span>
          <span v-if="rowsWired" class="wp-lg__wired" data-test="lg-rows-wired">
            <i class="pi pi-link" aria-hidden="true" />from the row_headers input
          </span>
          <WpSelect
            v-else
            class="wp-lg__select"
            :model-value="cfg.rows_from"
            :options="headerOptions"
            aria-label="Row headers from"
            data-test="lg-rows-from"
            @update:model-value="(v) => set('rows_from', v)"
          />
        </div>
        <textarea
          v-if="cfg.rows_from === 'typed' && !rowsWired"
          class="wp-lg__input wp-lg__area"
          :value="cfg.row_headers"
          rows="2"
          placeholder="One row header per line"
          spellcheck="false"
          aria-label="Row headers"
          data-test="lg-row-headers"
          @keydown.stop
          @change="set('row_headers', text($event))"
        />
        <div class="wp-lg__row">
          <span class="wp-lg__key">Columns</span>
          <span v-if="colsWired" class="wp-lg__wired" data-test="lg-columns-wired">
            <i class="pi pi-link" aria-hidden="true" />from the column_headers input
          </span>
          <WpSelect
            v-else
            class="wp-lg__select"
            :model-value="cfg.columns_from"
            :options="headerOptions"
            aria-label="Column headers from"
            data-test="lg-columns-from"
            @update:model-value="(v) => set('columns_from', v)"
          />
        </div>
        <textarea
          v-if="cfg.columns_from === 'typed' && !colsWired"
          class="wp-lg__input wp-lg__area"
          :value="cfg.column_headers"
          rows="2"
          placeholder="One column header per line"
          spellcheck="false"
          aria-label="Column headers"
          data-test="lg-column-headers"
          @keydown.stop
          @change="set('column_headers', text($event))"
        />
        <div class="wp-lg__row">
          <span class="wp-lg__key">Title</span>
          <span v-if="titleWired" class="wp-lg__wired" data-test="lg-title-wired">
            <i class="pi pi-link" aria-hidden="true" />from the title input
          </span>
          <input
            v-else
            class="wp-lg__input wp-lg__grow"
            :value="cfg.title"
            placeholder="Drawn above the grid"
            spellcheck="false"
            aria-label="Grid title"
            data-test="lg-title"
            @keydown.stop
            @change="set('title', text($event))"
          >
        </div>
        <div class="wp-lg__row wp-lg__row--wrap">
          <span class="wp-lg__key">Spacing</span>
          <WpNumber
            class="wp-lg__num"
            :model-value="cfg.gap"
            :min="0"
            :max="512"
            suffix="gap"
            aria-label="Gap between cells (px)"
            data-test="lg-gap"
            @update:model-value="(v) => set('gap', v ?? 0)"
          />
          <WpNumber
            class="wp-lg__num"
            :model-value="cfg.margin"
            :min="0"
            :max="1024"
            suffix="edge"
            aria-label="Margin around the grid (px)"
            data-test="lg-margin"
            @update:model-value="(v) => set('margin', v ?? 0)"
          />
          <WpNumber
            class="wp-lg__num wp-lg__num--wide"
            :model-value="cfg.cell_width || null"
            :min="0"
            :max="8192"
            nullable
            placeholder="keep size"
            suffix="px"
            aria-label="Cell width (empty = keep each image's size)"
            data-test="lg-cell-width"
            @update:model-value="setCellWidth"
          />
        </div>
        <div class="wp-lg__row">
          <span class="wp-lg__key">Colour</span>
          <ColorField
            :model-value="cfg.background"
            aria-label="Grid background"
            data-test="lg-background"
            @update:model-value="(v) => set('background', v)"
          />
          <span class="wp-lg__key wp-lg__key--inline">headers</span>
          <ColorField
            :model-value="cfg.header_color"
            aria-label="Header and title colour"
            data-test="lg-header-color"
            @update:model-value="(v) => set('header_color', v)"
          />
          <WpButton
            v-if="!isDefaultStyle"
            size="sm"
            variant="ghost"
            icon="pi-undo"
            hint="Put spacing and grid colours back"
            class="wp-lg__reset"
            data-test="lg-reset-style"
            @click="resetStyle"
          >Reset</WpButton>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
/* Layout and tokens follow the Model Info / Cleaner widgets. */

.wp-lg {
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: var(--wp-text);
  font: 12px var(--wp-font-sans, sans-serif);
  /* ComfyUI draws the result preview right under the widget: leave it room. */
  padding: 4px 0 14px;
  min-width: 0;
}
.wp-lg--skipped { opacity: 0.45; }

.wp-lg__run {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: min(3px, var(--wp-radius-cap, 999px));
  font-size: 10px;
  color: var(--wp-text-muted);
}
.wp-lg__run .pi { font-size: 11px; color: var(--wp-accent-text); }
.wp-lg__run-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.wp-lg__section { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.wp-lg__head { display: flex; align-items: center; gap: 8px; min-height: 20px; }
.wp-lg__label {
  font: 600 9px var(--wp-font-sans, sans-serif);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--wp-text-dim);
}
.wp-lg__head-note {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 9px var(--wp-font-mono, monospace);
  color: var(--wp-text-dim);
}

.wp-lg__wired {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: var(--wp-control-h-sm, 24px);
  padding: 0 8px;
  border: 1px dashed var(--wp-border);
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  font-size: 10px;
  color: var(--wp-text-muted);
}
.wp-lg__wired .pi { font-size: 10px; color: var(--wp-accent-text); }
.wp-lg__tokens { display: flex; gap: 6px; }
.wp-lg__token { cursor: help; border-bottom: 1px dotted var(--wp-border-strong); }
.wp-lg__token:hover, .wp-lg__token:focus-visible { color: var(--wp-text-muted); outline: none; }

.wp-lg__row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.wp-lg__row--wrap { flex-wrap: wrap; }
.wp-lg__key {
  flex: none;
  width: 48px;
  font-size: 10px;
  color: var(--wp-text-muted);
}
.wp-lg__key--inline { width: auto; margin-left: 4px; }
.wp-lg__note { font-size: 9px; color: var(--wp-text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.wp-lg__input {
  min-width: 0;
  height: var(--wp-control-h-sm, 24px);
  padding: 0 6px;
  background: var(--wp-bg-1);
  color: var(--wp-text);
  border: 1px solid var(--wp-border);
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  font: 11px var(--wp-font-mono, monospace);
  outline: none;
}
.wp-lg__input:focus { border-color: var(--wp-border-focus); }
.wp-lg__input::placeholder { color: var(--wp-text-dim); font-family: var(--wp-font-sans, sans-serif); }
.wp-lg__area { height: auto; padding: 4px 6px; resize: vertical; margin-left: 54px; }
.wp-lg__grow, .wp-lg__select, .wp-lg__font { flex: 1; min-width: 0; }
.wp-lg__num { width: 84px; flex: none; }
.wp-lg__num--wide { width: 112px; }
.wp-lg__reset { margin-left: auto; }

.wp-lg__presets { display: flex; flex-wrap: wrap; gap: 4px; }
.wp-lg__preset.is-suggested { box-shadow: inset 0 -2px 0 var(--wp-accent); }
.wp-lg__suggest {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--wp-text-muted);
}
.wp-lg__suggest .pi { color: var(--wp-amber); font-size: 11px; }
.wp-lg__suggest b { color: var(--wp-text); font-weight: 600; }
</style>
