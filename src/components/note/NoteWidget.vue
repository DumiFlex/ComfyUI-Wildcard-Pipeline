<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import ColorField from "../../kit/ColorField.vue";
import WpButton from "../../kit/WpButton.vue";
import WpIconButton from "../../kit/WpIconButton.vue";
import WpNumber from "../../kit/WpNumber.vue";
import WpSegmented from "../../kit/WpSegmented.vue";
import WpSwitch from "../../kit/WpSwitch.vue";
import NoteMarkdown from "./note-markdown";
import NoteTextEditor from "./NoteTextEditor.vue";
import NoteIconGrid from "./NoteIconGrid.vue";
import { vTooltip } from "../../kit/tooltip";
import BookmarkFields from "../bookmark/BookmarkFields.vue";
import type { BookmarkJump, KeyOwner } from "../../extension/bookmarks";
import {
  NOTE_COLOR_PRESETS,
  NOTE_LOOKS,
  NOTE_STEP_MAX,
  NOTE_TONES,
  noteColor,
  noteColorCss,
  type NoteConfig,
  type NoteLook,
  type NoteTone,
} from "../../extension/note";

const props = defineProps<{
  config: NoteConfig;
  title: string;
  pinned: boolean;
  editing: boolean;
  /** For the Bookmark settings: everyone else's keys, the zoom now, and
   *  jump settings for a note that just became a bookmark. */
  getKeymap: () => KeyOwner[];
  getZoom: () => number;
  freshJump: () => BookmarkJump;
}>();

const emit = defineEmits<{
  (e: "update:config", next: NoteConfig): void;
  (e: "update:title", next: string): void;
  (e: "update:pinned", next: boolean): void;
  (e: "update:editing", next: boolean): void;
  (e: "recording", on: boolean): void;
}>();

const hasTitle = computed(() => props.title.trim() !== "" && props.title !== "WP Note");
const toneStyle = computed(() => (props.config.color ? { "--wp-note-tone": noteColorCss(props.config.color) } : undefined));
const isHex = computed(() => props.config.color.startsWith("#"));
const pickIcon = ref(false);

// The custom colour field starts from the colour on screen: a preset is a
// theme variable, not a hex in our data, so read it off the note.
const root = ref<HTMLElement | null>(null);
const shownHex = ref("");
function readShownHex(): void {
  const el = root.value;
  if (!el) return;
  const v = getComputedStyle(el).getPropertyValue("--wp-note-tone").trim();
  if (/^#[0-9a-f]{3,8}$/i.test(v)) shownHex.value = v;
}
onMounted(readShownHex);
watch(() => [props.config.color, props.editing], () => requestAnimationFrame(readShownHex));

function patch(part: Partial<NoteConfig>): void {
  emit("update:config", { ...props.config, ...part });
}
function onTitle(ev: Event): void {
  emit("update:title", (ev.target as HTMLInputElement).value);
}
function onBookmark(on: boolean): void {
  patch({ bookmark: on ? props.config.bookmark ?? props.freshJump() : null });
}
function onJump(part: Partial<BookmarkJump>): void {
  if (props.config.bookmark) patch({ bookmark: { ...props.config.bookmark, ...part } });
}
const bookmarkHint = computed(() => {
  const b = props.config.bookmark;
  return b ? `Also a bookmark${b.shortcut ? ` · ${b.shortcut}` : ""}` : "";
});

/** Any link in the text: a label shows a mark for it. */
const hasLink = computed(() => /\]\((?:https?:\/\/|docs:)/i.test(props.config.text));
</script>

<template>
  <div
    ref="root"
    class="wp-note"
    :class="[`wp-note--${config.tone}`, `wp-note--${config.look}`, { 'wp-note--editing': editing }]"
    :style="toneStyle"
    data-test="wp-note"
  >
    <!-- Read view. The panel lets clicks through to the canvas (drag,
         select, double-click to edit); only its buttons take them. -->
    <div v-if="!editing" class="wp-note__panel" data-test="note-panel">
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
          v-if="config.bookmark"
          v-tooltip="bookmarkHint"
          class="pi pi-bookmark-fill wp-note__bm"
          :aria-label="bookmarkHint"
          data-test="note-bookmark-mark"
        ></i>
        <WpIconButton
          class="wp-note__edit"
          icon="pi-pencil"
          label="Edit note"
          variant="bare"
          data-test="note-edit"
          @click="emit('update:editing', true)"
        />
      </div>
      <div v-if="config.look !== 'label'" class="wp-note__body">
        <NoteMarkdown v-if="config.text.trim()" :text="config.text" />
        <p v-else class="wp-note__empty">Double-click to write this note.</p>
      </div>
    </div>

    <!-- Keys typed here never reach ComfyUI's keybindings (Delete, Ctrl+Z,
         single-letter shortcuts…). Escape still closes an open picker:
         the kit Popover listens on window in the capture phase. -->
    <form
      v-else
      class="wp-note__form"
      data-test="note-form"
      @submit.prevent="emit('update:editing', false)"
      @keydown.stop
      @keyup.stop
      @keypress.stop
    >
      <div class="wp-note__row">
        <span class="wp-note__label">Tone</span>
        <WpSegmented
          :model-value="config.tone"
          :options="NOTE_TONES.map((t) => ({ value: t.id, label: t.label }))"
          size="sm"
          aria-label="Tone"
          test-prefix="note-tone"
          @update:model-value="(v: NoteTone) => patch({ tone: v })"
        />
        <WpNumber
          v-if="config.tone === 'step'"
          class="wp-note__stepnum"
          :model-value="config.step"
          :min="1"
          :max="NOTE_STEP_MAX"
          size="sm"
          aria-label="Step number"
          data-test="note-step-input"
          @update:model-value="(v: number | null) => patch({ step: v ?? 1 })"
        />
        <button
          v-if="config.tone === 'icon'"
          v-tooltip="`Icon: ${config.icon.replace(/-/g, ' ')}`"
          type="button"
          class="wp-note__iconpick"
          :aria-label="`Choose the icon (now ${config.icon.replace(/-/g, ' ')})`"
          :aria-expanded="pickIcon"
          data-test="note-icon-choose"
          @click="pickIcon = !pickIcon"
        >
          <i class="pi" :class="`pi-${config.icon}`" aria-hidden="true"></i>
          <i class="pi pi-chevron-down" aria-hidden="true"></i>
        </button>
      </div>
      <NoteIconGrid
        v-if="config.tone === 'icon' && pickIcon"
        :selected="config.icon"
        @pick="(n: string) => { patch({ icon: n }); pickIcon = false; }"
      />
      <div class="wp-note__row">
        <span class="wp-note__label">Look</span>
        <WpSegmented
          :model-value="config.look"
          :options="NOTE_LOOKS.map((l) => ({ value: l.id, label: l.label }))"
          size="sm"
          aria-label="Look"
          test-prefix="note-look"
          @update:model-value="(v: NoteLook) => patch({ look: v })"
        />
        <WpSwitch
          class="wp-note__pin"
          :model-value="pinned"
          size="sm"
          label="Pinned"
          data-test="note-pinned"
          @update:model-value="(v: boolean) => emit('update:pinned', v)"
        />
      </div>
      <div class="wp-note__row">
        <span class="wp-note__label">Colour</span>
        <div class="wp-note__swatches" role="radiogroup" aria-label="Colour">
          <button
            v-for="p in NOTE_COLOR_PRESETS"
            :key="p.id"
            v-tooltip="p.label"
            type="button"
            role="radio"
            class="wp-note__swatch"
            :style="{ background: p.css }"
            :aria-checked="config.color === p.id"
            :aria-label="p.label"
            :data-test="`note-color-${p.id || 'accent'}`"
            @click="patch({ color: p.id })"
          ></button>
        </div>
        <ColorField
          :class="{ 'wp-note__custom--on': isHex }"
          :model-value="isHex ? config.color : shownHex"
          size="sm"
          aria-label="Custom colour"
          data-test="note-color"
          @update:model-value="(v: string) => patch({ color: noteColor(v.slice(0, 7)) })"
        />
      </div>
      <label class="wp-note__field">
        <span class="wp-note__label">Title</span>
        <input class="wp-note__input" :value="title" data-test="note-title" @input="onTitle" />
      </label>
      <div class="wp-note__field">
        <span class="wp-note__label">Text <span class="wp-note__hint">{{ config.look === "label" ? "shows when you hover the label" : "Markdown, links and icons" }}</span></span>
        <NoteTextEditor
          :model-value="config.text"
          :hint="config.look === 'label' ? 'What the label explains…' : 'Write the note. The bar above adds links to the docs, icons and formatting.'"
          @update:model-value="(v: string) => patch({ text: v })"
        />
      </div>
      <div class="wp-note__row">
        <WpSwitch
          :model-value="!!config.bookmark"
          size="sm"
          label="Also a bookmark"
          data-test="note-bookmark"
          @update:model-value="onBookmark"
        />
        <span class="wp-note__hint">Jump here from the Bookmarks dock or a shortcut.</span>
      </div>
      <BookmarkFields
        v-if="config.bookmark"
        :value="config.bookmark"
        :get-keymap="getKeymap"
        :get-zoom="getZoom"
        @update="onJump"
        @recording="(on: boolean) => emit('recording', on)"
      />
      <div class="wp-note__actions">
        <WpButton variant="primary" size="sm" type="submit" data-test="note-done">Done</WpButton>
      </div>
    </form>
  </div>
</template>

<style scoped>
.wp-note {
  --wp-note-tone: var(--wp-accent);
  box-sizing: border-box;
  font-family: var(--wp-font-sans, Inter, sans-serif);
  font-size: 13px;
  line-height: 20px;
  color: var(--wp-text, inherit);
  /* Clicks go through to the canvas; buttons and the form take them back.
     No padding: the node is exactly the panel, so its selection outline hugs it. */
  pointer-events: none;
}

/* ── panel looks ─────────────────────────────────────────────────── */
.wp-note__panel {
  position: relative;
  border-radius: min(12px, var(--wp-radius-cap, 999px));
  padding: 12px 14px 12px 16px;
  box-shadow: var(--wp-shadow-md, 0 4px 14px rgb(0 0 0 / 0.35));
}
/* Card: solid panel, a tone edge on the left. */
.wp-note--card .wp-note__panel {
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  overflow: hidden;
}
.wp-note--card .wp-note__panel::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: var(--wp-note-tone);
}
/* Sticky: tinted with the tone, dashed tone outline inside. */
.wp-note--sticky .wp-note__panel {
  background: color-mix(in srgb, var(--wp-note-tone) 18%, var(--wp-bg-2));
  border: 1px solid color-mix(in srgb, var(--wp-note-tone) 55%, transparent);
  outline: 1px dashed color-mix(in srgb, var(--wp-note-tone) 45%, transparent);
  outline-offset: -6px;
}
/* Label: a small solid tag, title only. Sized to its text (the node follows
   it, see widgets/note.ts), up to a cap where the title ellipsizes. */
.wp-note--label .wp-note__panel {
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
.wp-note--label .wp-note__step,
.wp-note--label .wp-note__badge { background: rgb(255 255 255 / 0.22); color: inherit; }
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
.wp-note--label .wp-note__title { font-size: 14px; flex: 0 1 auto; }
.wp-note__marks { display: inline-flex; gap: 4px; flex: none; opacity: 0.8; }
.wp-note__marks .pi { font-size: 11px; }
.wp-note__edit {
  flex: none;
  margin-left: auto;
  pointer-events: auto;
  opacity: 0.35;
  transition: opacity 150ms;
}
.wp-note__edit:hover,
.wp-note__edit:focus-visible { opacity: 1; }
.wp-note--label .wp-note__edit { display: none; }
/* Also a bookmark: a small mark in the head (its tooltip names the key). */
.wp-note__bm {
  flex: none;
  margin-left: auto;
  font-size: 12px;
  color: var(--wp-note-tone);
  pointer-events: auto;
}
.wp-note__bm + .wp-note__edit { margin-left: 2px; }
.wp-note--label .wp-note__bm { color: inherit; opacity: 0.85; }

.wp-note__body { margin-top: 8px; color: var(--wp-text-muted, inherit); }
.wp-note__empty { margin: 0; color: var(--wp-text-dim); }
/* ── edit form ───────────────────────────────────────────────────── */
.wp-note__form {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: min(12px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border-strong, var(--wp-border));
  box-shadow: var(--wp-shadow-md, 0 4px 14px rgb(0 0 0 / 0.35));
}
.wp-note__row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wp-note__label { font-size: 11px; font-weight: 600; color: var(--wp-text-muted); min-width: 34px; }
.wp-note__hint { font-weight: 400; color: var(--wp-text-dim); margin-left: 4px; }
.wp-note__stepnum { width: 72px; }
.wp-note__pin { margin-left: auto; }
.wp-note__swatches { display: inline-flex; gap: 4px; flex-wrap: wrap; }
.wp-note__swatch {
  width: 18px;
  height: 18px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: var(--wp-radius-cap, 999px);
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.25);
  cursor: pointer;
}
.wp-note__swatch[aria-checked="true"] { border-color: var(--wp-text); }
/* The custom field is the pick when the colour is a hex, not a preset. */
.wp-note__custom--on { border-color: var(--wp-text); }
.wp-note__swatch:focus-visible { outline: 2px solid var(--wp-focus-ring, var(--wp-accent)); outline-offset: 1px; }
.wp-note__iconpick {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--wp-border-strong, var(--wp-border));
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-2);
  color: var(--wp-text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.wp-note__iconpick .pi-chevron-down { font-size: 9px; color: var(--wp-text-dim); }
.wp-note__field { display: flex; flex-direction: column; gap: 4px; }
.wp-note__input {
  box-sizing: border-box;
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--wp-border-strong, var(--wp-border));
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-3, transparent);
  color: var(--wp-text);
  font: inherit;
}
.wp-note__input:focus-visible { outline: 2px solid var(--wp-focus-ring, var(--wp-accent)); outline-offset: 1px; }
.wp-note__actions { display: flex; justify-content: flex-end; }
</style>

<style>
@layer wp-extension {
  /* Nodes 2.0 draws every node as a card (background, border, padding, a
     225 px floor, the source badge row and an outline 7 px outside). A note
     is its own panel, so drop all of that for nodes holding one. The rules
     are !important because they override the frontend's utility classes. */
  .lg-node:has(.wp-note) {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
  }
  .lg-node:has(.wp-note) > div { background: transparent !important; }
  .lg-node:has(.wp-note),
  .lg-node:has(.wp-note) > div,
  .lg-node:has(.wp-note) > div > div { min-width: 0 !important; min-height: 0 !important; }
  .lg-node:has(.wp-note) .lg-node-header { display: none !important; }
  .lg-node:has(.wp-note) .lg-node-content { padding: 0 !important; }
  .lg-node:has(.wp-note) .lg-node-widgets {
    grid-template-columns: minmax(0, 1fr) !important;
    padding: 0 !important;
    gap: 0 !important;
  }
  .lg-node:has(.wp-note) .lg-node-widget { gap: 0 !important; width: 100% !important; padding: 0 !important; }
  /* The widget row's reorder handle column. */
  .lg-node:has(.wp-note) .lg-node-widget > *:first-child:not(:last-child) { display: none !important; }
  .lg-node:has(.wp-note) [class*="component-node-background"] {
    padding: 0 !important;
    gap: 0 !important;
    background: transparent !important;
  }
  /* The footer row with the source badge. */
  .lg-node:has(.wp-note) [class*="component-node-background"] > div.text-muted-foreground,
  .lg-node:has(.wp-note) .bg-node-component-surface { display: none !important; }
  .lg-node:has(.wp-note) > div.absolute.border:not([data-testid]) { display: none !important; }
  /* The selection outline hugs the panel. */
  .lg-node:has(.wp-note) [data-testid="node-state-outline-overlay"],
  .lg-node:has(.wp-note) > div.absolute.outline-none { inset: -2px !important; }
  /* A label sizes itself: no resize grips. */
  .lg-node:has(.wp-note--label:not(.wp-note--editing)) [class*="resize"] { display: none !important; }
  /* The widget wrappers take pointer events and would eat the press that
     drags the node; the canvas handles it instead. The note's own buttons
     and its edit form take events back. */
  .lg-node:has(.wp-note) .lg-node-widgets,
  .lg-node:has(.wp-note) .lg-node-widgets * { pointer-events: none !important; }
  .lg-node:has(.wp-note) .wp-note__form,
  .lg-node:has(.wp-note) .wp-note__form *,
  .lg-node:has(.wp-note) .wp-note__edit,
  .lg-node:has(.wp-note) .wp-note-md a { pointer-events: auto !important; }

  .wp-note-md p { margin: 0 0 6px; }
  .wp-note-md p:last-child { margin-bottom: 0; }
  .wp-note-md strong { color: var(--wp-text); }
  .wp-note-md .wp-note-md__h { font-weight: 600; }
  .wp-note-md ul, .wp-note-md ol { margin: 0 0 6px; padding-left: 18px; }
  .wp-note-md .wp-note-md__code,
  .wp-note-md .wp-note-md__pre {
    font-family: var(--wp-font-mono, monospace);
    font-size: 12px;
    background: var(--wp-bg-3, transparent);
    border-radius: min(4px, var(--wp-radius-cap, 999px));
    padding: 0 4px;
  }
  .wp-note-md .wp-note-md__pre { padding: 6px 8px; margin: 0 0 6px; white-space: pre-wrap; }
  .wp-note-md blockquote { margin: 0 0 6px; padding-left: 8px; border-left: 2px solid var(--wp-border-strong); color: var(--wp-text-muted); }
  /* Links take the pointer; the rest of the note lets it through to the canvas. */
  .wp-note-md a { pointer-events: auto; cursor: pointer; }
  .wp-note-md .wp-note-md__link { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
  .wp-note-md .wp-note-md__link:hover { color: var(--wp-text); text-decoration-color: var(--wp-note-link, var(--wp-note-tone, var(--wp-accent))); }
  .wp-note-md .wp-note-md__link--color { color: var(--wp-note-link); text-decoration-color: var(--wp-note-link); }
  .wp-note-md .wp-note-md__plain { text-decoration: underline dotted; }
  .wp-note-md .wp-note-md__icon { font-size: 0.95em; vertical-align: -0.05em; }
  .wp-note-md .wp-note-md__btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 2px 0;
    padding: 3px 10px;
    border: 1px solid color-mix(in srgb, var(--wp-note-link, var(--wp-note-tone, var(--wp-accent))) 50%, transparent);
    border-radius: var(--wp-radius-cap, 999px);
    background: color-mix(in srgb, var(--wp-note-link, var(--wp-note-tone, var(--wp-accent))) 12%, transparent);
    font-size: 12px;
    line-height: 18px;
    color: var(--wp-text);
    text-decoration: none;
  }
  .wp-note-md .wp-note-md__btn .pi { font-size: 11px; color: var(--wp-note-link, var(--wp-note-tone, var(--wp-accent))); }
  .wp-note-md .wp-note-md__btn:hover { background: color-mix(in srgb, var(--wp-note-link, var(--wp-note-tone, var(--wp-accent))) 24%, transparent); }
  .wp-note-md a:focus-visible { outline: 2px solid var(--wp-focus-ring, var(--wp-accent)); outline-offset: 2px; }
}
</style>
