<script setup lang="ts">
/**
 * PickerModal — the pause-and-pick screen of WP Image Filter.
 *
 * Three modes behind one switch (G / D / Z), in a window that keeps its size:
 * - Grid picks fast: every image, grouped by frame when a Context Loop (or
 *   any list) produced several, or laid out as a table when the loop swept
 *   two or more wildcards. Click or Space picks; S / M / L / Fit sizes tiles.
 * - Detail shows one image next to its values and edits (prompt, negative,
 *   mask, compare), with a strip of the others. Only what is wired shows.
 * - Zoom shows only the picture, at real zoom levels (WpImageZoom). The level
 *   and spot carry over when ←/→ step, so a series is checked in one place.
 * The pick count and the Keep buttons stay in the footer in every mode.
 * Closing (Escape / clicking outside) steps back a mode, then only minimises
 * it: the run keeps waiting until one of the three answers is sent.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ModalShell from "../shared/ModalShell.vue";
import WpSegmented, { type SegmentedOption } from "../shared/WpSegmented.vue";
import WpImageZoom from "../shared/WpImageZoom.vue";
import CopyButton from "../shared/CopyButton.vue";
import MaskPainter from "./MaskPainter.vue";
import PickerTile from "./PickerTile.vue";
import SweepGrid from "./SweepGrid.vue";
import { pickKey, viewUrl, type Pick, type PickAnswer, type PickEdits, type ImageRef } from "./types";
import type { WaitingRequest } from "../../extension/image-filter";
import { draftPicks, saveDraftPicks, secondsLeft } from "../../extension/image-filter";
import type { LiteGraphLike } from "../../extension/graph";
import { editLoopConfig } from "../../widgets/context_loop";
import { pushToast } from "../shared/toast-store";
import { defaultGridLayout, findLoop, frameParts, loopEdit, sweepGrid, type GridLayout } from "./picker-loop";
import {
  draftEdits, dropDraftEdits, editsFor, fitTileSize, hasEdit, readModePref, readTilePref, saveDraftEdits,
  TILE_PX, withMask, withText, writeModePref, writeTilePref, type PickerMode, type TileSize,
} from "./picker-state";
import { axisHueAt } from "../shared/axis-color";
import { frameValues, promptRuns, valuesText } from "./picker-details";
import WpButton from "../shared/WpButton.vue";
import WpTabs, { type TabItem } from "../shared/WpTabs.vue";
import { vTooltip } from "../shared/tooltip";

const props = withDefaults(
  defineProps<{ request: WaitingRequest; moreWaiting?: number; graph?: LiteGraphLike }>(),
  { moreWaiting: 0, graph: undefined },
);
const emit = defineEmits<{ answer: [answer: PickAnswer]; minimize: [] }>();

interface Cell { frame: number; image: number; ref: ImageRef; key: string }

const frames = computed(() => props.request.frames);
const labels = computed(() => props.request.labels);
const cells = computed<Cell[]>(() =>
  frames.value.flatMap((imgs, f) => imgs.map((ref, i) => ({ frame: f, image: i, ref, key: pickKey(f, i) }))),
);
const total = computed(() => cells.value.length);
const multiFrame = computed(() => frames.value.length > 1);

const picked = ref<Set<string>>(new Set(draftPicks(props.request.token)));
const edits = ref<PickEdits>(draftEdits(props.request.token));
watch(() => props.request.token, (token) => {
  picked.value = new Set(draftPicks(token));
  edits.value = draftEdits(token);
  comparePin.value = null;
  painting.value = false;
  current.value = 0;
  if (!total.value) mode.value = "grid";
});
watch(picked, (keys) => saveDraftPicks(props.request.token, keys));
watch(edits, (next) => saveDraftEdits(props.request.token, next));

function toggle(key: string): void {
  const next = new Set(picked.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  picked.value = next;
}
function frameKeys(frame: number): string[] {
  return (frames.value[frame] ?? []).map((_, i) => pickKey(frame, i));
}
/** Pick every image of these frames, or clear them when all are picked. */
function toggleFrames(list: readonly number[]): void {
  const keys = list.flatMap((f) => frameKeys(f));
  if (!keys.length) return;
  const allOn = keys.every((k) => picked.value.has(k));
  const next = new Set(picked.value);
  for (const k of keys) {
    if (allOn) next.delete(k);
    else next.add(k);
  }
  picked.value = next;
}
function toggleAll(): void {
  picked.value = picked.value.size === total.value ? new Set() : new Set(cells.value.map((c) => c.key));
}

const pickedList = computed<Pick[]>(() =>
  cells.value.filter((c) => picked.value.has(c.key)).map((c) => [c.frame, c.image] as Pick),
);
const pickedFrameSet = computed(() => new Set(pickedList.value.map(([f]) => f)));
const pickedFrames = computed(() => pickedFrameSet.value.size);

/* ── loop labels, sweep table, send back ──────────────────────────────── */

const loop = computed(() => findLoop(labels.value, props.graph));
const axes = computed(() => loop.value?.axes ?? []);
const layout = ref<GridLayout>(defaultGridLayout());
watch(() => axes.value.map((a) => a.uid).join(" "), () => { layout.value = defaultGridLayout(); });
const grid = computed(() => sweepGrid(labels.value, axes.value, layout.value));
const arrange = ref<"table" | "frames">("table");
const ARRANGE_OPTIONS: SegmentedOption<"table" | "frames">[] = [
  { value: "table", label: "Table", hint: "One swept wildcard down, one across" },
  { value: "frames", label: "Frames", hint: "Every frame in run order" },
];
const showTable = computed(() => arrange.value === "table" && !!grid.value);

function frameTitle(frame: number): string {
  return frameParts(labels.value[frame], frame, axes.value).join(" · ");
}
function shortText(text: string, max = 280): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
function frameTooltip(frame: number): string {
  const l = labels.value[frame];
  const lines = [`Frame ${frameTitle(frame)}`];
  if (typeof l?.seed === "number") lines.push(`Seed ${l.seed}`);
  if (l?.positive) lines.push(`+ ${shortText(l.positive)}`);
  if (l?.negative) lines.push(`− ${shortText(l.negative)}`);
  return lines.join("\n");
}

const canSendToLoop = computed(() => !!loop.value && labels.value.some((l) => typeof l?.loop_index === "number"));

function sendToLoop(): void {
  const link = loop.value;
  if (!link || pickedFrames.value === 0) return;
  let kept = 0;
  let bypassed = 0;
  let locked = 0;
  const ok = editLoopConfig(link.node, (cfg) => {
    const r = loopEdit(cfg, labels.value, pickedFrameSet.value);
    kept = r.kept;
    bypassed = r.bypassed;
    locked = r.locked;
    return r.config;
  });
  if (!ok) {
    pushToast("Couldn't reach the Context Loop node to update it.", { severity: "warning" });
    return;
  }
  pushToast(
    `Context Loop: ${kept} ${kept === 1 ? "frame" : "frames"} kept${locked ? " with locked seeds" : ""}, ${bypassed} bypassed. The next run repeats only your picks.`,
    { severity: "success" },
  );
}

/* ── modes ────────────────────────────────────────────────────────────── */

const mode = ref<PickerMode>(total.value ? readModePref() : "grid");
watch(mode, (m) => writeModePref(m));
const MODE_OPTIONS: SegmentedOption<PickerMode>[] = [
  { value: "grid", label: "Grid", icon: "pi-th-large", hint: "Every image: click or Space to pick", kbd: "G" },
  { value: "detail", label: "Detail", icon: "pi-image", hint: "One image with its values, prompt and mask", kbd: "D" },
  { value: "zoom", label: "Zoom", icon: "pi-search-plus", hint: "Only the picture, at real zoom levels", kbd: "Z" },
];

/** The image Detail and Zoom show. */
const current = ref(Math.max(0, cells.value.findIndex((c) => picked.value.has(c.key))));
const hovered = ref<number | null>(null);
const cell = computed(() => cells.value[current.value] ?? null);

/** The first picked image, else the current one. */
function firstPicked(): number {
  const i = cells.value.findIndex((c) => picked.value.has(c.key));
  return i >= 0 ? i : current.value;
}
/** Switch mode. Leaving Grid, Detail and Zoom open on `at`, else the image
 *  under the mouse, else the first picked one. */
function setMode(next: PickerMode, at: number | null = null): void {
  if (next !== "grid" && !total.value) return;
  if (next !== "grid") {
    if (at !== null) current.value = at;
    else if (mode.value === "grid") current.value = hovered.value ?? firstPicked();
    // The tiles go away without a mouseleave.
    hovered.value = null;
  }
  // Detail and Zoom share the compare pin; Grid drops it.
  if (next === "grid") comparePin.value = null;
  if (next !== "detail") painting.value = false;
  mode.value = next;
}
function step(delta: number): void {
  if (total.value === 0) return;
  current.value = (current.value + delta + total.value) % total.value;
}

/* ── grid: tile size ──────────────────────────────────────────────────── */

const tile = ref<TileSize>(readTilePref());
watch(tile, (t) => writeTilePref(t));
const TILE_OPTIONS = computed<SegmentedOption<TileSize>[]>(() => [
  { value: "s", label: "S", hint: "Small tiles" },
  { value: "m", label: "M", hint: "Medium tiles" },
  { value: "l", label: "L", hint: "Large tiles" },
  ...(showTable.value ? [] : [{ value: "fit" as const, label: "Fit", hint: "As big as the picker allows", kbd: "F" }]),
]);
/** The sweep table has no Fit; it shows M there. */
const tableTile = computed(() => (tile.value === "s" || tile.value === "l" ? TILE_PX[tile.value].table : undefined));

const body = ref<HTMLElement | null>(null);
const bodySize = ref({ width: 0, height: 0 });
const aspect = ref(1);
let observer: ResizeObserver | null = null;
watch(body, (el) => {
  observer?.disconnect();
  if (!el || typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(() => {
    bodySize.value = { width: el.clientWidth - 28, height: el.clientHeight - 24 };
  });
  observer.observe(el);
});
onBeforeUnmount(() => observer?.disconnect());
watch(() => frames.value[0]?.[0], (first) => {
  if (!first || typeof Image === "undefined") return;
  const img = new Image();
  img.onload = () => { if (img.naturalWidth) aspect.value = img.naturalHeight / img.naturalWidth; };
  img.src = viewUrl(first);
}, { immediate: true });
const tileStyle = computed(() => {
  const card = multiFrame.value;
  if (tile.value !== "fit") return { "--wp-ifp-tile": `${TILE_PX[tile.value][card ? "frame" : "flat"]}px` };
  const size = fitTileSize(total.value, aspect.value, {
    // A card adds padding, border and its label; tiles add a 2px border.
    // Leave a few px of slack so rounding never wraps a row.
    ...bodySize.value, gap: 10, extraW: card ? 26 : 8, extraH: card ? 42 : 8,
  });
  return { "--wp-ifp-tile": `${size}px` };
});
const isFit = computed(() => mode.value === "grid" && tile.value === "fit" && !showTable.value);

/* ── detail: compare, values, refine ──────────────────────────────────── */

const comparePin = ref<number | null>(null);
const comparePos = ref(50);
const compareCell = computed(() => {
  const pin = comparePin.value;
  if (pin === null || pin === current.value) return null;
  return cells.value[pin] ?? null;
});
function togglePin(): void {
  comparePin.value = comparePin.value === null ? current.value : null;
  if (comparePin.value !== null) painting.value = false;
}

const painting = ref(false);
const tool = ref<"brush" | "eraser">("brush");
const TOOL_OPTIONS: SegmentedOption<"brush" | "eraser">[] = [{ value: "brush", label: "Brush" }, { value: "eraser", label: "Eraser" }];
const brush = ref(40);
const painter = ref<InstanceType<typeof MaskPainter> | null>(null);
function togglePaint(): void {
  painting.value = !painting.value;
  if (painting.value) comparePin.value = null;
}

/** Natural sizes of the images shown so far, for the "1024 × 1024" line. */
const sizes = ref<Record<string, string>>({});
function onDetailLoad(key: string, ev: Event): void {
  const img = ev.target as HTMLImageElement;
  if (img.naturalWidth) sizes.value = { ...sizes.value, [key]: `${img.naturalWidth} × ${img.naturalHeight}` };
}

const label = computed(() => (cell.value ? labels.value[cell.value.frame] : undefined));
const values = computed(() => frameValues(label.value, axes.value));
const valuesCopy = computed(() => valuesText(values.value, label.value?.seed));
const editingPositive = ref(false);
watch(current, () => { editingPositive.value = false; });
const positiveRuns = computed(() => promptRuns(textValue("positive"), values.value));
const frameSize = computed(() => (cell.value ? frames.value[cell.value.frame]?.length ?? 0 : 0));
/** A value's colour: its sweep axis hue, else one of the eight variable
 *  colours, handed out in the order the values show up in the prompt so
 *  neighbours differ; a mark and its Values row share it. Values the prompt
 *  doesn't show get none. */
const HUE_ORDER = [1, 5, 3, 6, 7, 4, 2, 8];
const hueSlots = computed(() => {
  const slots = new Map<string, number>();
  for (const run of positiveRuns.value) {
    if (run.name && (run.axis ?? -1) < 0 && !slots.has(run.name)) slots.set(run.name, HUE_ORDER[slots.size % HUE_ORDER.length]);
  }
  return slots;
});
function valueHue(axis: number, name?: string): Record<string, string> {
  if (axis >= 0) return { "--wp-ifp-hue": axisHueAt(axis) };
  const slot = name ? hueSlots.value.get(name) : undefined;
  return slot ? { "--wp-ifp-hue": `var(--wp-var-${slot})` } : {};
}

type SideTab = "values" | "prompt" | "mask";
const sideTabs = computed<TabItem<SideTab>[]>(() => [
  ...(values.value.length ? [{ id: "values" as const, label: "Values", count: values.value.length }] : []),
  { id: "prompt", label: "Prompt", count: isEdited("positive") || isEdited("negative") ? "edited" : undefined },
  { id: "mask", label: "Mask", count: maskValue.value ? "painted" : undefined },
]);
const sideTab = ref<SideTab>("prompt");
watch(painting, (on) => { if (on) sideTab.value = "mask"; });

/** The strip's images by frame, so one frame's images sit together. */
const stripGroups = computed(() => {
  const groups: { frame: number; items: { c: Cell; ci: number }[] }[] = [];
  cells.value.forEach((c, ci) => {
    const last = groups[groups.length - 1];
    if (last && last.frame === c.frame) last.items.push({ c, ci });
    else groups.push({ frame: c.frame, items: [{ c, ci }] });
  });
  return groups;
});
const pickedIn = (frame: number): number => cells.value.filter((c) => c.frame === frame && picked.value.has(c.key)).length;
function editPositive(ev: Event): void {
  const side = (ev.currentTarget as HTMLElement).parentElement;
  editingPositive.value = true;
  void nextTick(() => side?.querySelector<HTMLTextAreaElement>('[data-test="image-filter-positive"]')?.focus());
}

/** Images an edit of this one's prompt applies to: the whole frame
 *  with Same shape (its picks go on as one item), else just this one. */
const textKeys = computed(() => {
  const c = cell.value;
  if (!c) return [];
  return props.request.send_as === "same_shape" ? frameKeys(c.frame) : [c.key];
});
const cellEdit = computed(() => (cell.value ? edits.value[cell.value.key] : undefined));
function canEdit(field: "positive" | "negative"): boolean {
  return props.request.has_clip || label.value?.[field] !== undefined;
}
const editFields = computed(() => (["positive", "negative"] as const).filter((f) => canEdit(f)));
function textValue(field: "positive" | "negative"): string {
  return cellEdit.value?.[field] ?? label.value?.[field] ?? "";
}
function isEdited(field: "positive" | "negative"): boolean {
  return cellEdit.value?.[field] !== undefined;
}
function setText(field: "positive" | "negative", text: string): void {
  edits.value = withText(edits.value, textKeys.value, field, text, label.value?.[field]);
}
function resetText(field: "positive" | "negative"): void {
  setText(field, label.value?.[field] ?? "");
}
const maskValue = computed(() => cellEdit.value?.mask ?? "");
function setMask(url: string): void {
  if (cell.value) edits.value = withMask(edits.value, cell.value.key, url);
}

function isEditedCell(key: string): boolean {
  const e = edits.value[key];
  return !!e && (e.positive !== undefined || e.negative !== undefined);
}
function isMaskedCell(key: string): boolean {
  return !!edits.value[key]?.mask;
}
const editCount = computed(() => Object.values(edits.value).filter(hasEdit).length);

function cellName(c: Cell): string {
  return multiFrame.value ? `Frame ${frameTitle(c.frame)} · image ${c.image + 1}` : `Image ${c.image + 1}`;
}
const isPicked = computed(() => !!cell.value && picked.value.has(cell.value.key));
function pickCurrent(): void {
  if (cell.value) toggle(cell.value.key);
}

/* ── zoom ─────────────────────────────────────────────────────────────── */

const zoom = ref<number | null>(null);
const viewer = ref<InstanceType<typeof WpImageZoom> | null>(null);
/** The images of the shown frame, for the fullscreen strip. */
const frameCells = computed(() => (cell.value ? cells.value.filter((c) => c.frame === cell.value?.frame) : []));
function cellIndex(c: Cell): number {
  return indexOf(c.frame, c.image);
}

/* ── countdown ────────────────────────────────────────────────────────── */

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  timer = setInterval(() => { now.value = Date.now(); }, 1000);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
const left = computed(() => secondsLeft(props.request, now.value));
const leftLabel = computed(() => {
  if (left.value === null) return "";
  const m = Math.floor(left.value / 60);
  const s = String(left.value % 60).padStart(2, "0");
  return `${m}:${s} left`;
});

/* ── answers + keys ───────────────────────────────────────────────────── */

function finish(answer: PickAnswer): void {
  dropDraftEdits(props.request.token);
  emit("answer", answer);
}
function keepPicked(): void {
  if (pickedList.value.length === 0) return;
  const e = editsFor(edits.value, [...picked.value]);
  finish(e ? { action: "picks", picks: pickedList.value, edits: e } : { action: "picks", picks: pickedList.value });
}
function keepAll(): void {
  const e = editsFor(edits.value, cells.value.map((c) => c.key));
  finish(e ? { action: "keep_all", edits: e } : { action: "keep_all" });
}
function stop(): void {
  finish({ action: "stop" });
}

function onClose(): void {
  // Escape / outside click: Zoom steps back to Detail, Detail to Grid, then the picker tucks away.
  if (mode.value === "zoom") setMode("detail");
  else if (mode.value === "detail") setMode("grid");
  else emit("minimize");
}

function onKey(ev: KeyboardEvent): void {
  const target = ev.target as HTMLElement | null;
  const tag = target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  const plain = !ev.ctrlKey && !ev.metaKey && !ev.altKey;
  const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
  // A focused button keeps Space, and a focused switch (mode, tile size) its arrow keys.
  if (key === " " && tag === "BUTTON") return;
  if (key.startsWith("Arrow") && target?.closest?.('[role="radiogroup"]')) return;
  const one = mode.value !== "grid";
  const act = ((): (() => void) | null => {
    if (key === "Enter") return keepPicked;
    if (key === "a" && (ev.ctrlKey || ev.metaKey)) return toggleAll;
    if (!plain) return null;
    if (key === "g") return () => setMode("grid");
    if (key === "d") return () => setMode("detail");
    if (key === "z") return () => setMode("zoom");
    if (key === " " || key === "p" || (one && key === "ArrowUp")) {
      if (one) return pickCurrent;
      const h = hovered.value;
      return h === null ? null : () => toggle(cells.value[h]?.key ?? "");
    }
    if (one && key === "ArrowLeft") return () => step(-1);
    if (one && key === "ArrowRight") return () => step(1);
    if (mode.value === "grid" && key === "f" && !showTable.value) return () => { tile.value = tile.value === "fit" ? "m" : "fit"; };
    if (one && key === "c") return togglePin;
    if (mode.value === "detail" && key === "m") return togglePaint;
    if (mode.value === "zoom" && (key === "+" || key === "=")) return () => viewer.value?.zoomIn();
    if (mode.value === "zoom" && (key === "-" || key === "_")) return () => viewer.value?.zoomOut();
    if (mode.value === "zoom" && key === "f") return () => viewer.value?.toggleFullscreen();
    if (mode.value === "zoom" && key === "0") return () => viewer.value?.setZoom(null);
    if (mode.value === "zoom" && (key === "1" || key === "2")) return () => viewer.value?.setZoom(Number(key));
    return null;
  })();
  if (!act) return;
  ev.preventDefault();
  act();
}

function indexOf(frame: number, image: number): number {
  return cells.value.findIndex((c) => c.frame === frame && c.image === image);
}

const subLine = computed(() => {
  if (mode.value === "grid") return "Click or Space picks · double-click or a frame's border opens Detail · Enter keeps the picks";
  if (mode.value === "detail") return "←/→ next image · P picks · C compares · M paints a mask · Esc back to Grid";
  return "Drag to move · scroll to zoom · ←/→ keeps the spot on the next image · Esc back";
});
</script>

<template>
  <ModalShell :visible="true" @close="onClose" @keydown="onKey">
    <div class="wp-ifp" :class="[`is-${mode}`, { 'is-fit': isFit }]" data-test="image-filter-picker" :data-mode="mode" tabindex="-1">
      <div class="wp-ifp__head">
        <i class="pi pi-filter wp-ifp__head-icon" aria-hidden="true" />
        <div class="wp-ifp__title-block">
          <div class="wp-ifp__title-row">
            <span class="wp-ifp__name">WP Image Filter</span>
            <span class="wp-ifp__chip">Waiting</span>
            <span v-if="moreWaiting" class="wp-ifp__more" data-test="image-filter-more">+{{ moreWaiting }} more waiting</span>
          </div>
          <div class="wp-ifp__sub">
            <template v-if="multiFrame">{{ frames.length }} frames, {{ total }} images.</template>
            <template v-else>{{ total }} {{ total === 1 ? "image" : "images" }}.</template>
            {{ subLine }}
          </div>
        </div>
        <WpSegmented
          :model-value="mode"
          :options="MODE_OPTIONS"
          size="sm"
          aria-label="Mode"
          test-prefix="image-filter-mode"
          :disabled="!total"
          @update:model-value="(m) => setMode(m)"
        />
        <WpButton variant="ghost" icon="pi-minus" aria-label="Hide for now (the run keeps waiting)" data-test="image-filter-minimize" @click="emit('minimize')" />
      </div>

      <!-- Grid -->
      <template v-if="mode === 'grid'">
        <div v-if="!showTable" class="wp-ifp__tools">
          <span class="wp-ifp__tool-label">Tile size</span>
          <WpSegmented v-model="tile" :options="TILE_OPTIONS" size="sm" aria-label="Tile size" test-prefix="image-filter-tile-size" />
          <template v-if="grid">
            <span class="wp-ifp__tool-label">Layout</span>
            <WpSegmented v-model="arrange" :options="ARRANGE_OPTIONS" size="sm" aria-label="Layout" test-prefix="image-filter-view" />
          </template>
        </div>

        <div v-if="showTable && grid" class="wp-ifp__body is-grid" data-test="image-filter-grid">
          <SweepGrid
            v-model:layout="layout"
            :grid="grid"
            :axes="axes"
            :frames="frames"
            :picked="picked"
            :edits="edits"
            :tooltip="frameTooltip"
            :tile="tableTile"
            @toggle="toggle"
            @toggle-frames="toggleFrames"
            @zoom="(f, i) => setMode('detail', indexOf(f, i))"
            @hover="(f, i, on) => (hovered = on ? indexOf(f, i) : null)"
          >
            <template #tools>
              <span class="wp-ifp__tool-label">Tile size</span>
              <WpSegmented v-model="tile" :options="TILE_OPTIONS" size="sm" aria-label="Tile size" test-prefix="image-filter-tile-size" />
              <span class="wp-ifp__tool-label">Layout</span>
              <WpSegmented v-model="arrange" :options="ARRANGE_OPTIONS" size="sm" aria-label="Layout" test-prefix="image-filter-view" />
            </template>
          </SweepGrid>
        </div>

        <div v-else ref="body" class="wp-ifp__body" :class="{ 'is-flat': !multiFrame, 'is-fit': isFit }" data-test="image-filter-frames">
          <section
            v-for="(imgs, f) in frames"
            :key="f"
            class="wp-ifp__frame"
            :class="{ 'is-flat': !multiFrame }"
            :style="tileStyle"
            :data-test="`image-filter-frame-${f}`"
            :title="multiFrame ? `${frameTooltip(f)}\nClick the image to pick it, the frame around it for Detail.` : undefined"
            @click="multiFrame && setMode('detail', indexOf(f, 0))"
          >
            <div v-if="multiFrame" class="wp-ifp__frame-head">
              <span class="wp-ifp__frame-label">
                <template v-for="(part, pi) in frameParts(labels[f], f, axes)" :key="pi">
                  <span v-if="pi > 0" class="wp-ifp__sep">·</span><span :class="{ 'wp-ifp__opt': pi > 0 }">{{ part }}</span>
                </template>
              </span>
              <template v-if="imgs.length > 1">
                <span v-if="pickedIn(f)" class="wp-ifp__frame-count">{{ pickedIn(f) }} of {{ imgs.length }}</span>
                <WpButton
                  variant="ghost"
                  size="sm"
                  :hint="pickedIn(f) === imgs.length ? 'Leave out every image of this frame' : 'Pick every image of this frame'"
                  :data-test="`image-filter-pick-frame-${f}`"
                  @click.stop="toggleFrames([f])"
                >{{ pickedIn(f) === imgs.length ? "Clear frame" : "Pick frame" }}</WpButton>
              </template>
            </div>
            <div class="wp-ifp__tiles">
              <PickerTile
                v-for="(img, i) in imgs"
                :key="i"
                :src="viewUrl(img)"
                :picked="picked.has(pickKey(f, i))"
                :index="imgs.length > 1 || !multiFrame ? i + 1 : 0"
                :edited="isEditedCell(pickKey(f, i))"
                :masked="isMaskedCell(pickKey(f, i))"
                :test-id="`image-filter-tile-${f}-${i}`"
                @toggle="toggle(pickKey(f, i))"
                @zoom="setMode('detail', indexOf(f, i))"
                @hover="(on) => (hovered = on ? indexOf(f, i) : null)"
              />
            </div>
          </section>
        </div>
      </template>

      <!-- Detail -->
      <div v-else-if="mode === 'detail' && cell" class="wp-ifp__detail" data-test="image-filter-detail">
        <div class="wp-ifp__stage">
          <div class="wp-ifp__view">
            <WpButton variant="ghost" icon="pi-chevron-left" aria-label="Previous image" kbd="←" data-test="image-filter-prev" @click="step(-1)" />
            <figure class="wp-ifp__fig">
              <MaskPainter
                v-if="painting"
                ref="painter"
                :key="cell.key"
                :src="viewUrl(cell.ref)"
                :model-value="maskValue"
                :tool="tool"
                :size="brush"
                @update:model-value="setMask"
              />
              <div v-else-if="compareCell" class="wp-ifp__compare" data-test="image-filter-compare">
                <img :src="viewUrl(cell.ref)" class="wp-ifp__img" alt="" @load="onDetailLoad(cell.key, $event)">
                <img
                  :src="viewUrl(compareCell.ref)"
                  class="wp-ifp__img wp-ifp__compare-top"
                  :style="{ clipPath: `inset(0 ${100 - comparePos}% 0 0)` }"
                  alt=""
                >
                <span class="wp-ifp__compare-line" :style="{ left: `${comparePos}%` }" aria-hidden="true" />
                <span class="wp-ifp__compare-tag is-left">{{ cellName(compareCell) }}</span>
                <span class="wp-ifp__compare-tag is-right">{{ cellName(cell) }}</span>
                <input v-model.number="comparePos" type="range" min="0" max="100" class="wp-ifp__compare-range" aria-label="Compare slider">
              </div>
              <img
                v-else
                :src="viewUrl(cell.ref)"
                class="wp-ifp__img"
                :class="{ 'is-picked': isPicked }"
                :alt="cellName(cell)"
                data-test="image-filter-detail-img"
                @load="onDetailLoad(cell.key, $event)"
                @click="pickCurrent"
                @dblclick="setMode('zoom')"
              >
            </figure>
            <WpButton variant="ghost" icon="pi-chevron-right" aria-label="Next image" kbd="→" data-test="image-filter-next" @click="step(1)" />
          </div>
          <div v-if="total > 1" class="wp-ifp__strip" :class="{ 'is-grouped': multiFrame }" role="list" aria-label="All images" data-test="image-filter-strip">
            <div
              v-for="g in stripGroups"
              :key="g.frame"
              class="wp-ifp__strip-frame"
              :class="{ 'is-current': cell && g.frame === cell.frame }"
              role="group"
              :aria-label="`Frame #${g.frame + 1}`"
            >
            <span v-if="multiFrame" class="wp-ifp__strip-label">#{{ g.frame + 1 }}<template v-if="pickedIn(g.frame)"> · {{ pickedIn(g.frame) }} picked</template></span>
            <div class="wp-ifp__strip-row">
            <PickerTile
              v-for="{ c, ci } in g.items"
              :key="c.key"
              role="listitem"
              :src="viewUrl(c.ref)"
              :picked="picked.has(c.key)"
              :index="0"
              :edited="isEditedCell(c.key)"
              :masked="isMaskedCell(c.key)"
              :class="{ 'is-current': ci === current }"
              :aria-current="ci === current || undefined"
              :test-id="`image-filter-strip-${c.frame}-${c.image}`"
              @toggle="current = ci"
              @zoom="setMode('zoom', ci)"
            />
            </div>
            </div>
          </div>
        </div>

        <aside class="wp-ifp__side" data-test="image-filter-refine">
          <div class="wp-ifp__side-head">
            <div class="wp-ifp__side-title">{{ cellName(cell) }}</div>
            <div class="wp-ifp__side-meta" data-test="image-filter-meta">
              <span v-if="sizes[cell.key]">{{ sizes[cell.key] }}</span>
              <span v-if="typeof label?.seed === 'number'">seed {{ label.seed }}</span>
              <span class="wp-ifp__pos">{{ current + 1 }} / {{ total }}</span>
            </div>
          </div>
          <div class="wp-ifp__side-actions">
            <WpButton
              :variant="isPicked ? 'primary' : 'secondary'"
              :icon="isPicked ? 'pi-check' : 'pi-circle'"
              kbd="P"
              :hint="isPicked ? 'Picked: it goes on. Press to leave it out.' : 'Not picked yet. Press to send it on.'"
              :aria-pressed="isPicked"
              data-test="image-filter-pick"
              @click="pickCurrent"
            >{{ isPicked ? "Picked" : "Pick" }}</WpButton>
            <WpButton
              v-if="total > 1"
              :variant="comparePin !== null ? 'secondary' : 'ghost'"
              icon="pi-clone"
              kbd="C"
              hint="Pin this image, then step to another to compare them"
              :aria-pressed="comparePin !== null"
              data-test="image-filter-compare-pin"
              @click="togglePin"
            >{{ comparePin === null ? "Compare" : compareCell ? "Stop comparing" : "Pinned, pick another" }}</WpButton>
            <WpButton v-if="multiFrame && frameSize > 1" variant="ghost" icon="pi-th-large" hint="Pick or leave out every image of this frame" data-test="image-filter-details-frame" @click="toggleFrames([cell.frame])">Pick frame ({{ frameSize }})</WpButton>
          </div>
          <WpTabs v-model="sideTab" :tabs="sideTabs" size="sm" aria-label="Image details" test-prefix="image-filter-tab" />

          <section v-if="sideTab === 'values' && values.length" class="wp-ifp__section" data-test="image-filter-details">
            <div v-if="values.length" class="wp-ifp__field-head">
              <span class="wp-ifp__hint">Each colour is the one its words have in the prompt.</span>
              <span class="wp-ifp__spacer" />
              <CopyButton :text="valuesCopy" label="Copy values" size="sm" />
            </div>
            <div v-if="values.length" class="wp-ifp__values" data-test="image-filter-values">
              <div v-for="r in values" :key="r.name" class="wp-ifp__value">
                <span v-tooltip="`$${r.name}`" class="wp-ifp__value-name" :class="{ 'is-swept': r.axis >= 0 }" :style="valueHue(r.axis, r.name)"><i class="wp-ifp__swatch" aria-hidden="true" />${{ r.name }}</span>
                <span v-tooltip="r.value" class="wp-ifp__value-text">{{ r.value }}</span>
              </div>
              <div v-if="typeof label?.seed === 'number'" class="wp-ifp__value">
                <span class="wp-ifp__value-name">seed</span><span class="wp-ifp__value-text">{{ label.seed }}</span>
              </div>
            </div>
          </section>

          <template v-if="sideTab === 'prompt'">
          <section v-if="editFields.length" class="wp-ifp__section is-fill">
            <p v-if="request.send_as === 'same_shape' && frameSize > 1" class="wp-ifp__hint">
              Same shape: a prompt edit covers every image of this frame.
            </p>
            <template v-for="field in editFields" :key="field">
              <div class="wp-ifp__field-head">
                <span>{{ field === "positive" ? "Prompt" : "Negative" }}</span>
                <span v-if="isEdited(field)" class="wp-ifp__badge">edited</span>
                <span class="wp-ifp__spacer" />
                <span
                  v-if="field === 'positive' && !request.has_clip"
                  v-tooltip="'No CLIP wired: an edit changes the text outputs only, the conditioning stays as it was.'"
                  class="wp-ifp__tag"
                  tabindex="0"
                  data-test="image-filter-no-clip"
                >text only</span>
                <WpButton v-if="isEdited(field)" variant="link" @click="resetText(field)">Reset</WpButton>
                <CopyButton
                  :text="textValue(field)"
                  :label="field === 'positive' ? 'Copy prompt' : 'Copy negative'"
                  size="sm"
                  :data-test="`image-filter-copy-${field}`"
                />
              </div>
              <div
                v-if="values.length && field === 'positive' && !editingPositive && textValue(field)"
                v-tooltip="'Click to edit'"
                class="wp-ifp__text wp-ifp__marked"
                tabindex="0"
                data-test="image-filter-positive-marked"
                @click="editPositive"
                @keydown.enter.prevent.stop="editPositive"
              ><template v-for="(run, ri) in positiveRuns" :key="ri"><mark
                v-if="run.name"
                v-tooltip="`Set by $${run.name}`"
                :style="valueHue(run.axis ?? -1, run.name)"
              >{{ run.text }}</mark><template v-else>{{ run.text }}</template></template></div>
              <textarea
                v-else
                class="wp-ifp__text"
                :value="textValue(field)"
                rows="4"
                spellcheck="false"
                :aria-label="`${field} prompt`"
                :data-test="`image-filter-${field}`"
                @blur="editingPositive = false"
                @input="setText(field, ($event.target as HTMLTextAreaElement).value)"
              />
            </template>
          </section>
          <p v-else class="wp-ifp__hint" data-test="image-filter-no-prompt">Wire positive_text, negative_text or a CLIP to edit the prompt here.</p>
          </template>

          <section v-if="sideTab === 'mask'" class="wp-ifp__section">
            <div class="wp-ifp__field-head">
              <span>Mask</span>
              <span v-if="maskValue" class="wp-ifp__badge">painted</span>
              <span class="wp-ifp__spacer" />
              <WpButton
                :variant="painting ? 'secondary' : 'ghost'"
                icon="pi-pencil"
                kbd="M"
                hint="Paint a mask for this image; it goes to the masks output"
                :aria-pressed="painting"
                data-test="image-filter-paint"
                @click="togglePaint"
              >{{ painting ? "Done" : "Paint" }}</WpButton>
            </div>
            <template v-if="painting">
              <WpSegmented v-model="tool" :options="TOOL_OPTIONS" size="sm" block aria-label="Tool" test-prefix="image-filter-tool" />
              <label class="wp-ifp__size">Size <input v-model.number="brush" type="range" min="4" max="160"> <span>{{ brush }}</span></label>
              <div class="wp-ifp__row">
                <WpButton variant="ghost" @click="painter?.invert()">Invert</WpButton>
                <WpButton variant="ghost" data-test="image-filter-mask-clear" @click="painter?.clear()">Clear</WpButton>
              </div>
              <p class="wp-ifp__hint">Images you don't paint keep the incoming mask.</p>
            </template>
          </section>
        </aside>
      </div>

      <!-- Zoom -->
      <div v-else-if="mode === 'zoom' && cell" class="wp-ifp__zoom" data-test="image-filter-zoom">
        <!-- Comparing: the pinned image stays on the left (and keeps the view), ←/→ change the right one. -->
        <WpImageZoom
          ref="viewer"
          v-model:zoom="zoom"
          :src="viewUrl((compareCell ?? cell).ref)"
          :alt="cellName(compareCell ?? cell)"
          :second="compareCell ? viewUrl(cell.ref) : null"
          :second-alt="cellName(cell)"
          :hint="compareCell ? 'Both sides move together · ←/→ changes the right one · C stops comparing' : 'Drag to move · scroll to zoom · C compares · F fullscreen · Esc back'"
          fullscreen
          minimap
          autohide
        >
          <template #bar-start>
            <WpButton variant="ghost" icon="pi-chevron-left" aria-label="Previous image" kbd="←" data-test="image-filter-prev" @click="step(-1)" />
          </template>
          <template #bar-end>
            <WpButton
              :variant="comparePin !== null ? 'secondary' : 'ghost'"
              icon="pi-clone"
              kbd="C"
              :hint="comparePin === null ? 'Pin this image, then step to another to see both side by side' : 'Stop comparing'"
              :aria-pressed="comparePin !== null"
              data-test="image-filter-zoom-compare"
              @click="togglePin"
            >{{ comparePin === null ? "Compare" : compareCell ? "Comparing" : "Pinned" }}</WpButton>
            <WpButton
              :variant="isPicked ? 'primary' : 'secondary'"
              :icon="isPicked ? 'pi-check' : 'pi-circle'"
              kbd="P"
              :aria-pressed="isPicked"
              data-test="image-filter-pick"
              @click="pickCurrent"
            >{{ isPicked ? "Picked" : "Pick" }}</WpButton>
            <WpButton variant="ghost" icon="pi-chevron-right" aria-label="Next image" kbd="→" data-test="image-filter-next" @click="step(1)" />
          </template>
          <template #first>
            <span class="wp-ifp__zoom-cap" data-test="image-filter-zoom-cap">
              <template v-if="compareCell">{{ cellName(compareCell) }} · pinned</template>
              <template v-else>{{ cellName(cell) }} · {{ current + 1 }} / {{ total }}</template>
              <span v-if="picked.has((compareCell ?? cell).key)" class="wp-ifp__zoom-picked" data-test="image-filter-zoom-picked"><i class="pi pi-check" aria-hidden="true" /> Picked</span>
            </span>
          </template>
          <template #second>
            <span class="wp-ifp__zoom-cap is-right" data-test="image-filter-zoom-cap-second">
              {{ cellName(cell) }} · {{ current + 1 }} / {{ total }}
              <span v-if="isPicked" class="wp-ifp__zoom-picked"><i class="pi pi-check" aria-hidden="true" /> Picked</span>
            </span>
          </template>
          <template #fullscreen>
            <span v-if="multiFrame" class="wp-ifp__full-label">Frame {{ frameTitle(cell.frame) }}</span>
            <template v-if="frameCells.length > 1">
              <div class="wp-ifp__full-strip" role="list" aria-label="This frame's images">
                <PickerTile
                  v-for="c in frameCells"
                  :key="c.key"
                  role="listitem"
                  :src="viewUrl(c.ref)"
                  :picked="picked.has(c.key)"
                  :index="0"
                  :edited="isEditedCell(c.key)"
                  :masked="isMaskedCell(c.key)"
                  :class="{ 'is-current': c.key === cell.key }"
                  :aria-current="c.key === cell.key || undefined"
                  :test-id="`image-filter-full-thumb-${c.image}`"
                  @toggle="current = cellIndex(c)"
                />
              </div>
              <span class="wp-ifp__full-sep" aria-hidden="true" />
            </template>
            <span class="wp-ifp__full-count"><strong>{{ pickedList.length }}</strong> of {{ total }} picked</span>
            <WpButton variant="primary" kbd="Enter" :disabled="pickedList.length === 0" data-test="image-filter-full-keep" @click="keepPicked">{{ pickedList.length ? `Keep ${pickedList.length} picked` : "Keep picked" }}</WpButton>
          </template>
        </WpImageZoom>
      </div>

      <div class="wp-ifp__foot">
        <div class="wp-ifp__status" data-test="image-filter-status">
          <span><strong>{{ pickedList.length }}</strong> of {{ total }} picked<template v-if="multiFrame"> from {{ pickedFrames }} {{ pickedFrames === 1 ? "frame" : "frames" }}</template></span>
          <span v-if="editCount" class="wp-ifp__edits">{{ editCount }} refined</span>
          <span v-if="leftLabel" class="wp-ifp__left" :class="{ 'is-low': (left ?? 99) <= 30 }">{{ leftLabel }}</span>
        </div>
        <span class="wp-ifp__spacer" />
        <WpButton v-if="canSendToLoop" :disabled="pickedFrames === 0" hint="Lock the picked frames' seeds in the Context Loop and bypass the rest, so the next run repeats only your picks" data-test="image-filter-send-loop" @click="sendToLoop">Send to Loop</WpButton>
        <WpButton variant="danger" hint="Skip everything after this node for this run" data-test="image-filter-stop" @click="stop">Stop branch</WpButton>
        <WpButton data-test="image-filter-keep-all" @click="keepAll">Keep all {{ total }}</WpButton>
        <WpButton variant="primary" kbd="Enter" :disabled="pickedList.length === 0" data-test="image-filter-keep-picked" @click="keepPicked">{{ pickedList.length ? `Keep ${pickedList.length} picked` : "Keep picked" }}</WpButton>
      </div>
    </div>
  </ModalShell>
</template>

<style scoped>
/* One size in every mode, so switching never moves the window under the mouse. */
.wp-ifp { width: min(1280px, 95vw); height: 90vh; display: flex; flex-direction: column; background: var(--wp-bg2); border: 1px solid var(--wp-border); border-radius: 6px; overflow: hidden; color: var(--wp-text); font-size: 12px; box-shadow: var(--wp-shadow-lg); outline: none; }
.wp-ifp__head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; flex-shrink: 0; border-bottom: 1px solid var(--wp-border); background: color-mix(in srgb, var(--wp-accent) 9%, var(--wp-bg2)); }
.wp-ifp__head-icon { color: var(--wp-accent); width: 24px; font-size: 15px; text-align: center; }
.wp-ifp__title-block { flex: 1; min-width: 0; }
.wp-ifp__title-row { display: flex; align-items: center; gap: 8px; }
.wp-ifp__name { font: 600 13px var(--wp-font-sans); }
.wp-ifp__chip { font: 600 10px var(--wp-font-sans); letter-spacing: .02em; padding: 2px 6px; border-radius: 3px; background: color-mix(in srgb, var(--wp-accent) 22%, transparent); color: var(--wp-accent-text, var(--wp-accent)); }
.wp-ifp__more { font: 11px var(--wp-font-sans); color: var(--wp-amber); }
.wp-ifp__sub { font: 11px var(--wp-font-sans); color: var(--wp-text-dim, var(--wp-text3)); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.wp-ifp__tools { display: flex; align-items: center; gap: 8px; padding: 8px 14px; flex-shrink: 0; border-bottom: 1px solid var(--wp-border); }
.wp-ifp__tool-label { font: 11px var(--wp-font-sans); color: var(--wp-text-muted, var(--wp-text2)); }
.wp-ifp__tool-label:not(:first-child) { margin-left: 10px; }

.wp-ifp__body { overflow-y: auto; padding: 12px 14px; flex: 1; min-height: 0; display: flex; flex-wrap: wrap; gap: 10px; align-content: flex-start; }
.wp-ifp__body.is-fit { align-content: safe center; justify-content: safe center; }
.wp-ifp__body.is-fit .wp-ifp__frame.is-flat .wp-ifp__tiles { justify-content: center; }
.wp-ifp__body.is-grid { display: flex; flex-direction: column; flex-wrap: nowrap; padding: 0; overflow: hidden; }
.wp-ifp__frame { display: flex; flex-direction: column; gap: 4px; padding: 6px; border-radius: 5px; background: var(--wp-bg-deep, var(--wp-bg)); border: 1px solid var(--wp-border); }
.wp-ifp__frame.is-flat { padding: 0; background: transparent; border: 0; width: 100%; }
.wp-ifp__frame:not(.is-flat) { cursor: zoom-in; }
.wp-ifp__frame:not(.is-flat):hover { border-color: var(--wp-accent); }
.wp-ifp__frame:not(.is-flat):hover .wp-ifp__frame-label { color: var(--wp-accent-text, var(--wp-accent)); }
.wp-ifp__frame-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.wp-ifp__frame-label { flex: 1; min-width: 0; padding: 0 2px; font: 11px var(--wp-font-mono, monospace); color: var(--wp-text-dim, var(--wp-text3)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wp-ifp__frame-count { font: 11px var(--wp-font-sans); color: var(--wp-resolved, var(--wp-text-dim)); white-space: nowrap; }
.wp-ifp__opt { color: var(--wp-text-muted, var(--wp-text2)); font-family: var(--wp-font-sans); }
.wp-ifp__sep { margin: 0 4px; opacity: .6; }
.wp-ifp__tiles { display: flex; flex-wrap: wrap; gap: 6px; }

/* Detail */
.wp-ifp__detail { flex: 1; min-height: 0; display: flex; }
.wp-ifp__stage { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; padding: 12px; }
.wp-ifp__view { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; gap: 6px; }
.wp-ifp__fig { margin: 0; min-width: 0; min-height: 0; max-height: 100%; display: flex; }
.wp-ifp__detail { --wp-ifp-stage-h: calc(90vh - 240px); }
.wp-ifp__img { display: block; max-width: 100%; max-height: var(--wp-ifp-stage-h); border: 3px solid transparent; border-radius: 6px; cursor: pointer; }
.wp-ifp__img.is-picked { border-color: var(--wp-green); }
.wp-ifp__strip { flex-shrink: 0; display: flex; gap: 4px; overflow-x: auto; padding: 2px 2px 4px; --wp-ifp-tile: 56px; }
.wp-ifp__strip > * { flex-shrink: 0; }
.wp-ifp__strip .is-current { border-color: var(--wp-accent); }
.wp-ifp__strip-frame, .wp-ifp__strip-row { display: flex; gap: 4px; }
.wp-ifp__strip.is-grouped { gap: 12px; align-items: flex-end; }
.wp-ifp__strip.is-grouped .wp-ifp__strip-frame { flex-direction: column; gap: 3px; }
.wp-ifp__strip.is-grouped .wp-ifp__strip-row { padding: 3px; border: 1px solid var(--wp-border); border-radius: var(--wp-radius-md, 8px); }
.wp-ifp__strip.is-grouped .wp-ifp__strip-frame.is-current .wp-ifp__strip-row { border-color: var(--wp-accent); background: color-mix(in srgb, var(--wp-accent) 8%, transparent); }
.wp-ifp__strip-label { font: 11px var(--wp-font-sans); color: var(--wp-text-dim, var(--wp-text3)); white-space: nowrap; }
.wp-ifp__strip-frame.is-current .wp-ifp__strip-label { color: var(--wp-accent-text, var(--wp-accent)); font-weight: 600; }
.wp-ifp__swatch { display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 2px; background: var(--wp-ifp-hue, var(--wp-text-dim)); vertical-align: baseline; }
.wp-ifp__tag { padding: 0 6px; border: 1px solid color-mix(in srgb, var(--wp-warn) 45%, transparent); border-radius: 999px; font: 11px/16px var(--wp-font-sans); color: var(--wp-warn); cursor: help; }

.wp-ifp__compare { position: relative; line-height: 0; }
.wp-ifp__compare .wp-ifp__img { cursor: ew-resize; }
.wp-ifp__compare-top { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
/* Labels over a picture wear a dark scrim in both themes. */
.wp-ifp__compare-line { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: white; box-shadow: var(--wp-shadow-sm); pointer-events: none; }
.wp-ifp__compare-tag { position: absolute; top: 8px; padding: 2px 6px; border-radius: 3px; background: rgb(0 0 0 / 0.6); color: white; font: 11px/1.4 var(--wp-font-sans); pointer-events: none; }
.wp-ifp__compare-tag.is-left { left: 8px; }
.wp-ifp__compare-tag.is-right { right: 8px; }
.wp-ifp__compare-range { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: ew-resize; }

.wp-ifp__side { width: 300px; flex-shrink: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 12px; border-left: 1px solid var(--wp-border); background: var(--wp-bg-deep, var(--wp-bg)); }
.wp-ifp__side > * { flex-shrink: 0; }
.wp-ifp__side-title { font: 600 13px var(--wp-font-sans); overflow-wrap: anywhere; }
.wp-ifp__side-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 2px; font: 11px var(--wp-font-mono, monospace); color: var(--wp-text-dim, var(--wp-text3)); }
.wp-ifp__pos { margin-left: auto; }
.wp-ifp__side-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.wp-ifp__section { display: flex; flex-direction: column; gap: 6px; padding-top: 10px; border-top: 1px solid var(--wp-border); }
.wp-ifp__section > .wp-btn--link { align-self: flex-start; }
.wp-ifp__field-head { display: flex; align-items: center; gap: 6px; font: 600 11px var(--wp-font-sans); }
/* Many variables scroll inside the list so the prompt stays in view; long names
 * and values are cut (full text on hover). Plain block rows, not a grid: a
 * grid row with overflow:hidden items may shrink to nothing in a capped box. */
.wp-ifp__values { flex-shrink: 0; overflow-y: auto; font: 11px/1.45 var(--wp-font-mono, monospace); }
.wp-ifp__value { display: flex; gap: 12px; padding: 1px 0; }
.wp-ifp__value-name { flex: 0 0 38%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-ifp__value-name[style] { color: color-mix(in srgb, var(--wp-ifp-hue) 85%, var(--wp-text)); }
.wp-ifp__value-name.is-swept { color: color-mix(in srgb, var(--wp-ifp-hue) 85%, var(--wp-text)); font-weight: 600; }
.wp-ifp__value-text { flex: 1; min-width: 0; color: var(--wp-text); overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
.wp-ifp__marked { white-space: pre-wrap; overflow-wrap: anywhere; cursor: text; min-height: 60px; }
.wp-ifp__marked mark { padding: 0 2px; border-radius: 3px; color: var(--wp-text); background: color-mix(in srgb, var(--wp-ifp-hue, var(--wp-accent)) 20%, transparent); box-shadow: inset 0 -1.5px 0 var(--wp-ifp-hue, var(--wp-accent)); }
.wp-ifp__marked mark:hover { background: color-mix(in srgb, var(--wp-ifp-hue, var(--wp-accent)) 38%, transparent); }
.wp-ifp__badge { font: 600 10px var(--wp-font-sans); padding: 1px 5px; border-radius: 3px; background: color-mix(in srgb, var(--wp-accent) 22%, transparent); color: var(--wp-accent-text, var(--wp-accent)); }
.wp-ifp__text { width: 100%; box-sizing: border-box; resize: vertical; min-height: 64px; padding: 6px; border: 1px solid var(--wp-border); border-radius: 4px; background: var(--wp-bg2); color: var(--wp-text); font: 11px/1.45 var(--wp-font-mono, monospace); }
.wp-ifp__text:focus { outline: none; border-color: var(--wp-accent); }
.wp-ifp__hint { margin: 0; font: 11px/1.4 var(--wp-font-sans); color: var(--wp-text-dim, var(--wp-text3)); }
.wp-ifp__warn { margin: 0; font: 11px/1.4 var(--wp-font-sans); color: var(--wp-amber); }
.wp-ifp__size { display: flex; align-items: center; gap: 6px; font: 11px var(--wp-font-sans); color: var(--wp-text-muted, var(--wp-text2)); }
.wp-ifp__size input { flex: 1; accent-color: var(--wp-accent); }
.wp-ifp__size span { width: 26px; text-align: right; font-family: var(--wp-font-mono, monospace); }
.wp-ifp__row { display: flex; gap: 6px; }

/* Zoom */
.wp-ifp__zoom { flex: 1; min-height: 0; padding: 8px; }
.wp-ifp__zoom-cap { position: absolute; left: 10px; bottom: 10px; display: flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 3px; background: rgb(0 0 0 / 0.6); color: white; font: 11px/1.5 var(--wp-font-sans); pointer-events: none; }
.wp-ifp__zoom-cap.is-right { left: auto; right: 10px; }
.wp-ifp__zoom-picked { display: inline-flex; align-items: center; gap: 3px; margin: 0 -6px 0 2px; padding: 0 6px; border-radius: 3px; background: var(--wp-green); color: white; font-weight: 600; }
.wp-ifp__zoom-picked .pi { font-size: 9px; }
.wp-ifp__full-label { color: var(--wp-text-muted); font: var(--wp-text-xs) var(--wp-font-sans); }
.wp-ifp__full-count { color: var(--wp-text-muted); font: var(--wp-text-xs) var(--wp-font-sans); white-space: nowrap; }
.wp-ifp__full-count strong { color: var(--wp-text); }
.wp-ifp__full-strip { display: flex; gap: 4px; --wp-ifp-tile: 36px; }
.wp-ifp__full-strip .is-current { border-color: var(--wp-accent); }
.wp-ifp__full-sep { width: 1px; height: 32px; background: var(--wp-border); }

.wp-ifp__foot { display: flex; align-items: center; gap: 8px; padding: 10px 14px; flex-shrink: 0; background: var(--wp-bg3); border-top: 1px solid var(--wp-border); }
.wp-ifp__status { display: flex; gap: 12px; font: 11px var(--wp-font-sans); color: var(--wp-text-muted, var(--wp-text2)); }
.wp-ifp__status strong { color: var(--wp-text); }
.wp-ifp__edits { color: var(--wp-accent-text, var(--wp-accent)); }
.wp-ifp__left { color: var(--wp-text-dim, var(--wp-text3)); font-family: var(--wp-font-mono, monospace); }
.wp-ifp__left.is-low { color: var(--wp-amber); }
.wp-ifp__spacer { flex: 1; }
</style>
