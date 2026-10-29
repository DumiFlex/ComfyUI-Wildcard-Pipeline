<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import Combobox from "../../kit/Combobox.vue";
import ColorField from "../../kit/ColorField.vue";
import WpButton from "../../kit/WpButton.vue";
import WpSegmented from "../../kit/WpSegmented.vue";
import WpSelect from "../../kit/WpSelect.vue";
import { vTooltip } from "../../kit/tooltip";
import CATALOG from "../../extension/docs-catalog.json";
import NoteIconGrid from "./NoteIconGrid.vue";
import NoteMarkdown from "./note-markdown";
import {
  docsTarget, iconMarkdown, insert, linkMarkdown, prefixLines, wrap, type Edit,
} from "./note-format";

/**
 * The note's text: Markdown in a textarea with a formatting bar over it.
 * The bar writes the syntax for you (bold, lists, links, icons); Preview
 * shows the note as it will read. The source stays plain Markdown.
 */
const props = defineProps<{ modelValue: string; hint: string }>();
const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();

const area = ref<HTMLTextAreaElement | null>(null);
const mode = ref<"write" | "preview">("write");
const panel = ref<"" | "link" | "icon">("");
// Where the text goes: the textarea's last selection. Kept up to date
// while a panel is open (focus moves into the panel, and the user may click
// back into the text to pick another spot before inserting).
let sel = { start: 0, end: 0 };
function remember(): void {
  const el = area.value;
  if (el) sel = { start: el.selectionStart, end: el.selectionEnd };
}

function apply(e: Edit): void {
  // The buttons write into the textarea, so they bring it back from Preview.
  mode.value = "write";
  emit("update:modelValue", e.value);
  void nextTick(() => {
    const el = area.value;
    if (!el) return;
    el.focus();
    el.setSelectionRange(e.start, e.end);
  });
}
function current(): { value: string; start: number; end: number } {
  const el = area.value;
  return { value: props.modelValue, start: el?.selectionStart ?? props.modelValue.length, end: el?.selectionEnd ?? props.modelValue.length };
}
function onWrap(mark: string, placeholder: string): void {
  const c = current();
  apply(wrap(c.value, c.start, c.end, mark, placeholder));
}
function onPrefix(prefix: "- " | "1. " | "> "): void {
  const c = current();
  apply(prefixLines(c.value, c.start, c.end, prefix));
}
function openPanel(p: "link" | "icon"): void {
  if (panel.value === p) { panel.value = ""; return; }
  mode.value = "write";
  const c = current();
  sel = { start: c.start, end: c.end };
  if (p === "link") resetLink(c.value.slice(c.start, c.end));
  panel.value = p;
}
function insertText(text: string): void {
  panel.value = "";
  apply(insert(props.modelValue, sel.start, sel.end, text));
}
function onKey(ev: KeyboardEvent): void {
  if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
  const k = ev.key.toLowerCase();
  if (k === "b") { ev.preventDefault(); onWrap("**", "bold"); }
  else if (k === "i") { ev.preventDefault(); onWrap("*", "italic"); }
  else if (k === "k") { ev.preventDefault(); openPanel("link"); }
}

// ── link panel ─────────────────────────────────────────────────────────
const linkText = ref("");
const linkKind = ref<"web" | "docs">("docs");
const linkUrl = ref("https://");
const linkPage = ref<string | null>(null);
const linkSection = ref("");
const linkStyle = ref<"text" | "button">("button");
const linkIcon = ref("book");
// "none": the note's tone colour.
const linkColor = ref("none");
const pickIcon = ref(false);

const pageOptions = CATALOG.map((p) => ({ value: p.id, label: p.title, hint: p.group }));
const page = computed(() => CATALOG.find((p) => p.id === linkPage.value) ?? null);
const sectionOptions = computed(() => [
  { value: "", label: "Whole page" },
  ...(page.value?.sections ?? []).map((s) => ({ value: s.id, label: s.title })),
]);
const linkReady = computed(() => (linkKind.value === "docs"
  ? !!page.value
  : /^https?:\/\/\S+\.\S+/i.test(linkUrl.value.trim())));

function resetLink(selected: string): void {
  linkText.value = selected.trim();
  linkSection.value = "";
  pickIcon.value = false;
  if (/^https?:\/\//i.test(linkText.value)) {
    linkKind.value = "web";
    linkUrl.value = linkText.value;
  }
}
function onPage(v: string | string[] | null): void {
  linkPage.value = typeof v === "string" ? v : null;
  linkSection.value = "";
}
function insertLink(): void {
  if (!linkReady.value) return;
  const docs = linkKind.value === "docs";
  const target = docs ? docsTarget(linkPage.value ?? "", linkSection.value) : linkUrl.value.trim();
  const section = page.value?.sections.find((s) => s.id === linkSection.value);
  const fallback = docs ? (section ? `${page.value?.title}: ${section.title}` : `${page.value?.title ?? ""} docs`) : "";
  const button = linkStyle.value === "button";
  const color = linkColor.value === "none" ? "" : linkColor.value.slice(0, 7);
  insertText(linkMarkdown(linkText.value || fallback, target, { button, icon: button ? linkIcon.value : "", color }));
}

// ── icon panel ─────────────────────────────────────────────────────────
const iconColor = ref("none");
function insertIcon(name: string): void {
  if (!name) return;
  insertText(iconMarkdown(name, iconColor.value === "none" ? "" : iconColor.value));
}
</script>

<template>
  <div class="wp-note-ed" data-test="note-text-editor">
    <div class="wp-note-ed__bar" role="toolbar" aria-label="Formatting">
      <button v-tooltip="'Bold (Ctrl+B)'" type="button" class="wp-note-ed__btn" aria-label="Bold" data-test="note-fmt-bold" @click="onWrap('**', 'bold')"><b>B</b></button>
      <button v-tooltip="'Italic (Ctrl+I)'" type="button" class="wp-note-ed__btn" aria-label="Italic" data-test="note-fmt-italic" @click="onWrap('*', 'italic')"><i class="wp-note-ed__glyph-i">I</i></button>
      <button v-tooltip="'Strikethrough'" type="button" class="wp-note-ed__btn" aria-label="Strikethrough" data-test="note-fmt-strike" @click="onWrap('~~', 'text')"><s>S</s></button>
      <button v-tooltip="'Code or $variable'" type="button" class="wp-note-ed__btn" aria-label="Code" data-test="note-fmt-code" @click="onWrap('`', '$variable')"><i class="pi pi-code" aria-hidden="true"></i></button>
      <span class="wp-note-ed__sep" aria-hidden="true"></span>
      <button v-tooltip="'Bulleted list'" type="button" class="wp-note-ed__btn" aria-label="Bulleted list" data-test="note-fmt-list" @click="onPrefix('- ')"><i class="pi pi-list" aria-hidden="true"></i></button>
      <button v-tooltip="'Numbered list'" type="button" class="wp-note-ed__btn" aria-label="Numbered list" data-test="note-fmt-numbered" @click="onPrefix('1. ')"><span class="wp-note-ed__glyph">1.</span></button>
      <button v-tooltip="'Quote'" type="button" class="wp-note-ed__btn" aria-label="Quote" data-test="note-fmt-quote" @click="onPrefix('> ')"><i class="pi pi-comment" aria-hidden="true"></i></button>
      <span class="wp-note-ed__sep" aria-hidden="true"></span>
      <button
        v-tooltip="'Link to a web page or the docs (Ctrl+K)'"
        type="button"
        class="wp-note-ed__btn"
        aria-label="Insert link"
        :aria-pressed="panel === 'link'"
        data-test="note-fmt-link"
        @click="openPanel('link')"
      ><i class="pi pi-link" aria-hidden="true"></i></button>
      <button
        v-tooltip="'Insert an icon'"
        type="button"
        class="wp-note-ed__btn"
        aria-label="Insert icon"
        :aria-pressed="panel === 'icon'"
        data-test="note-fmt-icon"
        @click="openPanel('icon')"
      ><i class="pi pi-star" aria-hidden="true"></i></button>
      <button
        v-tooltip="mode === 'preview' ? 'Back to writing' : 'Preview the note'"
        type="button"
        class="wp-note-ed__btn wp-note-ed__mode"
        aria-label="Preview"
        :aria-pressed="mode === 'preview'"
        data-test="note-preview-toggle"
        @click="mode = mode === 'preview' ? 'write' : 'preview'; panel = ''"
      ><i class="pi pi-eye" aria-hidden="true"></i></button>
    </div>

    <!-- Insert link -->
    <div v-if="panel === 'link'" class="wp-note-ed__panel" data-test="note-link-panel">
      <WpSegmented
        :model-value="linkKind"
        :options="[{ value: 'docs', label: 'Docs page' }, { value: 'web', label: 'Web address' }]"
        size="sm"
        aria-label="Link to"
        test-prefix="note-link-kind"
        @update:model-value="(v: 'web' | 'docs') => (linkKind = v)"
      />
      <template v-if="linkKind === 'docs'">
        <Combobox
          :model-value="linkPage"
          :options="pageOptions"
          size="sm"
          placeholder="Type to find a docs page…"
          aria-label="Docs page"
          :limit="80"
          data-test="note-link-page"
          @update:model-value="onPage"
        />
        <WpSelect
          v-if="page && page.sections.length"
          :model-value="linkSection"
          :options="sectionOptions"
          aria-label="Section"
          data-test="note-link-section"
          @update:model-value="(v: string) => (linkSection = v)"
        />
      </template>
      <input v-else v-model="linkUrl" class="wp-note-ed__input" aria-label="Web address" placeholder="https://…" data-test="note-link-url" @keydown.enter.prevent="insertLink" />
      <input v-model="linkText" class="wp-note-ed__input" aria-label="Link text" placeholder="Text (optional)" data-test="note-link-text" @keydown.enter.prevent="insertLink" />
      <div class="wp-note-ed__row">
        <WpSegmented
          :model-value="linkStyle"
          :options="[{ value: 'button', label: 'Button' }, { value: 'text', label: 'Text link' }]"
          size="sm"
          aria-label="Link style"
          test-prefix="note-link-style"
          @update:model-value="(v: 'text' | 'button') => (linkStyle = v)"
        />
        <button
          v-if="linkStyle === 'button'"
          v-tooltip="'The button\'s icon'"
          type="button"
          class="wp-note-ed__iconpick"
          :aria-expanded="pickIcon"
          data-test="note-link-icon"
          @click="pickIcon = !pickIcon"
        >
          <i v-if="linkIcon" class="pi" :class="`pi-${linkIcon}`" aria-hidden="true"></i>
          <span>{{ linkIcon ? linkIcon.replace(/-/g, " ") : "No icon" }}</span>
          <i class="pi pi-chevron-down" aria-hidden="true"></i>
        </button>
      </div>
      <div class="wp-note-ed__row">
        <span class="wp-note-ed__label">Colour</span>
        <ColorField
          :model-value="linkColor"
          allow-none
          size="sm"
          aria-label="Link colour"
          data-test="note-link-color"
          @update:model-value="(v: string) => (linkColor = v)"
        />
        <span class="wp-note-ed__hint">None follows the note.</span>
      </div>
      <NoteIconGrid
        v-if="linkStyle === 'button' && pickIcon"
        :selected="linkIcon"
        allow-none
        @pick="(n: string) => { linkIcon = n; pickIcon = false; }"
      />
      <div class="wp-note-ed__actions">
        <WpButton size="sm" variant="ghost" data-test="note-link-cancel" @click="panel = ''">Cancel</WpButton>
        <WpButton size="sm" variant="primary" :disabled="!linkReady" data-test="note-link-insert" @click="insertLink">Insert link</WpButton>
      </div>
    </div>

    <!-- Insert icon -->
    <div v-if="panel === 'icon'" class="wp-note-ed__panel" data-test="note-icon-panel">
      <div class="wp-note-ed__row">
        <span class="wp-note-ed__label">Colour</span>
        <ColorField
          :model-value="iconColor"
          allow-none
          size="sm"
          aria-label="Icon colour"
          data-test="note-icon-color"
          @update:model-value="(v: string) => (iconColor = v)"
        />
        <span class="wp-note-ed__hint">None follows the text.</span>
      </div>
      <NoteIconGrid :color="iconColor === 'none' ? '' : iconColor" @pick="insertIcon" />
    </div>

    <textarea
      v-show="mode === 'write'"
      ref="area"
      class="wp-note-ed__text"
      rows="5"
      :value="modelValue"
      :placeholder="hint"
      aria-label="Note text"
      data-test="note-text"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value); remember()"
      @keydown="onKey"
      @keyup="remember"
      @mouseup="remember"
      @select="remember"
      @blur="remember"
    ></textarea>
    <div v-if="mode === 'preview'" class="wp-note-ed__preview" data-test="note-preview">
      <NoteMarkdown v-if="modelValue.trim()" :text="modelValue" />
      <p v-else class="wp-note-ed__hint">Nothing written yet.</p>
    </div>
  </div>
</template>

<style scoped>
.wp-note-ed { display: flex; flex-direction: column; gap: 6px; }
/* One row at the editor's narrowest (340 px): 24 px buttons, the preview
   toggle pushed to the end. */
.wp-note-ed__bar {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 1px;
  padding: 3px;
  border: 1px solid var(--wp-border);
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-3, transparent);
}
.wp-note-ed__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: min(5px, var(--wp-radius-cap, 999px));
  background: none;
  color: var(--wp-text-muted, var(--wp-text));
  font: 600 13px/1 var(--wp-font-sans, sans-serif);
  cursor: pointer;
}
.wp-note-ed__btn .pi { font-size: 13px; }
.wp-note-ed__btn:hover { background: var(--wp-bg-4, var(--wp-bg-2)); color: var(--wp-text); }
.wp-note-ed__btn[aria-pressed="true"] { border-color: var(--wp-accent); background: color-mix(in srgb, var(--wp-accent) 18%, transparent); color: var(--wp-text); }
.wp-note-ed__btn:focus-visible { outline: 2px solid var(--wp-focus-ring, var(--wp-accent)); outline-offset: 1px; }
.wp-note-ed__glyph { font: 600 11px/1 var(--wp-font-mono, monospace); }
.wp-note-ed__glyph-i { font-family: Georgia, serif; font-style: italic; }
.wp-note-ed__sep { flex: none; width: 1px; height: 16px; margin: 0 2px; background: var(--wp-border-strong, var(--wp-border)); }
.wp-note-ed__mode { margin-left: auto; }
.wp-note-ed__panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--wp-border-strong, var(--wp-border));
  border-radius: min(8px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-1, var(--wp-bg-2));
}
.wp-note-ed__row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wp-note-ed__label { font-size: 11px; font-weight: 600; color: var(--wp-text-muted); }
.wp-note-ed__hint { font-size: 11px; color: var(--wp-text-dim); margin: 0; }
.wp-note-ed__actions { display: flex; justify-content: flex-end; gap: 6px; }
.wp-note-ed__input,
.wp-note-ed__text {
  box-sizing: border-box;
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--wp-border-strong, var(--wp-border));
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-3, transparent);
  color: var(--wp-text);
  font: inherit;
}
.wp-note-ed__text { font-family: var(--wp-font-mono, monospace); font-size: 12px; line-height: 18px; resize: vertical; }
.wp-note-ed__input:focus-visible,
.wp-note-ed__text:focus-visible { outline: 2px solid var(--wp-focus-ring, var(--wp-accent)); outline-offset: 1px; }
.wp-note-ed__iconpick {
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
  text-transform: capitalize;
  cursor: pointer;
}
.wp-note-ed__iconpick .pi-chevron-down { font-size: 9px; color: var(--wp-text-dim); }
.wp-note-ed__preview {
  min-height: 60px;
  padding: 6px 8px;
  border: 1px dashed var(--wp-border-strong, var(--wp-border));
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  color: var(--wp-text-muted, var(--wp-text));
}
</style>
