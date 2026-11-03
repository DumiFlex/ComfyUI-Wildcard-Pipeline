<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import Combobox from "@/kit/Combobox.vue";
import { textareaEl } from "@/manager/utils/kit-field-el";
import Textarea from "@/kit/Textarea.vue";
import Input from "@/kit/Input.vue";
import ColorField from "@/kit/ColorField.vue";
import Button from "@/kit/Button.vue";
import Toolbar from "@/kit/Toolbar.vue";
import WpSegmented from "@/kit/WpSegmented.vue";
import WpSelect from "@/kit/WpSelect.vue";
import CATALOG from "../../extension/docs-catalog.json";
import IconPicker from "@/kit/IconPicker.vue";
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
    <Toolbar class="wp-note-ed__bar" label="Formatting" size="sm">
      <Button variant="ghost" size="sm" class="wp-note-ed__fmt" hint="Bold (Ctrl+B)" aria-label="Bold" data-test="note-fmt-bold" @click="onWrap('**', 'bold')"><b>B</b></Button>
      <Button variant="ghost" size="sm" class="wp-note-ed__fmt" hint="Italic (Ctrl+I)" aria-label="Italic" data-test="note-fmt-italic" @click="onWrap('*', 'italic')"><i class="wp-note-ed__glyph-i">I</i></Button>
      <Button variant="ghost" size="sm" class="wp-note-ed__fmt" hint="Strikethrough" aria-label="Strikethrough" data-test="note-fmt-strike" @click="onWrap('~~', 'text')"><s>S</s></Button>
      <Button variant="ghost" size="sm" class="wp-note-ed__fmt" icon="pi-code" hint="Code or $variable" aria-label="Code" data-test="note-fmt-code" @click="onWrap('`', '$variable')" />
      <span class="wp-note-ed__sep" aria-hidden="true"></span>
      <Button variant="ghost" size="sm" class="wp-note-ed__fmt" icon="pi-list" hint="Bulleted list" aria-label="Bulleted list" data-test="note-fmt-list" @click="onPrefix('- ')" />
      <Button variant="ghost" size="sm" class="wp-note-ed__fmt" hint="Numbered list" aria-label="Numbered list" data-test="note-fmt-numbered" @click="onPrefix('1. ')"><span class="wp-note-ed__glyph">1.</span></Button>
      <Button variant="ghost" size="sm" class="wp-note-ed__fmt" icon="pi-comment" hint="Quote" aria-label="Quote" data-test="note-fmt-quote" @click="onPrefix('> ')" />
      <span class="wp-note-ed__sep" aria-hidden="true"></span>
      <Button
        variant="ghost"
        size="sm"
        class="wp-note-ed__fmt"
        icon="pi-link"
        hint="Link to a web page or the docs (Ctrl+K)"
        aria-label="Insert link"
        :pressed="panel === 'link'"
        data-test="note-fmt-link"
        @click="openPanel('link')"
      />
      <Button
        variant="ghost"
        size="sm"
        class="wp-note-ed__fmt"
        icon="pi-star"
        hint="Insert an icon"
        aria-label="Insert icon"
        :pressed="panel === 'icon'"
        data-test="note-fmt-icon"
        @click="openPanel('icon')"
      />
      <Button
        variant="ghost"
        size="sm"
        class="wp-note-ed__fmt wp-note-ed__mode"
        icon="pi-eye"
        :hint="mode === 'preview' ? 'Back to writing' : 'Preview the note'"
        aria-label="Preview"
        :pressed="mode === 'preview'"
        data-test="note-preview-toggle"
        @click="mode = mode === 'preview' ? 'write' : 'preview'; panel = ''"
      />
    </Toolbar>

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
      <Input v-else v-model="linkUrl" size="sm" aria-label="Web address" placeholder="https://…" data-test="note-link-url" @keydown.enter.prevent="insertLink" />
      <Input v-model="linkText" size="sm" aria-label="Link text" placeholder="Text (optional)" data-test="note-link-text" @keydown.enter.prevent="insertLink" />
      <div class="wp-note-ed__row">
        <WpSegmented
          :model-value="linkStyle"
          :options="[{ value: 'button', label: 'Button' }, { value: 'text', label: 'Text link' }]"
          size="sm"
          aria-label="Link style"
          test-prefix="note-link-style"
          @update:model-value="(v: 'text' | 'button') => (linkStyle = v)"
        />
        <Button
          v-if="linkStyle === 'button'"
          variant="secondary"
          size="sm"
          class="wp-note-ed__iconpick"
          :icon="linkIcon ? `pi-${linkIcon}` : undefined"
          hint="The button's icon"
          :aria-expanded="pickIcon"
          data-test="note-link-icon"
          @click="pickIcon = !pickIcon"
        >
          {{ linkIcon ? linkIcon.replace(/-/g, " ") : "No icon" }}
          <i class="pi pi-chevron-down wp-note-ed__chev" aria-hidden="true"></i>
        </Button>
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
      <IconPicker
        v-if="linkStyle === 'button' && pickIcon"
        class="wp-note-ed__icons"
        :model-value="linkIcon || null"
        all
        inline
        data-test="note-link-icons"
        @update:model-value="(v: string | null) => { linkIcon = v ?? ''; pickIcon = false; }"
      />
      <div class="wp-note-ed__actions">
        <Button size="sm" variant="ghost" data-test="note-link-cancel" @click="panel = ''">Cancel</Button>
        <Button size="sm" variant="primary" :disabled="!linkReady" data-test="note-link-insert" @click="insertLink">Insert link</Button>
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
      <IconPicker
        class="wp-note-ed__icons"
        :model-value="null"
        all
        inline
        :color="iconColor === 'none' || !iconColor ? undefined : iconColor"
        :allow-none="false"
        data-test="note-insert-icons"
        @update:model-value="(v: string | null) => insertIcon(v ?? '')"
      />
    </div>

    <Textarea
      v-show="mode === 'write'"
      :ref="(c) => (area = textareaEl(c))"
      mono
      :rows="5"
      :model-value="modelValue"
      :placeholder="hint"
      aria-label="Note text"
      data-test="note-text"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value); remember()"
      @keydown="onKey"
      @keyup="remember"
      @mouseup="remember"
      @select="remember"
      @blur="remember"

    />
    <div v-if="mode === 'preview'" class="wp-note-ed__preview" data-test="note-preview">
      <NoteMarkdown v-if="modelValue.trim()" :text="modelValue" />
      <p v-else class="wp-note-ed__hint">Nothing written yet.</p>
    </div>
  </div>
</template>

<style scoped>
/* The kit picker's list, sized for a node: as wide as the panel, a short
 * scroll area, cells packed by width instead of a fixed 8 columns. */
.wp-note-ed__icons :deep(.wp-iconpick__panel) { width: auto; max-height: 184px; }
.wp-note-ed__icons :deep(.wp-iconpick__grid) { grid-template-columns: repeat(auto-fill, minmax(28px, 1fr)); }
.wp-note-ed__icons :deep(.wp-iconpick__cell) { aspect-ratio: auto; height: 28px; }
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
/* The kit's ghost Buttons, held square at 24 px so the bar stays one row. */
.wp-note-ed__fmt.wp-btn { flex: none; width: 24px; min-width: 24px; padding: 0; font-weight: 600; }
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
.wp-note-ed__iconpick.wp-btn { font-size: 12px; text-transform: capitalize; }
.wp-note-ed__chev { font-size: 9px; color: var(--wp-text-dim); }
.wp-note-ed__preview {
  min-height: 60px;
  padding: 6px 8px;
  border: 1px dashed var(--wp-border-strong, var(--wp-border));
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  color: var(--wp-text-muted, var(--wp-text));
}
</style>
