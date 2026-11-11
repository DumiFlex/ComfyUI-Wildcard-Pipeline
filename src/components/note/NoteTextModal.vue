<script setup lang="ts">
/**
 * WP Note's text in its own window: the Markdown editor on the left, the
 * note as it will read on the right, updated as you type. It edits a draft
 * (text + pictures); Done writes it to the node, Cancel drops it.
 */
import { computed, ref } from "vue";
import NodeEditWindow from "../shared/NodeEditWindow.vue";
import NoteMarkdown from "./note-markdown";
import NoteTextEditor from "./NoteTextEditor.vue";
import type { NoteImage, NoteLook } from "../../extension/note";

const props = defineProps<{
  text: string;
  images: Record<string, NoteImage>;
  /** The note's title, for the window's header. */
  title: string;
  look: NoteLook;
  /** The note's colour as CSS (`""` = the accent). */
  toneCss: string;
}>();
const emit = defineEmits<{
  (e: "done", v: { text: string; images: Record<string, NoteImage> }): void;
  (e: "close"): void;
}>();

const text = ref(props.text);
const images = ref<Record<string, NoteImage>>({ ...props.images });
const dirty = computed(() => text.value !== props.text || Object.keys(images.value).join() !== Object.keys(props.images).join());

const shownTitle = computed(() => (props.title.trim() ? props.title : "WP Note"));
const isLabel = computed(() => props.look === "label");

function done(): void {
  emit("done", { text: text.value, images: images.value });
}
</script>

<template>
  <NodeEditWindow
    :title="shownTitle"
    chip="Note text"
    icon="align-left"
    :sub="isLabel ? 'A label shows this text when you hover it.' : 'Markdown: the bar adds links to the docs, icons, pictures and formatting.'"
    :dirty="dirty"
    :width="1040"
    @done="done"
    @cancel="emit('close')"
  >
    <div class="wp-note-tx" data-test="note-text-window">
      <section class="wp-note-tx__pane" aria-label="Write">
        <span class="wp-note-tx__label">Write</span>
        <NoteTextEditor
          class="wp-note-tx__editor"
          :model-value="text"
          :images="images"
          :rows="18"
          :preview-toggle="false"
          :hint="isLabel ? 'What the label explains…' : 'Write the note. The bar above adds links to the docs, icons and formatting.'"
          @update:model-value="(v: string) => (text = v)"
          @picture="(v) => { text = v.text; images = v.images; }"
        />
      </section>
      <section class="wp-note-tx__pane" aria-label="Preview">
        <span class="wp-note-tx__label">Preview</span>
        <div class="wp-note-tx__card" :style="toneCss ? { '--wp-note-tone': toneCss } : undefined" data-test="note-text-preview">
          <NoteMarkdown v-if="text.trim()" :text="text" :images="images" />
          <p v-else class="wp-note-tx__empty">Nothing written yet.</p>
        </div>
      </section>
    </div>
  </NodeEditWindow>
</template>

<style scoped>
.wp-note-tx {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
  align-items: stretch;
}
@media (max-width: 760px) {
  .wp-note-tx { grid-template-columns: minmax(0, 1fr); }
}
.wp-note-tx__pane { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.wp-note-tx__label { font-size: 11px; font-weight: 600; color: var(--wp-text-muted); }
/* The note as a card, the way the node shows it: its colour on the left edge. */
.wp-note-tx__card {
  --wp-note-tone: var(--wp-accent);
  position: relative;
  flex: 1 1 auto;
  min-height: 120px;
  max-height: 62vh;
  overflow: auto;
  padding: 12px 14px 12px 18px;
  border: 1px solid var(--wp-border);
  border-radius: min(12px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-1, var(--wp-bg-2));
  font-size: 13px;
  line-height: 20px;
  color: var(--wp-text-muted, var(--wp-text));
}
.wp-note-tx__card::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: var(--wp-note-tone);
}
.wp-note-tx__empty { margin: 0; color: var(--wp-text-dim); }
</style>
