<script setup lang="ts">
/**
 * The jump settings every bookmark has: where it lands, its zoom and its
 * shortcut with the clash check. Shared by WP Bookmark's editor and a WP
 * Note that is also a bookmark, so the two can't drift apart.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Banner from "../../kit/Banner.vue";
import Kbd from "../../kit/Kbd.vue";
import WpButton from "../../kit/WpButton.vue";
import WpIconButton from "../../kit/WpIconButton.vue";
import WpNumber from "../../kit/WpNumber.vue";
import WpSegmented from "../../kit/WpSegmented.vue";
import { pushToast } from "../shared/toast-store";
import {
  BOOKMARK_ANCHORS,
  BOOKMARK_MARGIN,
  BOOKMARK_ZOOM_MAX,
  BOOKMARK_ZOOM_MIN,
  BROWSER_RESERVED,
  comboFromEvent,
  findConflicts,
  suggestFreeCombo,
  type BookmarkAnchor,
  type BookmarkJump,
  type BookmarkZoomMode,
  type KeyOwner,
} from "../../extension/bookmarks";

const props = defineProps<{
  value: BookmarkJump;
  /** Everyone else's keys, read fresh on each call. */
  getKeymap: () => KeyOwner[];
  /** The canvas zoom right now. */
  getZoom: () => number;
  /** The view on screen now: the canvas point in the middle of the free
   *  screen, for "Use this view". */
  getView: () => { x: number; y: number };
}>();

const emit = defineEmits<{
  (e: "update", part: Partial<BookmarkJump>): void;
  (e: "recording", on: boolean): void;
}>();

const ZOOM_MODES: { value: BookmarkZoomMode; label: string }[] = [
  { value: "fixed", label: "Set" },
  { value: "keep", label: "Keep current" },
];

const anchorLabel = computed(() => props.value.anchor === "custom"
  ? "Your view"
  : BOOKMARK_ANCHORS.find((a) => a.id === props.value.anchor)?.label ?? "");

/** Land on the view on screen now, at the zoom it has. */
function useThisView(): void {
  emit("update", { anchor: "custom", view: props.getView(), zoomMode: "fixed", zoom: Math.round(props.getZoom() * 100) / 100 });
}

const recording = ref(false);
const refused = ref("");
const keymap = ref<KeyOwner[]>([]);
function refreshKeymap(): void {
  keymap.value = props.getKeymap();
}
refreshKeymap();
watch(() => props.value.shortcut, refreshKeymap);

const conflicts = computed(() => findConflicts(props.value.shortcut, keymap.value));
const worst = computed(() =>
  conflicts.value.some((c) => c.severity === "error") ? "danger"
  : conflicts.value.some((c) => c.severity === "warning") ? "warn"
  : "info");

function onRecordKey(e: KeyboardEvent): void {
  e.preventDefault();
  e.stopPropagation();
  if (e.key === "Escape") return stopRecording();
  if (e.key === "Backspace" || e.key === "Delete") {
    emit("update", { shortcut: "" });
    return stopRecording();
  }
  const combo = comboFromEvent(e);
  if (!combo) return; // a modifier on its own: wait for the key
  if (BROWSER_RESERVED.has(combo)) {
    refused.value = `${combo} belongs to the browser. Try another.`;
    return;
  }
  emit("update", { shortcut: combo });
  stopRecording();
}

function startRecording(): void {
  if (recording.value) return stopRecording();
  refreshKeymap();
  refused.value = "";
  recording.value = true;
  emit("recording", true);
  // Capture phase on window: the note's form stops keydown at itself.
  window.addEventListener("keydown", onRecordKey, true);
}

function stopRecording(): void {
  if (!recording.value) return;
  recording.value = false;
  refused.value = "";
  emit("recording", false);
  window.removeEventListener("keydown", onRecordKey, true);
}
onBeforeUnmount(stopRecording);
defineExpose({ stopRecording });

function suggest(): void {
  refreshKeymap();
  // Never offer the key it already has: each press moves on to the next.
  const own = props.value.shortcut ? [{ combo: props.value.shortcut, label: "", source: "" }] : [];
  const combo = suggestFreeCombo([...keymap.value, ...own]);
  if (combo) emit("update", { shortcut: combo });
  else pushToast("No free shortcut left to suggest. Record one instead.", { severity: "info" });
}
</script>

<template>
  <div class="wp-bmf">
    <div class="wp-bmf__row wp-bmf__row--top">
      <span class="wp-bmf__label">Lands at</span>
      <div class="wp-bmf__grid" role="radiogroup" aria-label="Where the bookmark lands on screen">
        <WpIconButton
          v-for="a in BOOKMARK_ANCHORS"
          :key="a.id"
          :icon="value.anchor === a.id ? 'pi-circle-fill' : 'pi-circle'"
          :label="a.label"
          :pressed="value.anchor === a.id"
          :tone="value.anchor === a.id ? 'accent' : 'neutral'"
          :data-test="`bm-anchor-${a.id}`"
          @click="emit('update', { anchor: a.id as BookmarkAnchor })"
        />
      </div>
      <div class="wp-bmf__anchor-note">
        <span class="wp-bmf__anchor-name" data-test="bm-anchor-name">{{ anchorLabel }}</span>
        <span class="wp-bmf__hint">{{ value.anchor === "custom" ? "the view you set, at its zoom" : `of the screen, ${BOOKMARK_MARGIN} px in` }}</span>
        <WpButton
          size="sm"
          icon="pi-camera"
          :pressed="value.anchor === 'custom'"
          hint="Land on the view on screen now, at this zoom"
          data-test="bm-use-view"
          @click="useThisView"
        >Use this view</WpButton>
      </div>
    </div>

    <div class="wp-bmf__row">
      <span class="wp-bmf__label">Zoom</span>
      <WpSegmented
        :model-value="value.zoomMode"
        :options="ZOOM_MODES"
        size="sm"
        aria-label="Zoom"
        test-prefix="bm-zoom"
        @update:model-value="(v: BookmarkZoomMode) => emit('update', { zoomMode: v })"
      />
      <template v-if="value.zoomMode === 'fixed'">
        <WpNumber
          class="wp-bmf__zoom"
          :model-value="value.zoom"
          :min="BOOKMARK_ZOOM_MIN"
          :max="BOOKMARK_ZOOM_MAX"
          :step="0.1"
          size="sm"
          suffix="×"
          aria-label="Zoom level"
          data-test="bm-zoom-value"
          @update:model-value="(v: number | null) => emit('update', { zoom: v ?? 1 })"
        />
        <WpIconButton
          icon="pi-search-plus"
          label="Use the zoom you're at now"
          data-test="bm-zoom-now"
          @click="emit('update', { zoom: Math.round(getZoom() * 100) / 100 })"
        />
      </template>
    </div>

    <div class="wp-bmf__row">
      <span class="wp-bmf__label">Shortcut</span>
      <WpButton
        size="sm"
        :pressed="recording"
        class="wp-bmf__record"
        :hint="recording ? 'Press the keys. Esc cancels, Backspace clears.' : 'Click, then press the keys'"
        data-test="bm-record"
        @click="startRecording"
        @blur="stopRecording"
      >
        <template v-if="recording">Press keys…</template>
        <Kbd v-else-if="value.shortcut" :keys="value.shortcut" size="sm" />
        <template v-else>Record</template>
      </WpButton>
      <WpIconButton icon="pi-bolt" label="Suggest a free shortcut" data-test="bm-suggest" @click="suggest" />
      <WpIconButton
        v-if="value.shortcut"
        icon="pi-times"
        label="Remove the shortcut"
        data-test="bm-clear"
        @click="emit('update', { shortcut: '' })"
      />
    </div>
    <p v-if="refused" class="wp-bmf__refused" role="alert" data-test="bm-refused">{{ refused }}</p>
    <Banner
      v-else-if="conflicts.length && worst !== 'info'"
      :tone="worst"
      size="sm"
      data-test="bm-conflicts"
    >
      <span v-for="(c, i) in conflicts" :key="i" class="wp-bmf__conflict">{{ c.message }}</span>
    </Banner>
    <p v-else-if="conflicts.length" class="wp-bmf__hint wp-bmf__hint--block" data-test="bm-conflicts">{{ conflicts[0]?.message }}</p>
  </div>
</template>

<style scoped>
.wp-bmf {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  color: var(--wp-text);
  font: 12px var(--wp-font-sans, sans-serif);
}
.wp-bmf__row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 2px 6px;
  background: var(--wp-bg2, var(--wp-bg-1));
  border-radius: min(4px, var(--wp-radius-cap, 999px));
}
.wp-bmf__row--top { padding-block: 4px; }
.wp-bmf__label {
  width: 58px;
  flex: none;
  font-weight: 600;
  color: var(--wp-text-dim);
}
.wp-bmf__grid {
  display: grid;
  grid-template-columns: repeat(3, 20px);
  gap: 1px;
  padding: 2px;
  border: 1px solid var(--wp-border);
  border-radius: min(4px, var(--wp-radius-cap, 999px));
}
.wp-bmf__grid :deep(.pi) { font-size: 8px; }
.wp-bmf__anchor-note { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; }
.wp-bmf__anchor-name { font-weight: 600; }
.wp-bmf__zoom { width: 84px; }
.wp-bmf__record { min-width: 86px; }
.wp-bmf__hint { font-size: 10.5px; color: var(--wp-text-dim); }
.wp-bmf__hint--block { margin: 0; padding: 0 6px; }
.wp-bmf__refused { margin: 0; padding: 0 6px; font-size: 11px; color: var(--wp-danger); }
.wp-bmf__conflict { display: block; }
</style>
