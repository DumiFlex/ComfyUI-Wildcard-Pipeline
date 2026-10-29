<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Banner from "../../kit/Banner.vue";
import ColorField from "../../kit/ColorField.vue";
import IconPicker from "../../kit/IconPicker.vue";
import Kbd from "../../kit/Kbd.vue";
import WpButton from "../../kit/WpButton.vue";
import WpIconButton from "../../kit/WpIconButton.vue";
import WpNumber from "../../kit/WpNumber.vue";
import WpSegmented from "../../kit/WpSegmented.vue";
import WpSwitch from "../../kit/WpSwitch.vue";
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
  type BookmarkConfig,
  type BookmarkZoomMode,
  type KeyOwner,
} from "../../extension/bookmarks";

const props = defineProps<{
  config: BookmarkConfig;
  title: string;
  /** Muted or bypassed. */
  disabled: boolean;
  /** Lives inside a subgraph. */
  nested: boolean;
  /** Everyone else's keys, read fresh on each call. */
  getKeymap: () => KeyOwner[];
  /** The canvas zoom right now. */
  getZoom: () => number;
  /** The form is open; otherwise the node shows its compact read view. */
  editing: boolean;
}>();

const emit = defineEmits<{
  (e: "update:config", next: BookmarkConfig): void;
  (e: "update:title", next: string): void;
  (e: "recording", on: boolean): void;
  (e: "jump"): void;
  (e: "update:editing", next: boolean): void;
}>();

const ZOOM_MODES: { value: BookmarkZoomMode; label: string }[] = [
  { value: "fixed", label: "Set" },
  { value: "keep", label: "Keep current" },
];

function patch(part: Partial<BookmarkConfig>): void {
  emit("update:config", { ...props.config, ...part });
}

const anchorLabel = computed(() => BOOKMARK_ANCHORS.find((a) => a.id === props.config.anchor)?.label ?? "");
/** The read view's one line: where it lands and at what zoom. */
const summary = computed(() => {
  const zoom = props.config.zoomMode === "keep" ? "your zoom" : `${props.config.zoom}×`;
  return `${anchorLabel.value} · ${zoom}${props.nested ? " · subgraph" : ""}`;
});

// ── shortcut recording ───────────────────────────────────────────────
const recording = ref(false);
const refused = ref("");
const keymap = ref<KeyOwner[]>([]);
function refreshKeymap(): void {
  keymap.value = props.getKeymap();
}
refreshKeymap();
watch(() => props.config.shortcut, refreshKeymap);

const conflicts = computed(() => findConflicts(props.config.shortcut, keymap.value));
const worst = computed(() =>
  conflicts.value.some((c) => c.severity === "error") ? "danger"
  : conflicts.value.some((c) => c.severity === "warning") ? "warn"
  : "info");

function onRecordKey(e: KeyboardEvent): void {
  e.preventDefault();
  e.stopPropagation();
  if (e.key === "Escape") return stopRecording();
  if (e.key === "Backspace" || e.key === "Delete") {
    patch({ shortcut: "" });
    return stopRecording();
  }
  const combo = comboFromEvent(e);
  if (!combo) return; // a modifier on its own: wait for the key
  if (BROWSER_RESERVED.has(combo)) {
    refused.value = `${combo} belongs to the browser. Try another.`;
    return;
  }
  patch({ shortcut: combo });
  stopRecording();
}

function startRecording(): void {
  if (recording.value) return stopRecording();
  refreshKeymap();
  refused.value = "";
  recording.value = true;
  emit("recording", true);
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

function suggest(): void {
  refreshKeymap();
  const combo = suggestFreeCombo(keymap.value);
  if (combo) patch({ shortcut: combo });
  else pushToast("No free shortcut left to suggest. Record one instead.", { severity: "info" });
}

function onShow(show: boolean): void {
  patch({ hidden: !show });
  if (!show) {
    pushToast(`"${props.title}" is hidden. Show it again from the Bookmarks dock.`, {
      severity: "info",
      singletonKey: "wp-bookmark-hidden",
    });
  }
}

function onTitle(ev: Event): void {
  emit("update:title", (ev.target as HTMLInputElement).value);
}

function done(): void {
  stopRecording();
  emit("update:editing", false);
}
</script>

<template>
  <div class="wp-bm" :class="{ 'wp-bm--off': disabled }" data-test="wp-bookmark">
    <!-- Read view: one line, so a bookmark stays small on the canvas. -->
    <div
      v-if="!editing"
      class="wp-bm__view"
      :style="config.color ? { '--wp-bm-color': config.color } : undefined"
      data-test="bm-view"
    >
      <i class="pi wp-bm__glyph" :class="`pi-${config.icon}`" aria-hidden="true"></i>
      <span class="wp-bm__summary" data-test="bm-summary">{{ summary }}</span>
      <span v-if="disabled" class="wp-bm__offtag" title="Muted or bypassed: its shortcut does nothing">off</span>
      <template v-else-if="config.shortcut">
        <i
          v-if="worst !== 'info' && conflicts.length"
          class="pi pi-exclamation-triangle wp-bm__clash"
          :title="conflicts.map((c) => c.message).join(' ')"
          :aria-label="conflicts.map((c) => c.message).join(' ')"
          data-test="bm-view-clash"
        ></i>
        <Kbd :keys="config.shortcut" size="sm" />
      </template>
      <WpButton variant="primary" size="sm" icon="pi-directions" hint="Jump here" data-test="bm-go" @click="emit('jump')">Go</WpButton>
      <WpIconButton icon="pi-pencil" label="Edit bookmark" data-test="bm-edit" @click="emit('update:editing', true)" />
    </div>

    <template v-else>
    <div class="wp-bm__head">
      <IconPicker
        :model-value="config.icon"
        compact
        aria-label="Bookmark icon"
        data-test="bm-icon"
        @update:model-value="(v: string | null) => patch({ icon: v || 'bookmark' })"
      />
      <ColorField
        :model-value="config.color || 'none'"
        allow-none
        aria-label="Bookmark colour"
        data-test="bm-color"
        @update:model-value="(v: string) => patch({ color: v === 'none' ? '' : v.slice(0, 7) })"
      />
      <input
        class="wp-bm__name"
        :value="title"
        aria-label="Bookmark name"
        data-test="bm-title"
        @input="onTitle"
      />
      <WpButton variant="primary" size="sm" icon="pi-directions" hint="Jump here" data-test="bm-go" @click="emit('jump')">Go</WpButton>
    </div>

    <Banner v-if="disabled" tone="info" size="sm" data-test="bm-off">
      Muted or bypassed: its shortcut does nothing until you turn it back on.
    </Banner>

    <div class="wp-bm__row wp-bm__row--top">
      <span class="wp-bm__label">Lands at</span>
      <div class="wp-bm__grid" role="radiogroup" aria-label="Where the bookmark lands on screen">
        <WpIconButton
          v-for="a in BOOKMARK_ANCHORS"
          :key="a.id"
          :icon="config.anchor === a.id ? 'pi-circle-fill' : 'pi-circle'"
          :label="a.label"
          :pressed="config.anchor === a.id"
          :tone="config.anchor === a.id ? 'accent' : 'neutral'"
          :data-test="`bm-anchor-${a.id}`"
          @click="patch({ anchor: a.id as BookmarkAnchor })"
        />
      </div>
      <div class="wp-bm__anchor-note">
        <span class="wp-bm__anchor-name">{{ anchorLabel }}</span>
        <span class="wp-bm__hint">of the screen, {{ BOOKMARK_MARGIN }} px in</span>
      </div>
    </div>

    <div class="wp-bm__row">
      <span class="wp-bm__label">Zoom</span>
      <WpSegmented
        :model-value="config.zoomMode"
        :options="ZOOM_MODES"
        size="sm"
        aria-label="Zoom"
        test-prefix="bm-zoom"
        @update:model-value="(v: BookmarkZoomMode) => patch({ zoomMode: v })"
      />
      <template v-if="config.zoomMode === 'fixed'">
        <WpNumber
          class="wp-bm__zoom"
          :model-value="config.zoom"
          :min="BOOKMARK_ZOOM_MIN"
          :max="BOOKMARK_ZOOM_MAX"
          :step="0.1"
          size="sm"
          suffix="×"
          aria-label="Zoom level"
          data-test="bm-zoom-value"
          @update:model-value="(v: number | null) => patch({ zoom: v ?? 1 })"
        />
        <WpIconButton
          icon="pi-search-plus"
          label="Use the zoom you're at now"
          data-test="bm-zoom-now"
          @click="patch({ zoom: Math.round(getZoom() * 100) / 100 })"
        />
      </template>
    </div>

    <div class="wp-bm__row">
      <span class="wp-bm__label">Shortcut</span>
      <WpButton
        size="sm"
        :pressed="recording"
        class="wp-bm__record"
        :hint="recording ? 'Press the keys. Esc cancels, Backspace clears.' : 'Click, then press the keys'"
        data-test="bm-record"
        @click="startRecording"
        @blur="stopRecording"
      >
        <template v-if="recording">Press keys…</template>
        <Kbd v-else-if="config.shortcut" :keys="config.shortcut" size="sm" />
        <template v-else>Record</template>
      </WpButton>
      <WpIconButton icon="pi-bolt" label="Suggest a free shortcut" data-test="bm-suggest" @click="suggest" />
      <WpIconButton
        v-if="config.shortcut"
        icon="pi-times"
        label="Remove the shortcut"
        data-test="bm-clear"
        @click="patch({ shortcut: '' })"
      />
    </div>
    <p v-if="refused" class="wp-bm__refused" role="alert" data-test="bm-refused">{{ refused }}</p>
    <Banner
      v-else-if="conflicts.length && worst !== 'info'"
      :tone="worst"
      size="sm"
      data-test="bm-conflicts"
    >
      <span v-for="(c, i) in conflicts" :key="i" class="wp-bm__conflict">{{ c.message }}</span>
    </Banner>
    <p v-else-if="conflicts.length" class="wp-bm__hint wp-bm__hint--block" data-test="bm-conflicts">{{ conflicts[0]?.message }}</p>

    <div class="wp-bm__row">
      <WpSwitch
        :model-value="!config.hidden"
        size="sm"
        label="Show on canvas"
        data-test="bm-visible"
        @update:model-value="onShow"
      />
      <span v-if="nested" class="wp-bm__hint">In a subgraph: the jump opens it.</span>
      <span class="wp-bm__spacer"></span>
      <WpButton variant="primary" size="sm" data-test="bm-done" @click="done">Done</WpButton>
    </div>
    </template>
  </div>
</template>

<style scoped>
.wp-bm {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 2px 6px;
  color: var(--wp-text);
  font: 12px var(--wp-font-sans, sans-serif);
  min-width: 0;
}
.wp-bm--off .wp-bm__head { opacity: 0.6; }
.wp-bm__head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wp-bm__name {
  flex: 1;
  min-width: 0;
  height: var(--wp-control-h-sm, 24px);
  padding: 0 8px;
  box-sizing: border-box;
  color: var(--wp-text);
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  font: 600 12.5px var(--wp-font-sans, sans-serif);
}
.wp-bm__name:focus-visible { outline: 2px solid var(--wp-accent); outline-offset: -1px; }
.wp-bm__row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 2px 6px;
  background: var(--wp-bg2, var(--wp-bg-1));
  border-radius: min(4px, var(--wp-radius-cap, 999px));
}
.wp-bm__row--top { align-items: center; padding-block: 4px; }
.wp-bm__label {
  width: 58px;
  flex: none;
  font-weight: 600;
  color: var(--wp-text-dim);
}
.wp-bm__grid {
  display: grid;
  grid-template-columns: repeat(3, 20px);
  gap: 1px;
  padding: 2px;
  border: 1px solid var(--wp-border);
  border-radius: min(4px, var(--wp-radius-cap, 999px));
}
.wp-bm__grid :deep(.pi) { font-size: 8px; }
.wp-bm__anchor-note { display: flex; flex-direction: column; min-width: 0; }
.wp-bm__anchor-name { font-weight: 600; }
.wp-bm__zoom { width: 84px; }
.wp-bm__record { min-width: 86px; }
.wp-bm__hint { font-size: 10.5px; color: var(--wp-text-dim); }
.wp-bm__hint--block { margin: 0; padding: 0 6px; }
.wp-bm__refused { margin: 0; padding: 0 6px; font-size: 11px; color: var(--wp-danger); }
.wp-bm__conflict { display: block; }
.wp-bm__spacer { flex: 1; }
.wp-bm__view {
  --wp-bm-color: var(--wp-accent);
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 2px 4px 2px 10px;
  background: var(--wp-bg2, var(--wp-bg-1));
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  box-shadow: inset 3px 0 0 var(--wp-bm-color);
}
.wp-bm__glyph { color: var(--wp-bm-color); font-size: 14px; }
.wp-bm__summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--wp-text-dim);
}
.wp-bm__clash { color: var(--wp-warn); font-size: 12px; }
.wp-bm__offtag { color: var(--wp-text-dim); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; }
</style>
