<script setup lang="ts">
/**
 * PickerModal — the pause-and-pick screen of WP Image Filter.
 *
 * Shows every image of one waiting request, grouped by frame when a Context
 * Loop (or any list) produced several, or laid out as a grid when the loop
 * swept two or more wildcards. Click picks, Space zooms (and the picker
 * remembers whether you left it zoomed), Enter keeps the picks. In zoom the
 * Refine panel edits the frame's prompts and paints a mask for the upscaler.
 * Closing (Escape / clicking outside) only minimises it: the run keeps
 * waiting until one of the three answers is sent.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ModalShell from "../shared/ModalShell.vue";
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
  draftEdits, dropDraftEdits, editsFor, hasEdit, readZoomPref, saveDraftEdits,
  withMask, withText, writeZoomPref,
} from "./picker-state";

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
  if (zoomIndex.value !== null) zoomIndex.value = total.value ? 0 : null;
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
function toggleFrame(frame: number): void {
  const keys = frameKeys(frame);
  const allOn = keys.every((k) => picked.value.has(k));
  const next = new Set(picked.value);
  for (const k of keys) {
    if (allOn) next.delete(k);
    else next.add(k);
  }
  picked.value = next;
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

/* ── loop labels, sweep grid, send back ───────────────────────────────── */

const loop = computed(() => findLoop(labels.value, props.graph));
const axes = computed(() => loop.value?.axes ?? []);
const layout = ref<GridLayout>(defaultGridLayout());
watch(() => axes.value.map((a) => a.uid).join(" "), () => { layout.value = defaultGridLayout(); });
const grid = computed(() => sweepGrid(labels.value, axes.value, layout.value));
const view = ref<"grid" | "frames">("grid");
const showGrid = computed(() => view.value === "grid" && !!grid.value);

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
  lines.push("Click to pick or clear the whole frame");
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

/* ── zoom, compare, refine ────────────────────────────────────────────── */

const zoomIndex = ref<number | null>(readZoomPref() && total.value ? 0 : null);
const hovered = ref<number | null>(null);
const zoomCell = computed(() => (zoomIndex.value === null ? null : cells.value[zoomIndex.value] ?? null));
watch(() => zoomIndex.value !== null, (on) => writeZoomPref(on));

function setZoom(index: number | null): void {
  zoomIndex.value = index;
  if (index === null) {
    comparePin.value = null;
    painting.value = false;
  }
}
/** Space / the header Zoom button: leave the zoom, or open it on `at` (else the first picked image). */
function toggleZoom(at: number | null = null): void {
  if (zoomIndex.value !== null) setZoom(null);
  else if (at !== null) setZoom(at);
  else if (total.value) setZoom(Math.max(0, cells.value.findIndex((c) => picked.value.has(c.key))));
}
function step(delta: number): void {
  if (zoomIndex.value === null || total.value === 0) return;
  zoomIndex.value = (zoomIndex.value + delta + total.value) % total.value;
}

const comparePin = ref<number | null>(null);
const comparePos = ref(50);
const compareCell = computed(() => {
  const pin = comparePin.value;
  if (pin === null || pin === zoomIndex.value) return null;
  return cells.value[pin] ?? null;
});
function togglePin(): void {
  if (zoomIndex.value === null) return;
  comparePin.value = comparePin.value === null ? zoomIndex.value : null;
  if (comparePin.value !== null) painting.value = false;
}

const painting = ref(false);
const tool = ref<"brush" | "eraser">("brush");
const brush = ref(40);
const painter = ref<InstanceType<typeof MaskPainter> | null>(null);
function togglePaint(): void {
  painting.value = !painting.value;
  if (painting.value) comparePin.value = null;
}

/** Images an edit of the zoomed one's prompt applies to: the whole frame
 *  with Same shape (its picks go on as one item), else just this one. */
const textKeys = computed(() => {
  const c = zoomCell.value;
  if (!c) return [];
  return props.request.send_as === "same_shape" ? frameKeys(c.frame) : [c.key];
});
const zoomLabel = computed(() => (zoomCell.value ? labels.value[zoomCell.value.frame] : undefined));
const zoomEdit = computed(() => (zoomCell.value ? edits.value[zoomCell.value.key] : undefined));
function canEdit(field: "positive" | "negative"): boolean {
  return props.request.has_clip || zoomLabel.value?.[field] !== undefined;
}
function textValue(field: "positive" | "negative"): string {
  return zoomEdit.value?.[field] ?? zoomLabel.value?.[field] ?? "";
}
function isEdited(field: "positive" | "negative"): boolean {
  return zoomEdit.value?.[field] !== undefined;
}
function setText(field: "positive" | "negative", text: string): void {
  edits.value = withText(edits.value, textKeys.value, field, text, zoomLabel.value?.[field]);
}
function resetText(field: "positive" | "negative"): void {
  setText(field, zoomLabel.value?.[field] ?? "");
}
const maskValue = computed(() => zoomEdit.value?.mask ?? "");
function setMask(url: string): void {
  if (zoomCell.value) edits.value = withMask(edits.value, zoomCell.value.key, url);
}

function isEditedCell(key: string): boolean {
  const e = edits.value[key];
  return !!e && (e.positive !== undefined || e.negative !== undefined);
}
function isMaskedCell(key: string): boolean {
  return !!edits.value[key]?.mask;
}
const editCount = computed(() => Object.values(edits.value).filter(hasEdit).length);

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
  // Escape / outside click: leave the zoom first, then tuck the picker away.
  if (zoomIndex.value !== null) {
    setZoom(null);
    return;
  }
  emit("minimize");
}

function onKey(ev: KeyboardEvent): void {
  const tag = (ev.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  const zoomed = zoomIndex.value !== null;
  if (ev.key === " ") {
    ev.preventDefault();
    toggleZoom(hovered.value);
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    keepPicked();
  } else if ((ev.key === "a" || ev.key === "A") && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    toggleAll();
  } else if (zoomed && ev.key === "ArrowLeft") {
    ev.preventDefault();
    step(-1);
  } else if (zoomed && ev.key === "ArrowRight") {
    ev.preventDefault();
    step(1);
  } else if (zoomed && ev.key === "ArrowUp" && zoomCell.value) {
    ev.preventDefault();
    toggle(zoomCell.value.key);
  } else if (zoomed && (ev.key === "c" || ev.key === "C") && !ev.ctrlKey && !ev.metaKey) {
    ev.preventDefault();
    togglePin();
  } else if (zoomed && (ev.key === "m" || ev.key === "M") && !ev.ctrlKey && !ev.metaKey) {
    ev.preventDefault();
    togglePaint();
  }
}

function indexOf(frame: number, image: number): number {
  return cells.value.findIndex((c) => c.frame === frame && c.image === image);
}
</script>

<template>
  <ModalShell :visible="true" @close="onClose" @keydown="onKey">
    <div class="wp-ifp" data-test="image-filter-picker" tabindex="-1">
      <div class="wp-ifp__head">
        <span class="wp-ifp__head-icon"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v6l-4 2v-8z" /></svg></span>
        <div class="wp-ifp__title-block">
          <div class="wp-ifp__title-row">
            <span class="wp-ifp__name">WP Image Filter</span>
            <span class="wp-ifp__chip">Waiting</span>
            <span v-if="moreWaiting" class="wp-ifp__more" data-test="image-filter-more">+{{ moreWaiting }} more waiting</span>
          </div>
          <div class="wp-ifp__sub">
            <template v-if="multiFrame">{{ frames.length }} frames, {{ total }} images.</template>
            <template v-else>{{ total }} {{ total === 1 ? "image" : "images" }}.</template>
            Click an image to pick it. <template v-if="multiFrame">Click its frame or </template><template v-else>Use </template><b>Zoom &amp; refine</b> (<kbd>Space</kbd>) to compare, edit its prompt or paint a mask. <kbd>Enter</kbd> keeps the picks.
          </div>
        </div>
        <button
          type="button"
          class="wp-ifp__zoom-btn"
          :class="{ 'is-on': zoomCell }"
          :aria-pressed="!!zoomCell"
          title="Zoom in to compare, edit the prompt or paint a mask (Space)"
          data-test="image-filter-zoom-toggle"
          @click="toggleZoom()"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path v-if="zoomCell" d="M20 20l-4.5-4.5M7.5 10.5h6" /><path v-else d="M20 20l-4.5-4.5M10.5 7.5v6M7.5 10.5h6" /></svg>
          {{ zoomCell ? "Back to all" : "Zoom & refine" }}
        </button>
        <div v-if="grid && !zoomCell" class="wp-ifp__seg" role="group" aria-label="Layout">
          <button type="button" :class="{ 'is-on': view === 'grid' }" data-test="image-filter-view-grid" @click="view = 'grid'">Grid</button>
          <button type="button" :class="{ 'is-on': view === 'frames' }" data-test="image-filter-view-frames" @click="view = 'frames'">Frames</button>
        </div>
        <button type="button" class="wp-ifp__icon-btn" title="Hide for now (the run keeps waiting)" data-test="image-filter-minimize" @click="emit('minimize')">
          <svg width="12" height="12" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14" /></svg>
        </button>
      </div>

      <div v-if="zoomCell" class="wp-ifp__zoom" data-test="image-filter-zoom">
        <div class="wp-ifp__stage">
          <button type="button" class="wp-ifp__nav" aria-label="Previous image" @click="step(-1)">‹</button>
          <figure class="wp-ifp__zoom-fig">
            <MaskPainter
              v-if="painting"
              ref="painter"
              :key="zoomCell.key"
              :src="viewUrl(zoomCell.ref)"
              :model-value="maskValue"
              :tool="tool"
              :size="brush"
              @update:model-value="setMask"
            />
            <div v-else-if="compareCell" class="wp-ifp__compare" data-test="image-filter-compare">
              <img :src="viewUrl(zoomCell.ref)" class="wp-ifp__zoom-img" alt="">
              <img
                :src="viewUrl(compareCell.ref)"
                class="wp-ifp__zoom-img wp-ifp__compare-top"
                :style="{ clipPath: `inset(0 ${100 - comparePos}% 0 0)` }"
                alt=""
              >
              <span class="wp-ifp__compare-line" :style="{ left: `${comparePos}%` }" aria-hidden="true" />
              <span class="wp-ifp__compare-tag is-left">{{ multiFrame ? frameTitle(compareCell.frame) : `image ${compareCell.image + 1}` }}</span>
              <span class="wp-ifp__compare-tag is-right">{{ multiFrame ? frameTitle(zoomCell.frame) : `image ${zoomCell.image + 1}` }}</span>
              <input v-model.number="comparePos" type="range" min="0" max="100" class="wp-ifp__compare-range" aria-label="Compare slider">
            </div>
            <img
              v-else
              :src="viewUrl(zoomCell.ref)"
              class="wp-ifp__zoom-img"
              :class="{ 'is-picked': picked.has(zoomCell.key) }"
              alt=""
              @click="toggle(zoomCell.key)"
            >
            <figcaption class="wp-ifp__zoom-cap">
              <span v-if="multiFrame">Frame {{ frameTitle(zoomCell.frame) }} · </span>image {{ zoomCell.image + 1 }}
              <span class="wp-ifp__zoom-pos">{{ (zoomIndex ?? 0) + 1 }} / {{ total }}</span>
              <button
                type="button"
                class="wp-ifp__zoom-state"
                :class="{ 'is-picked': picked.has(zoomCell.key) }"
                data-test="image-filter-zoom-pick"
                @click="toggle(zoomCell.key)"
              >{{ picked.has(zoomCell.key) ? "Picked" : "Not picked" }}</button>
              <button
                type="button"
                class="wp-ifp__mini"
                :class="{ 'is-on': comparePin !== null }"
                title="Pin this image, then step to another to compare them (C)"
                data-test="image-filter-compare-pin"
                @click="togglePin"
              >{{ comparePin === null ? "Compare" : compareCell ? "Stop comparing" : "Pinned, pick another" }}</button>
            </figcaption>
          </figure>
          <button type="button" class="wp-ifp__nav" aria-label="Next image" @click="step(1)">›</button>
        </div>

        <aside class="wp-ifp__refine" data-test="image-filter-refine">
          <div class="wp-ifp__refine-title">Refine before it goes on</div>
          <p v-if="request.send_as === 'same_shape' && (frames[zoomCell.frame]?.length ?? 0) > 1" class="wp-ifp__hint">
            Same shape: a prompt edit covers every image of this frame.
          </p>
          <template v-for="field in (['positive', 'negative'] as const)" :key="field">
            <div class="wp-ifp__field-head">
              <span>{{ field === "positive" ? "Positive" : "Negative" }}</span>
              <span v-if="isEdited(field)" class="wp-ifp__badge">edited</span>
              <span class="wp-ifp__spacer" />
              <button v-if="isEdited(field)" type="button" class="wp-ifp__link" @click="resetText(field)">Reset</button>
            </div>
            <textarea
              v-if="canEdit(field)"
              class="wp-ifp__text"
              :value="textValue(field)"
              rows="5"
              spellcheck="false"
              :aria-label="`${field} prompt`"
              :data-test="`image-filter-${field}`"
              @input="setText(field, ($event.target as HTMLTextAreaElement).value)"
            />
            <p v-else class="wp-ifp__hint">Wire {{ field }}_text or a CLIP into the filter to edit it here.</p>
          </template>
          <p v-if="!request.has_clip && (canEdit('positive') || canEdit('negative'))" class="wp-ifp__warn" data-test="image-filter-no-clip">
            No CLIP wired: an edit changes the text outputs only, the conditioning stays as it was.
          </p>

          <div class="wp-ifp__field-head wp-ifp__mask-head">
            <span>Mask</span>
            <span v-if="maskValue" class="wp-ifp__badge">painted</span>
            <span class="wp-ifp__spacer" />
            <button
              type="button"
              class="wp-ifp__mini"
              :class="{ 'is-on': painting }"
              title="Paint a mask for this image (M)"
              data-test="image-filter-paint"
              @click="togglePaint"
            >{{ painting ? "Done" : "Paint" }}</button>
          </div>
          <template v-if="painting">
            <div class="wp-ifp__seg wp-ifp__seg--full" role="group" aria-label="Tool">
              <button type="button" :class="{ 'is-on': tool === 'brush' }" @click="tool = 'brush'">Brush</button>
              <button type="button" :class="{ 'is-on': tool === 'eraser' }" @click="tool = 'eraser'">Eraser</button>
            </div>
            <label class="wp-ifp__size">Size <input v-model.number="brush" type="range" min="4" max="160"> <span>{{ brush }}</span></label>
            <div class="wp-ifp__row">
              <button type="button" class="wp-ifp__mini" @click="painter?.invert()">Invert</button>
              <button type="button" class="wp-ifp__mini" data-test="image-filter-mask-clear" @click="painter?.clear()">Clear</button>
            </div>
          </template>
          <p class="wp-ifp__hint">Goes to the masks output for this image. Images you don't paint keep the incoming mask.</p>
        </aside>
      </div>

      <div v-else-if="showGrid && grid" class="wp-ifp__body is-grid" data-test="image-filter-grid">
        <SweepGrid
          v-model:layout="layout"
          :grid="grid"
          :axes="axes"
          :frames="frames"
          :picked="picked"
          :edits="edits"
          :tooltip="frameTooltip"
          @toggle="toggle"
          @toggle-frames="toggleFrames"
          @zoom="(f, i) => setZoom(indexOf(f, i))"
          @hover="(f, i, on) => (hovered = on ? indexOf(f, i) : null)"
        />
      </div>

      <div v-else class="wp-ifp__body" :class="{ 'is-flat': !multiFrame }">
        <section
          v-for="(imgs, f) in frames"
          :key="f"
          class="wp-ifp__frame"
          :class="{ 'is-flat': !multiFrame }"
          :data-test="`image-filter-frame-${f}`"
          :title="multiFrame ? `${frameTooltip(f)}\nClick the image to pick it, the frame around it to zoom in.` : undefined"
          @click="multiFrame && setZoom(indexOf(f, 0))"
        >
          <div v-if="multiFrame" class="wp-ifp__frame-head">
            <span class="wp-ifp__frame-label">
              <template v-for="(part, pi) in frameParts(labels[f], f, axes)" :key="pi">
                <span v-if="pi > 0" class="wp-ifp__sep">·</span><span :class="{ 'wp-ifp__opt': pi > 0 }">{{ part }}</span>
              </template>
            </span>
            <button
              v-if="imgs.length > 1"
              type="button"
              class="wp-ifp__frame-all"
              title="Pick or clear every image of this frame"
              @click.stop="toggleFrame(f)"
            >all</button>
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
              @zoom="setZoom(indexOf(f, i))"
              @hover="(on) => (hovered = on ? indexOf(f, i) : null)"
            />
          </div>
        </section>
      </div>

      <div class="wp-ifp__foot">
        <div class="wp-ifp__status" data-test="image-filter-status">
          <span><strong>{{ pickedList.length }}</strong> picked<template v-if="multiFrame"> from {{ pickedFrames }} {{ pickedFrames === 1 ? "frame" : "frames" }}</template></span>
          <span v-if="editCount" class="wp-ifp__edits">{{ editCount }} refined</span>
          <span v-if="leftLabel" class="wp-ifp__left" :class="{ 'is-low': (left ?? 99) <= 30 }">{{ leftLabel }}</span>
        </div>
        <span class="wp-ifp__spacer" />
        <button
          v-if="canSendToLoop"
          type="button"
          class="wp-ifp__btn"
          :disabled="pickedFrames === 0"
          title="Lock the picked frames' seeds in the Context Loop and bypass the rest, so the next run repeats only your picks"
          data-test="image-filter-send-loop"
          @click="sendToLoop"
        >Send to Loop</button>
        <button type="button" class="wp-ifp__btn wp-ifp__btn--danger" title="Skip everything after this node for this run" data-test="image-filter-stop" @click="stop">Stop branch</button>
        <button type="button" class="wp-ifp__btn" data-test="image-filter-keep-all" @click="keepAll">Keep all {{ total }}</button>
        <button
          type="button"
          class="wp-ifp__btn wp-ifp__btn--primary"
          :disabled="pickedList.length === 0"
          data-test="image-filter-keep-picked"
          @click="keepPicked"
        >{{ pickedList.length ? `Keep ${pickedList.length} picked` : "Keep picked" }}</button>
      </div>
    </div>
  </ModalShell>
</template>

<style scoped>
@import "../shared/theme.css";

.wp-ifp { width: min(1280px, 95vw); max-height: 90vh; display: flex; flex-direction: column; background: var(--wp-bg2); border: 1px solid var(--wp-border); border-radius: 6px; overflow: hidden; color: var(--wp-text); font-size: 12px; box-shadow: 0 18px 50px rgba(0,0,0,.55); outline: none; }
.wp-ifp__head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; flex-shrink: 0; border-bottom: 1px solid var(--wp-border); background: linear-gradient(180deg, color-mix(in srgb, var(--wp-accent) 18%, var(--wp-bg2)) 0%, var(--wp-bg2) 100%); }
.wp-ifp__head-icon { color: var(--wp-accent); width: 24px; display: flex; justify-content: center; }
.wp-ifp__title-block { flex: 1; min-width: 0; }
.wp-ifp__title-row { display: flex; align-items: center; gap: 8px; }
.wp-ifp__name { font: 600 13px var(--wp-font-sans); }
.wp-ifp__chip { font: 600 9px var(--wp-font-sans); text-transform: uppercase; letter-spacing: .06em; padding: 2px 6px; border-radius: 2px; background: color-mix(in srgb, var(--wp-accent) 22%, transparent); color: var(--wp-accent); }
.wp-ifp__more { font: 10px var(--wp-font-sans); color: var(--wp-amber, #fbbf24); }
.wp-ifp__sub { font: 10.5px var(--wp-font-sans); color: var(--wp-text-dim, var(--wp-text3)); margin-top: 3px; }
.wp-ifp__sub kbd { font: 9.5px var(--wp-font-mono, monospace); padding: 0 4px; border: 1px solid var(--wp-border); border-radius: 3px; background: var(--wp-bg3); color: var(--wp-text-muted, var(--wp-text2)); }
.wp-ifp__icon-btn { background: transparent; border: 0; color: var(--wp-text-dim, var(--wp-text3)); cursor: pointer; padding: 4px; display: flex; }
.wp-ifp__icon-btn:hover { color: var(--wp-text); }

.wp-ifp__zoom-btn { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border: 1px solid var(--wp-border); border-radius: 4px; background: var(--wp-bg3); color: var(--wp-text); font: 11px var(--wp-font-sans); cursor: pointer; white-space: nowrap; }
.wp-ifp__zoom-btn:hover { border-color: var(--wp-accent); }
.wp-ifp__zoom-btn.is-on { background: color-mix(in srgb, var(--wp-accent) 25%, var(--wp-bg3)); border-color: var(--wp-accent); }
.wp-ifp__sub b { font-weight: 600; color: var(--wp-text-muted, var(--wp-text2)); }
.wp-ifp__seg { display: inline-flex; border: 1px solid var(--wp-border); border-radius: 4px; overflow: hidden; }
.wp-ifp__seg button { padding: 3px 9px; border: 0; background: var(--wp-bg3); color: var(--wp-text-muted, var(--wp-text2)); font: 11px var(--wp-font-sans); cursor: pointer; }
.wp-ifp__seg button + button { border-left: 1px solid var(--wp-border); }
.wp-ifp__seg button.is-on { background: color-mix(in srgb, var(--wp-accent) 25%, var(--wp-bg3)); color: var(--wp-text); }
.wp-ifp__seg--full { display: flex; }
.wp-ifp__seg--full button { flex: 1; }

.wp-ifp__body { overflow-y: auto; padding: 12px 14px; flex: 1; min-height: 0; display: flex; flex-wrap: wrap; gap: 10px; align-content: flex-start; }
.wp-ifp__body.is-grid { display: flex; flex-direction: column; flex-wrap: nowrap; padding: 0; overflow: hidden; }
.wp-ifp__frame { display: flex; flex-direction: column; gap: 4px; padding: 6px; border-radius: 5px; background: var(--wp-bg-deep, var(--wp-bg)); border: 1px solid var(--wp-border); --wp-ifp-tile: 150px; }
.wp-ifp__frame.is-flat { padding: 0; background: transparent; border: 0; width: 100%; --wp-ifp-tile: 200px; }
.wp-ifp__frame:not(.is-flat) { cursor: zoom-in; }
.wp-ifp__frame:not(.is-flat):hover { border-color: var(--wp-accent, #4a8cff); }
.wp-ifp__frame:not(.is-flat):hover .wp-ifp__frame-label { color: var(--wp-accent-text, var(--wp-accent)); }
.wp-ifp__frame-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.wp-ifp__frame-label { flex: 1; min-width: 0; padding: 0 2px; font: 10px var(--wp-font-mono, monospace); color: var(--wp-text-dim, var(--wp-text3)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wp-ifp__frame-all { background: transparent; border: 0; padding: 0 2px; font: 10px var(--wp-font-sans); color: var(--wp-text-dim, var(--wp-text3)); cursor: pointer; }
.wp-ifp__frame-all:hover { color: var(--wp-accent-text, var(--wp-accent)); }
.wp-ifp__opt { color: var(--wp-text-muted, var(--wp-text2)); font-family: var(--wp-font-sans); }
.wp-ifp__sep { margin: 0 4px; opacity: .6; }
.wp-ifp__tiles { display: flex; flex-wrap: wrap; gap: 6px; }


.wp-ifp__zoom { flex: 1; min-height: 0; display: flex; }
.wp-ifp__stage { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px; }
.wp-ifp__zoom-fig { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 0; min-height: 0; }
.wp-ifp__zoom-img { display: block; max-width: 100%; max-height: calc(90vh - 200px); border: 3px solid transparent; border-radius: 6px; cursor: pointer; }
.wp-ifp__zoom-img.is-picked { border-color: var(--wp-green, #34c47c); }
.wp-ifp__zoom-cap { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: center; font: 11px var(--wp-font-sans); color: var(--wp-text-muted, var(--wp-text2)); }
.wp-ifp__zoom-pos { color: var(--wp-text-dim, var(--wp-text3)); font-family: var(--wp-font-mono, monospace); }
.wp-ifp__zoom-state { padding: 1px 6px; border-radius: 3px; border: 1px solid var(--wp-border); background: transparent; color: inherit; font: inherit; cursor: pointer; }
.wp-ifp__zoom-state.is-picked { border-color: var(--wp-green, #34c47c); color: var(--wp-green, #34c47c); }
.wp-ifp__nav { flex-shrink: 0; width: 34px; height: 60px; border: 1px solid var(--wp-border); border-radius: 4px; background: var(--wp-bg3); color: var(--wp-text-muted, var(--wp-text2)); font-size: 22px; cursor: pointer; }
.wp-ifp__nav:hover { color: var(--wp-text); border-color: var(--wp-accent); }

.wp-ifp__compare { position: relative; line-height: 0; }
.wp-ifp__compare .wp-ifp__zoom-img { cursor: ew-resize; }
.wp-ifp__compare-top { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.wp-ifp__compare-line { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #fff; box-shadow: 0 0 4px rgba(0,0,0,.6); pointer-events: none; }
.wp-ifp__compare-tag { position: absolute; top: 8px; padding: 2px 6px; border-radius: 3px; background: rgba(0,0,0,.6); color: #fff; font: 10.5px/1.4 var(--wp-font-sans); pointer-events: none; }
.wp-ifp__compare-tag.is-left { left: 8px; }
.wp-ifp__compare-tag.is-right { right: 8px; }
.wp-ifp__compare-range { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: ew-resize; }

.wp-ifp__refine { width: 300px; flex-shrink: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 12px; border-left: 1px solid var(--wp-border); background: var(--wp-bg-deep, var(--wp-bg)); }
.wp-ifp__refine-title { font: 600 11px var(--wp-font-sans); text-transform: uppercase; letter-spacing: .05em; color: var(--wp-text-muted, var(--wp-text2)); }
.wp-ifp__field-head { display: flex; align-items: center; gap: 6px; margin-top: 6px; font: 600 11px var(--wp-font-sans); }
.wp-ifp__mask-head { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--wp-border); }
.wp-ifp__badge { font: 600 9px var(--wp-font-sans); text-transform: uppercase; letter-spacing: .05em; padding: 1px 5px; border-radius: 2px; background: color-mix(in srgb, var(--wp-accent) 22%, transparent); color: var(--wp-accent-text, var(--wp-accent)); }
.wp-ifp__text { width: 100%; box-sizing: border-box; resize: vertical; min-height: 70px; padding: 6px; border: 1px solid var(--wp-border); border-radius: 4px; background: var(--wp-bg2); color: var(--wp-text); font: 11px/1.45 var(--wp-font-mono, monospace); }
.wp-ifp__text:focus { outline: none; border-color: var(--wp-accent); }
.wp-ifp__hint { margin: 0; font: 10.5px/1.4 var(--wp-font-sans); color: var(--wp-text-dim, var(--wp-text3)); }
.wp-ifp__warn { margin: 0; font: 10.5px/1.4 var(--wp-font-sans); color: var(--wp-amber, #fbbf24); }
.wp-ifp__link { background: none; border: 0; padding: 0; color: var(--wp-accent-text, var(--wp-accent)); font: 10.5px var(--wp-font-sans); cursor: pointer; }
.wp-ifp__mini { padding: 2px 8px; border: 1px solid var(--wp-border); border-radius: 3px; background: var(--wp-bg3); color: var(--wp-text-muted, var(--wp-text2)); font: 10.5px var(--wp-font-sans); cursor: pointer; }
.wp-ifp__mini:hover { color: var(--wp-text); border-color: var(--wp-text-dim, #666); }
.wp-ifp__mini.is-on { border-color: var(--wp-accent); color: var(--wp-text); background: color-mix(in srgb, var(--wp-accent) 22%, var(--wp-bg3)); }
.wp-ifp__size { display: flex; align-items: center; gap: 6px; font: 10.5px var(--wp-font-sans); color: var(--wp-text-muted, var(--wp-text2)); }
.wp-ifp__size input { flex: 1; accent-color: var(--wp-accent); }
.wp-ifp__size span { width: 26px; text-align: right; font-family: var(--wp-font-mono, monospace); }
.wp-ifp__row { display: flex; gap: 6px; }

.wp-ifp__foot { display: flex; align-items: center; gap: 8px; padding: 10px 14px; flex-shrink: 0; background: var(--wp-bg3); border-top: 1px solid var(--wp-border); }
.wp-ifp__status { display: flex; gap: 12px; font: 11px var(--wp-font-sans); color: var(--wp-text-muted, var(--wp-text2)); }
.wp-ifp__status strong { color: var(--wp-text); }
.wp-ifp__edits { color: var(--wp-accent-text, var(--wp-accent)); }
.wp-ifp__left { color: var(--wp-text-dim, var(--wp-text3)); font-family: var(--wp-font-mono, monospace); }
.wp-ifp__left.is-low { color: var(--wp-amber, #fbbf24); }
.wp-ifp__spacer { flex: 1; }
.wp-ifp__btn { padding: 6px 12px; border: 1px solid var(--wp-border); border-radius: 3px; background: var(--wp-bg2); color: var(--wp-text); font: 11px var(--wp-font-sans); cursor: pointer; }
.wp-ifp__btn:hover { border-color: var(--wp-text-dim, #666); }
.wp-ifp__btn:disabled { opacity: .45; cursor: default; }
.wp-ifp__btn--danger { color: var(--wp-red, #f08a8a); }
.wp-ifp__btn--danger:hover { border-color: var(--wp-red, #f08a8a); }
.wp-ifp__btn--primary { background: var(--wp-accent); border-color: var(--wp-accent); color: #fff; font-weight: 600; }
</style>
