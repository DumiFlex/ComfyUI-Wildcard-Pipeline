<script setup lang="ts">
import { computed, ref } from "vue";
import Banner from "../../kit/Banner.vue";
import ColorField from "../../kit/ColorField.vue";
import IconPicker from "../../kit/IconPicker.vue";
import Kbd from "../../kit/Kbd.vue";
import WpButton from "../../kit/WpButton.vue";
import WpIconButton from "../../kit/WpIconButton.vue";
import WpSwitch from "../../kit/WpSwitch.vue";
import BookmarkFields from "./BookmarkFields.vue";
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

function patch(part: Partial<BookmarkConfig>): void {
  emit("update:config", { ...props.config, ...part });
}

const anchorLabel = computed(() => BOOKMARK_ANCHORS.find((a) => a.id === props.config.anchor)?.label ?? "");
/** The read view's one line: where it lands and at what zoom. */
const summary = computed(() => {
  const zoom = props.config.zoomMode === "keep" ? "your zoom" : `${props.config.zoom}×`;
  return `${anchorLabel.value} · ${zoom}${props.nested ? " · subgraph" : ""}`;
});

// The read view marks a clash; the form's fields list it in full.
const clashes = computed(() =>
  props.editing ? [] : findConflicts(props.config.shortcut, props.getKeymap()).filter((c) => c.severity !== "info"));

const fields = ref<InstanceType<typeof BookmarkFields> | null>(null);

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
  fields.value?.stopRecording();
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
          v-if="clashes.length"
          class="pi pi-exclamation-triangle wp-bm__clash"
          :title="clashes.map((c) => c.message).join(' ')"
          :aria-label="clashes.map((c) => c.message).join(' ')"
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

    <BookmarkFields
      ref="fields"
      :value="config"
      :get-keymap="getKeymap"
      :get-zoom="getZoom"
      @update="(part: Partial<BookmarkJump>) => patch(part)"
      @recording="(on: boolean) => emit('recording', on)"
    />

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
.wp-bm__hint { font-size: 10.5px; color: var(--wp-text-dim); }
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
