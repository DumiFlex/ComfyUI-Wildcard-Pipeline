<script setup lang="ts">
/**
 * PickerModal — the pause-and-pick screen of WP Image Filter.
 *
 * Shows every image of one waiting request, grouped by frame when a Context
 * Loop (or any list) produced several. Click picks, Space zooms the hovered
 * image, Enter keeps the picks. Closing (Escape / clicking outside) only
 * minimises it: the run keeps waiting until one of the three answers is sent.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ModalShell from "../shared/ModalShell.vue";
import { pickKey, viewUrl, type Pick, type PickAnswer, type ImageRef } from "./types";
import type { WaitingRequest } from "../../extension/image-filter";
import { draftPicks, saveDraftPicks, secondsLeft } from "../../extension/image-filter";

const props = withDefaults(defineProps<{ request: WaitingRequest; moreWaiting?: number }>(), { moreWaiting: 0 });
const emit = defineEmits<{ answer: [answer: PickAnswer]; minimize: [] }>();

interface Cell { frame: number; image: number; ref: ImageRef; key: string }

const frames = computed(() => props.request.frames);
const cells = computed<Cell[]>(() =>
  frames.value.flatMap((imgs, f) => imgs.map((ref, i) => ({ frame: f, image: i, ref, key: pickKey(f, i) }))),
);
const total = computed(() => cells.value.length);
const multiFrame = computed(() => frames.value.length > 1);

const picked = ref<Set<string>>(new Set(draftPicks(props.request.token)));
watch(() => props.request.token, (token) => {
  picked.value = new Set(draftPicks(token));
  zoomIndex.value = null;
});
watch(picked, (keys) => saveDraftPicks(props.request.token, keys));

function toggle(key: string): void {
  const next = new Set(picked.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  picked.value = next;
}
function toggleFrame(frame: number): void {
  const keys = (frames.value[frame] ?? []).map((_, i) => pickKey(frame, i));
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
const pickedFrames = computed(() => new Set(pickedList.value.map(([f]) => f)).size);

function frameTitle(frame: number): string {
  const label = props.request.labels[frame];
  const loop = label?.loop_index;
  return typeof loop === "number" ? `#${loop + 1}` : `#${frame + 1}`;
}

/* ── zoom ─────────────────────────────────────────────────────────────── */

const zoomIndex = ref<number | null>(null);
const hovered = ref<number | null>(null);
const zoomCell = computed(() => (zoomIndex.value === null ? null : cells.value[zoomIndex.value] ?? null));

function step(delta: number): void {
  if (zoomIndex.value === null || total.value === 0) return;
  zoomIndex.value = (zoomIndex.value + delta + total.value) % total.value;
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

function keepPicked(): void {
  if (pickedList.value.length === 0) return;
  emit("answer", { action: "picks", picks: pickedList.value });
}
function keepAll(): void {
  emit("answer", { action: "keep_all" });
}
function stop(): void {
  emit("answer", { action: "stop" });
}

function onClose(): void {
  // Escape / outside click: leave the zoom first, then tuck the picker away.
  if (zoomIndex.value !== null) {
    zoomIndex.value = null;
    return;
  }
  emit("minimize");
}

function onKey(ev: KeyboardEvent): void {
  const tag = (ev.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (ev.key === " ") {
    ev.preventDefault();
    if (zoomIndex.value !== null) zoomIndex.value = null;
    else if (hovered.value !== null) zoomIndex.value = hovered.value;
    else if (total.value) zoomIndex.value = 0;
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    keepPicked();
  } else if ((ev.key === "a" || ev.key === "A") && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    toggleAll();
  } else if (zoomIndex.value !== null && ev.key === "ArrowLeft") {
    ev.preventDefault();
    step(-1);
  } else if (zoomIndex.value !== null && ev.key === "ArrowRight") {
    ev.preventDefault();
    step(1);
  } else if (zoomIndex.value !== null && ev.key === "ArrowUp" && zoomCell.value) {
    ev.preventDefault();
    toggle(zoomCell.value.key);
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
            Click to pick, <kbd>Space</kbd> to zoom, <kbd>Enter</kbd> to keep the picks.
          </div>
        </div>
        <button type="button" class="wp-ifp__icon-btn" title="Hide for now (the run keeps waiting)" data-test="image-filter-minimize" @click="emit('minimize')">
          <svg width="12" height="12" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14" /></svg>
        </button>
      </div>

      <div v-if="zoomCell" class="wp-ifp__zoom" data-test="image-filter-zoom">
        <button type="button" class="wp-ifp__nav" aria-label="Previous image" @click="step(-1)">‹</button>
        <figure class="wp-ifp__zoom-fig">
          <img
            :src="viewUrl(zoomCell.ref)"
            class="wp-ifp__zoom-img"
            :class="{ 'is-picked': picked.has(zoomCell.key) }"
            alt=""
            @click="toggle(zoomCell.key)"
          >
          <figcaption class="wp-ifp__zoom-cap">
            <span v-if="multiFrame">Frame {{ frameTitle(zoomCell.frame) }} · </span>image {{ zoomCell.image + 1 }}
            <span class="wp-ifp__zoom-pos">{{ (zoomIndex ?? 0) + 1 }} / {{ total }}</span>
            <span class="wp-ifp__zoom-state" :class="{ 'is-picked': picked.has(zoomCell.key) }">{{ picked.has(zoomCell.key) ? "Picked" : "Not picked" }}</span>
          </figcaption>
        </figure>
        <button type="button" class="wp-ifp__nav" aria-label="Next image" @click="step(1)">›</button>
      </div>

      <div v-else class="wp-ifp__body" :class="{ 'is-flat': !multiFrame }">
        <section
          v-for="(imgs, f) in frames"
          :key="f"
          class="wp-ifp__frame"
          :class="{ 'is-flat': !multiFrame }"
          :data-test="`image-filter-frame-${f}`"
        >
          <button
            v-if="multiFrame"
            type="button"
            class="wp-ifp__frame-label"
            title="Pick or clear the whole frame"
            @click="toggleFrame(f)"
          >{{ frameTitle(f) }}</button>
          <div class="wp-ifp__tiles">
            <button
              v-for="(img, i) in imgs"
              :key="i"
              type="button"
              class="wp-ifp__tile"
              :class="{ 'is-picked': picked.has(pickKey(f, i)) }"
              :aria-pressed="picked.has(pickKey(f, i))"
              :data-test="`image-filter-tile-${f}-${i}`"
              @click="toggle(pickKey(f, i))"
              @dblclick="zoomIndex = indexOf(f, i)"
              @mouseenter="hovered = indexOf(f, i)"
              @mouseleave="hovered = null"
            >
              <img :src="viewUrl(img)" alt="" loading="lazy" draggable="false">
              <span v-if="picked.has(pickKey(f, i))" class="wp-ifp__check" aria-hidden="true">✓</span>
              <span class="wp-ifp__idx">{{ i + 1 }}</span>
            </button>
          </div>
        </section>
      </div>

      <div class="wp-ifp__foot">
        <div class="wp-ifp__status" data-test="image-filter-status">
          <span><strong>{{ pickedList.length }}</strong> picked<template v-if="multiFrame"> from {{ pickedFrames }} {{ pickedFrames === 1 ? "frame" : "frames" }}</template></span>
          <span v-if="leftLabel" class="wp-ifp__left" :class="{ 'is-low': (left ?? 99) <= 30 }">{{ leftLabel }}</span>
        </div>
        <span class="wp-ifp__spacer" />
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

.wp-ifp { width: min(1180px, 94vw); max-height: 90vh; display: flex; flex-direction: column; background: var(--wp-bg2); border: 1px solid var(--wp-border); border-radius: 6px; overflow: hidden; color: var(--wp-text); font-size: 12px; box-shadow: 0 18px 50px rgba(0,0,0,.55); outline: none; }
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

.wp-ifp__body { overflow-y: auto; padding: 12px 14px; flex: 1; min-height: 0; display: flex; flex-wrap: wrap; gap: 10px; align-content: flex-start; }
.wp-ifp__frame { display: flex; flex-direction: column; gap: 4px; padding: 6px; border-radius: 5px; background: var(--wp-bg-deep, var(--wp-bg)); border: 1px solid var(--wp-border); }
.wp-ifp__frame.is-flat { padding: 0; background: transparent; border: 0; width: 100%; }
.wp-ifp__frame-label { align-self: flex-start; background: transparent; border: 0; padding: 0 2px; font: 10px var(--wp-font-mono, monospace); color: var(--wp-text-dim, var(--wp-text3)); cursor: pointer; }
.wp-ifp__frame-label:hover { color: var(--wp-accent-text, var(--wp-accent)); }
.wp-ifp__tiles { display: flex; flex-wrap: wrap; gap: 6px; }
.wp-ifp__tile { position: relative; padding: 0; border: 2px solid transparent; border-radius: 5px; background: var(--wp-bg3); cursor: pointer; overflow: hidden; line-height: 0; }
.wp-ifp__tile img { display: block; max-width: 200px; max-height: 200px; width: auto; height: auto; user-select: none; }
.wp-ifp__frame:not(.is-flat) .wp-ifp__tile img { max-width: 150px; max-height: 150px; }
.wp-ifp__tile:hover { border-color: var(--wp-border2, var(--wp-text-dim, #666)); }
.wp-ifp__tile.is-picked { border-color: var(--wp-green, #34c47c); box-shadow: 0 0 0 2px color-mix(in srgb, var(--wp-green, #34c47c) 35%, transparent); }
.wp-ifp__check { position: absolute; top: 4px; right: 4px; width: 18px; height: 18px; border-radius: 50%; background: var(--wp-green, #34c47c); color: #0d2a1b; font: 800 11px/18px var(--wp-font-sans); text-align: center; }
.wp-ifp__idx { position: absolute; left: 4px; bottom: 3px; font: 10px/1 var(--wp-font-mono, monospace); color: #fff; text-shadow: 0 1px 2px #000; }

.wp-ifp__zoom { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px; }
.wp-ifp__zoom-fig { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 0; min-height: 0; }
.wp-ifp__zoom-img { max-width: 100%; max-height: calc(90vh - 190px); border: 3px solid transparent; border-radius: 6px; cursor: pointer; }
.wp-ifp__zoom-img.is-picked { border-color: var(--wp-green, #34c47c); }
.wp-ifp__zoom-cap { display: flex; gap: 10px; align-items: center; font: 11px var(--wp-font-sans); color: var(--wp-text-muted, var(--wp-text2)); }
.wp-ifp__zoom-pos { color: var(--wp-text-dim, var(--wp-text3)); font-family: var(--wp-font-mono, monospace); }
.wp-ifp__zoom-state { padding: 1px 6px; border-radius: 3px; border: 1px solid var(--wp-border); }
.wp-ifp__zoom-state.is-picked { border-color: var(--wp-green, #34c47c); color: var(--wp-green, #34c47c); }
.wp-ifp__nav { flex-shrink: 0; width: 34px; height: 60px; border: 1px solid var(--wp-border); border-radius: 4px; background: var(--wp-bg3); color: var(--wp-text-muted, var(--wp-text2)); font-size: 22px; cursor: pointer; }
.wp-ifp__nav:hover { color: var(--wp-text); border-color: var(--wp-accent); }

.wp-ifp__foot { display: flex; align-items: center; gap: 8px; padding: 10px 14px; flex-shrink: 0; background: var(--wp-bg3); border-top: 1px solid var(--wp-border); }
.wp-ifp__status { display: flex; gap: 12px; font: 11px var(--wp-font-sans); color: var(--wp-text-muted, var(--wp-text2)); }
.wp-ifp__status strong { color: var(--wp-text); }
.wp-ifp__left { color: var(--wp-text-dim, var(--wp-text3)); font-family: var(--wp-font-mono, monospace); }
.wp-ifp__left.is-low { color: var(--wp-amber, #fbbf24); }
.wp-ifp__spacer { flex: 1; }
.wp-ifp__btn { padding: 6px 12px; border: 1px solid var(--wp-border); border-radius: 3px; background: var(--wp-bg2); color: var(--wp-text); font: 11px var(--wp-font-sans); cursor: pointer; }
.wp-ifp__btn:hover { border-color: var(--wp-text-dim, #666); }
.wp-ifp__btn--danger { color: var(--wp-red, #f08a8a); }
.wp-ifp__btn--danger:hover { border-color: var(--wp-red, #f08a8a); }
.wp-ifp__btn--primary { background: var(--wp-accent); border-color: var(--wp-accent); color: #fff; font-weight: 600; }
.wp-ifp__btn--primary:disabled { opacity: .45; cursor: default; }
</style>
