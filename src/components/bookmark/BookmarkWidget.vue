<script setup lang="ts">
/**
 * WP Bookmark's panel. The node has no frame (like WP Note): read, it is a
 * small pill (icon, name, shortcut, and a pencil that shows when the node is
 * selected); double-click or the pencil opens the editor card.
 */
import { computed, ref, watch } from "vue";
import Banner from "../../kit/Banner.vue";
import ColorField from "../../kit/ColorField.vue";
import Kbd from "../../kit/Kbd.vue";
import WpButton from "../../kit/WpButton.vue";
import WpIconButton from "../../kit/WpIconButton.vue";
import WpSwitch from "../../kit/WpSwitch.vue";
import BookmarkFields from "./BookmarkFields.vue";
import NoteIconGrid from "../note/NoteIconGrid.vue";
import { pushToast } from "../shared/toast-store";
import {
  BOOKMARK_ANCHORS,
  findConflicts,
  type BookmarkConfig,
  type BookmarkJump,
  type KeyOwner,
} from "../../extension/bookmarks";

const props = defineProps<{
  config: BookmarkConfig;
  title: string;
  /** Muted or bypassed. */
  disabled: boolean;
  /** Lives inside a subgraph. */
  nested: boolean;
  /** ComfyUI's pin. */
  pinned: boolean;
  /** The node is selected: the pill shows its pencil. */
  selected: boolean;
  /** Everyone else's keys, read fresh on each call. */
  getKeymap: () => KeyOwner[];
  /** The canvas zoom right now. */
  getZoom: () => number;
  /** The view on screen now, for "Use this view". */
  getView: () => { x: number; y: number };
  /** The form is open; otherwise the node shows its compact read view. */
  editing: boolean;
}>();

const emit = defineEmits<{
  (e: "update:config", next: BookmarkConfig): void;
  (e: "update:title", next: string): void;
  (e: "update:pinned", next: boolean): void;
  (e: "recording", on: boolean): void;
  (e: "jump"): void;
  (e: "update:editing", next: boolean): void;
}>();

function patch(part: Partial<BookmarkConfig>): void {
  emit("update:config", { ...props.config, ...part });
}

const anchorLabel = computed(() => props.config.anchor === "custom"
  ? "Your view"
  : BOOKMARK_ANCHORS.find((a) => a.id === props.config.anchor)?.label ?? "");
/** Where it lands and at what zoom: the pill's tooltip. */
const summary = computed(() => {
  const zoom = props.config.zoomMode === "keep" ? "your zoom" : `${props.config.zoom}×`;
  return `Lands at: ${anchorLabel.value} · ${zoom}${props.nested ? " · in a subgraph" : ""}`;
});

// The read view marks a clash; the form's fields list it in full.
const clashes = computed(() =>
  props.editing ? [] : findConflicts(props.config.shortcut, props.getKeymap()).filter((c) => c.severity !== "info"));

const fields = ref<InstanceType<typeof BookmarkFields> | null>(null);
// The full icon list, inline under the head (the note's own grid).
const pickIcon = ref(false);

// "Show on canvas" waits for Done: hiding the node mid-edit would take the
// form away with it.
const showOnCanvas = ref(!props.config.hidden);
watch(() => props.editing, (on) => {
  if (on) showOnCanvas.value = !props.config.hidden;
});

function onTitle(ev: Event): void {
  emit("update:title", (ev.target as HTMLInputElement).value);
}

function done(): void {
  fields.value?.stopRecording();
  pickIcon.value = false;
  const hide = !showOnCanvas.value;
  if (hide !== props.config.hidden) {
    patch({ hidden: hide });
    if (hide) {
      pushToast(`"${props.title}" is hidden. Show it again from the Bookmarks dock.`, {
        severity: "info",
        singletonKey: "wp-bookmark-hidden",
      });
    }
  }
  emit("update:editing", false);
}
</script>

<template>
  <div
    class="wp-bm wp-frameless"
    :class="{ 'wp-bm--off': disabled, 'wp-bm--editing': editing, 'wp-bm--selected': selected }"
    :style="config.color ? { '--wp-bm-color': config.color } : undefined"
    data-test="wp-bookmark"
  >
    <!-- Read view: a small pill. It lets clicks through to the canvas
         (drag, select, double-click to edit); only the pencil takes them. -->
    <div v-if="!editing" class="wp-bm__pill" :title="summary" data-test="bm-view">
      <i class="pi wp-bm__glyph" :class="`pi-${config.icon}`" aria-hidden="true"></i>
      <span class="wp-bm__name-text" data-test="bm-name">{{ title }}</span>
      <i v-if="pinned" class="pi pi-thumbtack wp-bm__mark" title="Pinned" aria-label="Pinned" data-test="bm-pinned"></i>
      <span v-if="disabled" class="wp-bm__offtag" title="Muted or bypassed: its shortcut does nothing">off</span>
      <template v-else-if="config.shortcut">
        <i
          v-if="clashes.length"
          class="pi pi-exclamation-triangle wp-bm__clash"
          :title="clashes.map((c) => c.message).join(' ')"
          :aria-label="clashes.map((c) => c.message).join(' ')"
          data-test="bm-view-clash"
        ></i>
        <Kbd :keys="config.shortcut" size="sm" />
      </template>
      <WpIconButton
        class="wp-bm__edit"
        icon="pi-pencil"
        label="Edit bookmark"
        variant="bare"
        data-test="bm-edit"
        @click="emit('update:editing', true)"
      />
    </div>

    <!-- Keys typed here never reach ComfyUI's keybindings. -->
    <form
      v-else
      class="wp-bm__form"
      data-test="bm-form"
      @submit.prevent="done"
      @keydown.stop
      @keyup.stop
      @keypress.stop
    >
      <div class="wp-bm__head">
        <WpButton
          size="sm"
          :icon="`pi-${config.icon}`"
          :pressed="pickIcon"
          hint="Choose the icon"
          :aria-label="`Choose the icon (now ${config.icon.replace(/-/g, ' ')})`"
          data-test="bm-icon"
          @click="pickIcon = !pickIcon"
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
      </div>
      <NoteIconGrid
        v-if="pickIcon"
        :selected="config.icon"
        :color="config.color"
        data-test="bm-icon-grid"
        @pick="(n: string) => { patch({ icon: n || 'bookmark' }); pickIcon = false; }"
      />

      <Banner v-if="disabled" tone="info" size="sm" data-test="bm-off">
        Muted or bypassed: its shortcut does nothing until you turn it back on.
      </Banner>

      <BookmarkFields
        ref="fields"
        :value="config"
        :get-keymap="getKeymap"
        :get-zoom="getZoom"
        :get-view="getView"
        @update="(part: Partial<BookmarkJump>) => patch(part)"
        @recording="(on: boolean) => emit('recording', on)"
      />

      <div class="wp-bm__row">
        <WpSwitch
          :model-value="showOnCanvas"
          size="sm"
          label="Show on canvas"
          data-test="bm-visible"
          @update:model-value="(v: boolean) => (showOnCanvas = v)"
        />
        <WpSwitch
          :model-value="pinned"
          size="sm"
          label="Pinned"
          data-test="bm-pin"
          @update:model-value="(v: boolean) => emit('update:pinned', v)"
        />
      </div>
      <div class="wp-bm__actions">
        <span v-if="nested" class="wp-bm__hint">In a subgraph: the jump opens it.</span>
        <span class="wp-bm__spacer"></span>
        <WpButton size="sm" icon="pi-directions" hint="Try the jump" data-test="bm-go" @click="emit('jump')">Go</WpButton>
        <WpButton variant="primary" size="sm" type="submit" data-test="bm-done">Done</WpButton>
      </div>
    </form>
  </div>
</template>

<style scoped>
.wp-bm {
  --wp-bm-color: var(--wp-accent);
  box-sizing: border-box;
  color: var(--wp-text);
  font: 12px var(--wp-font-sans, sans-serif);
  /* Clicks go through to the canvas; the pencil and the form take them back. */
  pointer-events: none;
  min-width: 0;
}
.wp-bm--editing { width: 100%; }

/* ── read view: a pill sized to its content ─────────────────────────── */
.wp-bm__pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  /* Its own width (the node follows it), up to a long name's worth. */
  width: max-content;
  max-width: 320px;
  box-sizing: border-box;
  height: 30px;
  padding: 0 4px 0 10px;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-left: 3px solid var(--wp-bm-color);
  border-radius: var(--wp-radius-cap, 999px);
  box-shadow: var(--wp-shadow-md, 0 4px 14px rgb(0 0 0 / 0.35));
  white-space: nowrap;
}
.wp-bm--off .wp-bm__pill { opacity: 0.6; }
.wp-bm__glyph { color: var(--wp-bm-color); font-size: 13px; }
.wp-bm__name-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
  font-size: 12.5px;
}
.wp-bm__mark { color: var(--wp-text-dim); font-size: 11px; }
.wp-bm__clash { color: var(--wp-warn); font-size: 12px; }
.wp-bm__offtag { color: var(--wp-text-dim); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; }
/* The pencil shows when the node is selected, or under the pointer. */
.wp-bm__edit {
  pointer-events: auto;
  opacity: 0;
  transition: opacity 120ms;
}
.wp-bm--selected .wp-bm__edit,
.wp-bm__edit:hover,
.wp-bm__edit:focus-visible { opacity: 1; }

/* ── editor card ────────────────────────────────────────────────────── */
.wp-bm__form {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-left: 3px solid var(--wp-bm-color);
  border-radius: min(10px, var(--wp-radius-cap, 999px));
  box-shadow: var(--wp-shadow-md, 0 4px 14px rgb(0 0 0 / 0.35));
}
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
  gap: 14px;
  min-height: 28px;
  padding: 2px 6px;
  background: var(--wp-bg2, var(--wp-bg-1));
  border-radius: min(4px, var(--wp-radius-cap, 999px));
}
.wp-bm__actions { display: flex; align-items: center; gap: 6px; }
.wp-bm__hint { font-size: 10.5px; color: var(--wp-text-dim); }
.wp-bm__spacer { flex: 1; }
</style>

<style>
@import "../shared/frameless-node.css";

@layer wp-extension {
  /* Nodes 2.0: the widget wrappers take pointer events and would eat the
     press that drags the node; the canvas handles it instead. The pencil
     and the editor take events back. */
  .lg-node:has(.wp-bm) .lg-node-widgets,
  .lg-node:has(.wp-bm) .lg-node-widgets * { pointer-events: none !important; }
  .lg-node:has(.wp-bm) .wp-bm__form,
  .lg-node:has(.wp-bm) .wp-bm__form *,
  .lg-node:has(.wp-bm) .wp-bm__edit { pointer-events: auto !important; }
}
</style>
