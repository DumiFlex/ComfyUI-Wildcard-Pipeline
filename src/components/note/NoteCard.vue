<script setup lang="ts">
/**
 * A WP Note as it reads on the canvas: its look (card, sticky, label), its
 * tone (step number or icon badge), title, marks and text. The node draws
 * it, and the note text window draws the same card as its preview, so the
 * preview always matches the node's settings.
 */
import { computed } from "vue";
import NoteMarkdown from "./note-markdown";
import { vTooltip } from "@/kit/tooltip";
import type { NoteConfig } from "../../extension/note";

const props = withDefaults(defineProps<{
  config: Pick<NoteConfig, "tone" | "look" | "step" | "icon" | "text" | "images" | "bookmark">;
  title: string;
  pinned?: boolean;
  /** What the body says when there is no text yet. */
  emptyText?: string;
}>(), { pinned: false, emptyText: "Double-click to write this note." });

const hasTitle = computed(() => props.title.trim() !== "" && props.title !== "WP Note");
/** Any link in the text: a label shows a mark for it. */
const hasLink = computed(() => /\]\((?:https?:\/\/|docs:|wp:)/i.test(props.config.text));
const bookmarkHint = computed(() => {
  const b = props.config.bookmark;
  return b ? `Also a bookmark${b.shortcut ? ` · ${b.shortcut}` : ""}` : "";
});
</script>

<template>
  <div class="wp-note__panel" :class="`wp-note__panel--${config.look}`" data-test="note-panel">
    <div class="wp-note__head">
      <span v-if="config.tone === 'step'" class="wp-note__step" data-test="note-step">{{ config.step }}</span>
      <span v-else-if="config.tone === 'icon'" class="wp-note__badge" aria-hidden="true"><i class="pi" :class="`pi-${config.icon}`"></i></span>
      <span v-if="hasTitle || config.look === 'label'" class="wp-note__title" data-test="note-title-text">{{ title }}</span>
      <!-- A label keeps its text and docs link for the hover card; these
           marks say there is something to see. -->
      <span v-if="config.look === 'label' && config.text.trim()" class="wp-note__marks" aria-hidden="true">
        <i class="pi pi-align-left" data-test="note-has-text"></i>
        <i v-if="hasLink" class="pi pi-link" data-test="note-has-link"></i>
      </span>
      <i
        v-if="pinned"
        v-tooltip="'Pinned'"
        class="pi pi-thumbtack wp-note__bm wp-note__pinmark"
        aria-label="Pinned"
        data-test="note-pinned-mark"
      ></i>
      <i
        v-if="config.bookmark"
        v-tooltip="bookmarkHint"
        class="pi pi-bookmark-fill wp-note__bm"
        :aria-label="bookmarkHint"
        data-test="note-bookmark-mark"
      ></i>
    </div>
    <div v-if="config.look !== 'label'" class="wp-note__body">
      <NoteMarkdown v-if="config.text.trim()" :text="config.text" :images="config.images" />
      <p v-else class="wp-note__empty">{{ emptyText }}</p>
    </div>
  </div>
</template>

<style scoped>
.wp-note__panel {
  position: relative;
  box-sizing: border-box;
  border-radius: min(12px, var(--wp-radius-cap, 999px));
  padding: 12px 14px 12px 16px;
  box-shadow: var(--wp-shadow-md, 0 4px 14px rgb(0 0 0 / 0.35));
  font-family: var(--wp-font-sans, Inter, sans-serif);
  font-size: 13px;
  line-height: 20px;
  color: var(--wp-text, inherit);
}
/* Card: solid panel, a tone edge on the left. */
.wp-note__panel--card {
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  overflow: hidden;
}
.wp-note__panel--card::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: var(--wp-note-tone);
}
/* Sticky: tinted with the tone, dashed tone outline inside. */
.wp-note__panel--sticky {
  background: color-mix(in srgb, var(--wp-note-tone) 18%, var(--wp-bg-2));
  border: 1px solid color-mix(in srgb, var(--wp-note-tone) 55%, transparent);
  outline: 1px dashed color-mix(in srgb, var(--wp-note-tone) 45%, transparent);
  outline-offset: -6px;
}
/* Label: a small solid tag, title only. Sized to its text (the node follows
   it, see widgets/note.ts), up to a cap where the title ellipsizes. */
.wp-note__panel--label {
  display: inline-flex;
  width: max-content;
  max-width: 480px;
  padding: 6px 12px 6px 8px;
  border-radius: var(--wp-radius-cap, 999px);
  background: var(--wp-note-tone);
  color: white;
}

.wp-note__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 24px;
}
.wp-note__step,
.wp-note__badge {
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: var(--wp-radius-cap, 999px);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
}
.wp-note__step { background: var(--wp-note-tone); color: white; }
.wp-note__badge {
  background: color-mix(in srgb, var(--wp-note-tone) 22%, transparent);
  color: var(--wp-note-tone);
}
.wp-note__badge .pi { font-size: 13px; }
.wp-note__panel--label .wp-note__step,
.wp-note__panel--label .wp-note__badge { background: rgb(255 255 255 / 0.22); color: inherit; }
.wp-note__title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: 0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-note__panel--label .wp-note__title { font-size: 14px; flex: 0 1 auto; }
.wp-note__marks { display: inline-flex; gap: 4px; flex: none; opacity: 0.8; }
.wp-note__marks .pi { font-size: 11px; }
/* Also a bookmark: a small mark in the head (its tooltip names the key). */
.wp-note__bm {
  flex: none;
  margin-left: auto;
  font-size: 12px;
  color: var(--wp-note-tone);
  pointer-events: auto;
}
.wp-note__bm + .wp-note__bm { margin-left: 2px; }
.wp-note__pinmark { color: var(--wp-text-dim); font-size: 11px; }
.wp-note__panel--label .wp-note__bm { color: inherit; opacity: 0.85; }

.wp-note__body { margin-top: 8px; color: var(--wp-text-muted, inherit); }
.wp-note__empty { margin: 0; color: var(--wp-text-dim); }
</style>
