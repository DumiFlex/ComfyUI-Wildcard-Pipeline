<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import ColorField from "../../kit/ColorField.vue";
import WpButton from "../../kit/WpButton.vue";
import WpIconButton from "../../kit/WpIconButton.vue";
import WpNumber from "../../kit/WpNumber.vue";
import WpSegmented from "../../kit/WpSegmented.vue";
import WpSelect from "../../kit/WpSelect.vue";
import WpSwitch from "../../kit/WpSwitch.vue";
import NoteMarkdown from "./note-markdown";
import {
  NOTE_DOC_PAGES,
  NOTE_LOOKS,
  NOTE_STEP_MAX,
  NOTE_TONES,
  docTitle,
  noteColor,
  type NoteConfig,
  type NoteLook,
  type NoteTone,
} from "../../extension/note";

const props = defineProps<{
  config: NoteConfig;
  title: string;
  pinned: boolean;
  editing: boolean;
}>();

const emit = defineEmits<{
  (e: "update:config", next: NoteConfig): void;
  (e: "update:title", next: string): void;
  (e: "update:pinned", next: boolean): void;
  (e: "update:editing", next: boolean): void;
  (e: "open-doc", id: string): void;
}>();

const TONE_ICON: Record<NoteTone, string> = {
  step: "",
  tip: "pi-lightbulb",
  info: "pi-info-circle",
  plain: "pi-bookmark",
};
const icon = computed(() => TONE_ICON[props.config.tone]);
const docOptions = computed(() => [
  { value: "", label: "None" },
  ...NOTE_DOC_PAGES.map((p) => ({ value: p.id, label: p.title })),
]);
const hasTitle = computed(() => props.title.trim() !== "" && props.title !== "WP Note");
const toneStyle = computed(() => (props.config.color ? { "--wp-note-tone": props.config.color } : undefined));

// The colour the picker starts from when the note has none of its own: the
// tone's, read off the theme (it is a CSS variable, not a hex in our data).
const root = ref<HTMLElement | null>(null);
const toneHex = ref("#6366f1");
function readToneHex(): void {
  const el = root.value;
  if (!el || props.config.color) return;
  const v = getComputedStyle(el).getPropertyValue("--wp-note-tone").trim();
  if (/^#[0-9a-f]{3,8}$/i.test(v)) toneHex.value = v;
}
onMounted(readToneHex);
watch(() => [props.config.tone, props.editing], () => requestAnimationFrame(readToneHex));

function patch(part: Partial<NoteConfig>): void {
  emit("update:config", { ...props.config, ...part });
}
function onTitle(ev: Event): void {
  emit("update:title", (ev.target as HTMLInputElement).value);
}
function onText(ev: Event): void {
  patch({ text: (ev.target as HTMLTextAreaElement).value });
}
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
        <span v-else class="wp-note__badge" aria-hidden="true"><i class="pi" :class="icon"></i></span>
        <span v-if="hasTitle || config.look === 'label'" class="wp-note__title" data-test="note-title-text">{{ title }}</span>
        <!-- A label keeps its text and docs link for the hover card; these
             marks say there is something to see. -->
        <span v-if="config.look === 'label' && (config.text.trim() || config.doc)" class="wp-note__marks" aria-hidden="true">
          <i v-if="config.text.trim()" class="pi pi-align-left" data-test="note-has-text"></i>
          <i v-if="config.doc" class="pi pi-book" data-test="note-has-doc"></i>
        </span>
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
        <button
          v-if="config.doc"
          type="button"
          class="wp-note__doc"
          data-test="note-doc"
          @click="emit('open-doc', config.doc)"
        ><i class="pi pi-book" aria-hidden="true"></i>{{ docTitle(config.doc) }} docs<i class="pi pi-arrow-up-right" aria-hidden="true"></i></button>
      </div>
    </div>

    <form v-else class="wp-note__form" data-test="note-form" @submit.prevent="emit('update:editing', false)">
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
      </div>
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
      </div>
      <div class="wp-note__row">
        <span class="wp-note__label">Colour</span>
        <ColorField
          :model-value="config.color || toneHex"
          size="sm"
          aria-label="Note colour"
          data-test="note-color"
          @update:model-value="(v: string) => patch({ color: noteColor(v) })"
        />
        <WpIconButton
          v-if="config.color"
          icon="pi-undo"
          label="Use the tone's colour"
          data-test="note-color-reset"
          @click="patch({ color: '' })"
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
      <label class="wp-note__field">
        <span class="wp-note__label">Title</span>
        <input class="wp-note__input" :value="title" data-test="note-title" @input="onTitle" />
      </label>
      <label class="wp-note__field">
        <span class="wp-note__label">Text <span class="wp-note__hint">{{ config.look === "label" ? "shows when you hover the label" : "Markdown: **bold**, lists, `$var`" }}</span></span>
        <textarea
          class="wp-note__input wp-note__textarea"
          rows="4"
          :value="config.text"
          data-test="note-text"
          @input="onText"
        ></textarea>
      </label>
      <label class="wp-note__field">
        <span class="wp-note__label">Docs link</span>
        <WpSelect
          :model-value="config.doc"
          :options="docOptions"
          aria-label="Docs link"
          data-test="note-doc-select"
          @update:model-value="(v: string) => patch({ doc: v })"
        />
      </label>
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
.wp-note--tip { --wp-note-tone: var(--wp-success); }
.wp-note--info { --wp-note-tone: var(--wp-info); }
.wp-note--plain { --wp-note-tone: var(--wp-text-dim); }

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
.wp-note--label.wp-note--plain .wp-note__panel {
  background: var(--wp-bg-3);
  color: var(--wp-text);
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

.wp-note__body { margin-top: 8px; color: var(--wp-text-muted, inherit); }
.wp-note__empty { margin: 0; color: var(--wp-text-dim); }
.wp-note__doc {
  pointer-events: auto;
  margin-top: 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border: 1px solid color-mix(in srgb, var(--wp-note-tone) 50%, transparent);
  border-radius: var(--wp-radius-cap, 999px);
  background: color-mix(in srgb, var(--wp-note-tone) 12%, transparent);
  font: inherit;
  font-size: 12px;
  color: var(--wp-text);
  cursor: pointer;
}
.wp-note__doc .pi { font-size: 11px; color: var(--wp-note-tone); }
.wp-note__doc:hover { background: color-mix(in srgb, var(--wp-note-tone) 24%, transparent); }
.wp-note__doc:focus-visible { outline: 2px solid var(--wp-focus-ring, var(--wp-accent)); outline-offset: 2px; }

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
.wp-note__textarea { font-family: var(--wp-font-mono, monospace); font-size: 12px; line-height: 18px; resize: vertical; }
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
  .lg-node:has(.wp-note) .wp-note__doc { pointer-events: auto !important; }

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
  .wp-note-md .wp-note-md__link { text-decoration: underline; }
}
</style>
