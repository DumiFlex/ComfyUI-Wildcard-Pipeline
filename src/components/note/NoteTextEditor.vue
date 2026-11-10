<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from "vue";
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
import Slider from "@/kit/Slider.vue";
import {
  assetImageTarget, assetUrl, communityTarget, docsTarget, findImages, iconMarkdown, imageMarkdown, insert, libraryTarget,
  linkMarkdown, NOTE_ASSETS, prefixLines, removeImage, savedImageTarget, setImageWidth, wrap, type Edit, type ImageRef,
} from "./note-format";
import { ACCEPTED_TYPES, capProblem, dataUrlBytes, encodePicture, newImageId, pictureFile, PictureError } from "./note-images";
import { pushToast } from "../shared/toast-store";
import type { NoteImage } from "../../extension/note";
import { NOTE_CONTEXTS } from "./note-actions";
import { TextHistory, historyKey, kindOf, type ChangeKind, type Snapshot } from "./note-history";

/**
 * The note's text: Markdown in a textarea with a formatting bar over it.
 * The bar writes the syntax for you (bold, lists, links, icons); Preview
 * shows the note as it will read. The source stays plain Markdown.
 */
const props = withDefaults(defineProps<{
  modelValue: string;
  hint: string;
  /** The note's saved pictures (NoteConfig.images). */
  images?: Record<string, NoteImage>;
}>(), { images: () => ({}) });
const emit = defineEmits<{
  (e: "update:modelValue", v: string): void;
  /** A new picture: its data and the text naming it, in one change. */
  (e: "picture", v: { text: string; images: Record<string, NoteImage> }): void;
}>();

const area = ref<HTMLTextAreaElement | null>(null);
const mode = ref<"write" | "preview">("write");
const panel = ref<"" | "link" | "icon" | "image">("");
// Where the text goes: the textarea's last selection. Kept up to date
// while a panel is open (focus moves into the panel, and the user may click
// back into the text to pick another spot before inserting).
let sel = { start: 0, end: 0 };
function remember(): void {
  const el = area.value;
  if (el) sel = { start: el.selectionStart, end: el.selectionEnd };
}

// ── undo / redo ────────────────────────────────────────────────────────
// Our own stack: the toolbar sets the value from script, which the
// browser's undo never sees (note-hist.ts).
const hist = new TextHistory();
// Bumped on every history change so the buttons re-read it.
const steps = ref(0);
const canUndo = computed(() => steps.value >= 0 && hist.canUndo);
const canRedo = computed(() => steps.value >= 0 && hist.canRedo);
// The value we last sent up. A different one coming down was changed
// somewhere else (a loaded workflow), so the steps no longer fit it.
let sent = props.modelValue;
watch(() => props.modelValue, (v) => {
  if (v === sent) return;
  sent = v;
  hist.clear();
  steps.value++;
});
function send(value: string): void {
  sent = value;
  emit("update:modelValue", value);
}
/** The text now: the value last sent and the textarea's selection. */
function current(): Snapshot {
  const el = area.value;
  return { value: sent, start: el?.selectionStart ?? sent.length, end: el?.selectionEnd ?? sent.length };
}
/** Puts the text back in Write with this selection. */
function select(start: number, end: number): void {
  mode.value = "write";
  void nextTick(() => {
    const el = area.value;
    if (!el) return;
    el.focus();
    el.setSelectionRange(start, end);
    remember();
  });
}
function step(dir: "undo" | "redo"): void {
  const s = dir === "undo" ? hist.undo(current()) : hist.redo(current());
  steps.value++;
  if (!s) return;
  send(s.value);
  select(s.start, s.end);
}
function undo(): void { step("undo"); }
function redo(): void { step("redo"); }
// Typing: beforeinput sees the text and selection just before the change.
let pending: { kind: ChangeKind; before: Snapshot } | null = null;
function onBeforeInput(ev: InputEvent): void {
  if (ev.inputType === "historyUndo" || ev.inputType === "historyRedo") {
    // The right-click menu's Undo / Redo.
    ev.preventDefault();
    step(ev.inputType === "historyUndo" ? "undo" : "redo");
    return;
  }
  pending = { kind: kindOf(ev.inputType), before: current() };
}
function onInput(ev: Event): void {
  const value = (ev.target as HTMLTextAreaElement).value;
  hist.record(pending?.before ?? { value: sent, start: sel.start, end: sel.end }, pending?.kind ?? "edit");
  pending = null;
  steps.value++;
  send(value);
  remember();
}

/** A toolbar edit: one undo step of its own. `images`: a picture came
 *  with it, sent together with the text. `stay`: keep the view (Preview). */
function apply(e: Edit, before: Snapshot = current(), images?: Record<string, NoteImage>, stay = false): void {
  hist.record(before, "edit");
  steps.value++;
  if (images) {
    sent = e.value;
    emit("picture", { text: e.value, images });
  } else {
    send(e.value);
  }
  // The buttons write into the textarea, so they bring it back from Preview.
  if (!stay) select(e.start, e.end);
}
function onWrap(mark: string, placeholder: string): void {
  const c = current();
  apply(wrap(c.value, c.start, c.end, mark, placeholder));
}
function onPrefix(prefix: "- " | "1. " | "> "): void {
  const c = current();
  apply(prefixLines(c.value, c.start, c.end, prefix));
}
function openPanel(p: "link" | "icon" | "image"): void {
  if (panel.value === p) { panel.value = ""; return; }
  mode.value = "write";
  const c = current();
  sel = { start: c.start, end: c.end };
  if (p === "link") resetLink(c.value.slice(c.start, c.end));
  panel.value = p;
}
function insertText(text: string): void {
  panel.value = "";
  apply(insert(sent, sel.start, sel.end, text), { value: sent, start: sel.start, end: sel.end });
}
// Keys that move the caret end a typing run.
const MOVES = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);
function onKey(ev: KeyboardEvent): void {
  if (MOVES.has(ev.key)) hist.breakRun();
  const h = historyKey(ev);
  if (h) {
    ev.preventDefault();
    if (h === "undo") undo(); else redo();
    return;
  }
  if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
  const k = ev.key.toLowerCase();
  if (k === "b") { ev.preventDefault(); onWrap("**", "bold"); }
  else if (k === "i") { ev.preventDefault(); onWrap("*", "italic"); }
  else if (k === "k") { ev.preventDefault(); openPanel("link"); }
}

// ── link panel ─────────────────────────────────────────────────────────
const linkText = ref("");
type LinkKind = "web" | "docs" | "library" | "community";
const linkKind = ref<LinkKind>("docs");
const KIND_OPTIONS: Array<{ value: LinkKind; label: string }> = [
  { value: "docs", label: "Docs" },
  { value: "web", label: "Web" },
  { value: "library", label: "Library" },
  { value: "community", label: "Community" },
];
// "Library": the whole workflow, or one WP Context on the canvas.
const contexts = inject(NOTE_CONTEXTS, ref([]));
const libraryScope = ref<"workflow" | "context">("workflow");
const libraryNode = ref<string | null>(null);
const contextOptions = computed(() => contexts.value.map((c) => ({ value: c.value, label: c.label })));
const pack = ref("");
const packTarget = computed(() => communityTarget(pack.value));
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
const linkReady = computed(() => {
  switch (linkKind.value) {
    case "docs": return !!page.value;
    case "library": return libraryScope.value === "workflow" || !!libraryNode.value;
    case "community": return !!packTarget.value;
    default: return /^https?:\/\/\S+\.\S+/i.test(linkUrl.value.trim());
  }
});
/** Each kind's own default icon and text, used when the user leaves them. */
function onKind(v: LinkKind): void {
  const was = linkKind.value;
  linkKind.value = v;
  const iconFor = (k: LinkKind): string => (k === "library" ? "download" : k === "community" ? "globe" : "book");
  if (linkIcon.value === iconFor(was)) linkIcon.value = iconFor(v);
  // An action runs on a press, so it is always a button.
  if (v === "library") linkStyle.value = "button";
}

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
function linkTarget(): { target: string; fallback: string } {
  switch (linkKind.value) {
    case "docs": {
      const section = page.value?.sections.find((s) => s.id === linkSection.value);
      return {
        target: docsTarget(linkPage.value ?? "", linkSection.value),
        fallback: section ? `${page.value?.title}: ${section.title}` : `${page.value?.title ?? ""} docs`,
      };
    }
    case "library": {
      const one = libraryScope.value === "context" ? libraryNode.value ?? "" : "";
      return { target: libraryTarget(one), fallback: one ? "Add these to my library" : "Add this workflow's lists to my library" };
    }
    case "community":
      return { target: packTarget.value ?? "", fallback: "Get the pack" };
    default:
      return { target: linkUrl.value.trim(), fallback: "" };
  }
}
function insertLink(): void {
  if (!linkReady.value) return;
  const { target, fallback } = linkTarget();
  const button = linkStyle.value === "button" || linkKind.value === "library";
  const color = linkColor.value === "none" ? "" : linkColor.value.slice(0, 7);
  insertText(linkMarkdown(linkText.value || fallback, target, { button, icon: button ? linkIcon.value : "", color }));
}

// ── pictures ───────────────────────────────────────────────────────────
const pictureAlt = ref("");
const fileInput = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const shown = computed(() => findImages(props.modelValue));
function refSrc(r: ImageRef): string | null {
  if (r.target.kind === "saved") return props.images[r.target.id]?.src ?? null;
  if (r.target.kind === "asset") return assetUrl(r.target.id, typeof window === "undefined" ? "" : window.location.origin);
  return null;
}
/** Puts a picture's Markdown at the caret, on a line of its own. */
function pictureEdit(markdown: string): Edit {
  const at = sel.start;
  const before = sent.slice(0, at);
  const after = sent.slice(sel.end);
  const lead = before && !before.endsWith("\n") ? "\n\n" : before && !before.endsWith("\n\n") ? "\n" : "";
  const tail = after && !after.startsWith("\n") ? "\n\n" : "";
  return insert(sent, at, sel.end, `${lead}${markdown}${tail}`);
}
async function addFile(file: File | null): Promise<void> {
  if (!file || busy.value) return;
  const early = capProblem(props.images, 0);
  if (early) { pushToast(early, { severity: "warning" }); return; }
  busy.value = true;
  const before = { value: sent, start: sel.start, end: sel.end };
  try {
    const pic = await encodePicture(file);
    const problem = capProblem(props.images, dataUrlBytes(pic.src));
    if (problem) { pushToast(problem, { severity: "warning" }); return; }
    const id = newImageId(props.images);
    const alt = pictureAlt.value.trim() || file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim() || "Picture";
    panel.value = "";
    pictureAlt.value = "";
    apply(pictureEdit(imageMarkdown(alt, savedImageTarget(id))), before, { ...props.images, [id]: pic });
  } catch (err) {
    pushToast(err instanceof PictureError ? err.message : "That picture couldn't be added.", { severity: "warning" });
  } finally {
    busy.value = false;
  }
}
function onFile(ev: Event): void {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  input.value = "";
  void addFile(file);
}
function insertAsset(id: string, label: string): void {
  const before = { value: sent, start: sel.start, end: sel.end };
  panel.value = "";
  const alt = pictureAlt.value.trim() || label;
  pictureAlt.value = "";
  apply(pictureEdit(imageMarkdown(alt, assetImageTarget(id))), before);
}
// Paste or drop a picture straight into the text.
function onPaste(ev: ClipboardEvent): void {
  const file = pictureFile(ev.clipboardData);
  if (!file) return;
  // Ours: ComfyUI would also paste it onto the canvas as a Load Image node.
  ev.preventDefault();
  ev.stopPropagation();
  remember();
  void addFile(file);
}
function onDragOver(ev: DragEvent): void {
  if (Array.from(ev.dataTransfer?.items ?? []).some((i) => i.kind === "file")) {
    ev.preventDefault();
    // ComfyUI would load a dropped picture as a workflow / Load Image node.
    ev.stopPropagation();
  }
}
function onDrop(ev: DragEvent): void {
  const file = pictureFile(ev.dataTransfer);
  if (!file) return;
  ev.preventDefault();
  ev.stopPropagation();
  remember();
  void addFile(file);
}
// One drag of a width slider is one undo step.
let widthRun = -1;
function onWidth(index: number, w: number | null): void {
  const r = shown.value[index];
  if (!r) return;
  const next = setImageWidth(sent, r, w);
  if (next === sent) return;
  const c = { value: sent, start: sel.start, end: sel.end };
  if (widthRun !== index) hist.record(c, "edit");
  widthRun = index;
  steps.value++;
  send(next);
}
function endWidth(): void { widthRun = -1; hist.breakRun(); }
function onRemove(index: number): void {
  const r = shown.value[index];
  if (!r) return;
  widthRun = -1;
  apply({ value: removeImage(sent, r), start: r.start, end: r.start }, current(), undefined, true);
}
const pct = (v: number): string => `${v}%`;

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
      <Button variant="ghost" size="sm" class="wp-note-ed__fmt" icon="pi-undo" hint="Undo (Ctrl+Z)" aria-label="Undo" :disabled="!canUndo" data-test="note-undo" @click="undo" />
      <Button variant="ghost" size="sm" class="wp-note-ed__fmt wp-note-ed__redo" icon="pi-undo" hint="Redo (Ctrl+Y)" aria-label="Redo" :disabled="!canRedo" data-test="note-redo" @click="redo" />
      <span class="wp-note-ed__sep" aria-hidden="true"></span>
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
        class="wp-note-ed__fmt"
        icon="pi-image"
        hint="Pictures: add one, or change their size"
        aria-label="Pictures"
        :pressed="panel === 'image'"
        data-test="note-fmt-image"
        @click="openPanel('image')"
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
        :options="KIND_OPTIONS"
        size="sm"
        aria-label="Link to"
        test-prefix="note-link-kind"
        @update:model-value="onKind"
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
      <template v-else-if="linkKind === 'library'">
        <WpSegmented
          :model-value="libraryScope"
          :options="[{ value: 'workflow', label: 'This workflow' }, { value: 'context', label: 'One WP Context' }]"
          size="sm"
          aria-label="What it adds"
          test-prefix="note-link-scope"
          @update:model-value="(v: 'workflow' | 'context') => (libraryScope = v)"
        />
        <WpSelect
          v-if="libraryScope === 'context'"
          :model-value="libraryNode ?? ''"
          :options="contextOptions"
          :placeholder="contextOptions.length ? 'Pick a WP Context…' : 'No WP Context on the canvas'"
          aria-label="WP Context"
          data-test="note-link-context"
          @update:model-value="(v: string) => (libraryNode = v || null)"
        />
        <p class="wp-note-ed__hint">
          A button that adds the bundles and modules {{ libraryScope === "workflow" ? "of this workflow" : "of that WP Context" }}
          to the library, after a review. Only what isn't in the library yet.
        </p>
      </template>
      <template v-else-if="linkKind === 'community'">
        <Input v-model="pack" size="sm" aria-label="Community pack" placeholder="owner/pack, or paste the pack's address" data-test="note-link-pack" @keydown.enter.prevent="insertLink" />
        <p class="wp-note-ed__hint">Opens the pack in the manager's Community tab, where it installs.</p>
      </template>
      <Input v-else v-model="linkUrl" size="sm" aria-label="Web address" placeholder="https://…" data-test="note-link-url" @keydown.enter.prevent="insertLink" />
      <Input v-model="linkText" size="sm" aria-label="Link text" placeholder="Text (optional)" data-test="note-link-text" @keydown.enter.prevent="insertLink" />
      <div class="wp-note-ed__row">
        <WpSegmented
          v-if="linkKind !== 'library'"
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

    <!-- Pictures -->
    <div v-if="panel === 'image'" class="wp-note-ed__panel" data-test="note-image-panel">
      <Input v-model="pictureAlt" size="sm" aria-label="Describe the picture" placeholder="What it shows (optional, read aloud and shown on hover)" data-test="note-image-alt" />
      <div class="wp-note-ed__row">
        <Button size="sm" variant="secondary" icon="pi-upload" :loading="busy" data-test="note-image-file" @click="fileInput?.click()">Add a picture…</Button>
        <span class="wp-note-ed__hint">or paste or drop one into the text</span>
        <input ref="fileInput" class="wp-note-ed__file" type="file" :accept="ACCEPTED_TYPES.join(',')" tabindex="-1" aria-hidden="true" data-test="note-image-input" @change="onFile" />
      </div>
      <span class="wp-note-ed__label">From the extension</span>
      <div class="wp-note-ed__assets">
        <Button
          v-for="a in NOTE_ASSETS"
          :key="a.id"
          variant="secondary"
          size="sm"
          class="wp-note-ed__asset"
          :hint="`Insert: ${a.label}`"
          :data-test="`note-asset-${a.id}`"
          @click="insertAsset(a.id, a.label)"
        >
          <img :src="assetUrl(a.id, '') ?? ''" alt="" :width="a.w" :height="a.h" draggable="false" />
          <span>{{ a.label }}</span>
        </Button>
      </div>
      <template v-if="shown.length">
        <span class="wp-note-ed__label">In this note</span>
        <ul class="wp-note-ed__pics" data-test="note-image-list">
          <li v-for="(r, i) in shown" :key="`${r.start}:${r.src}`" class="wp-note-ed__pic" data-test="note-image-row">
            <img v-if="refSrc(r)" class="wp-note-ed__thumb" :src="refSrc(r) ?? ''" alt="" draggable="false" />
            <i v-else class="pi pi-image wp-note-ed__thumb wp-note-ed__thumb--none" aria-hidden="true"></i>
            <div class="wp-note-ed__picbody">
              <span class="wp-note-ed__picname">{{ r.alt || "Picture" }}</span>
              <div class="wp-note-ed__row wp-note-ed__picsize">
                <Slider
                  class="wp-note-ed__slider"
                  :model-value="r.width ?? 100"
                  :min="10"
                  :max="100"
                  :step="5"
                  size="sm"
                  :format="pct"
                  show-value
                  :aria-label="`Width of ${r.alt || 'the picture'}, in percent of the note`"
                  data-test="note-image-width"
                  @update:model-value="(v: number | [number, number]) => onWidth(i, typeof v === 'number' ? v : v[1])"
                  @pointerup="endWidth"
                  @keyup="endWidth"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  :pressed="r.width === null"
                  hint="Its own size, never wider than the note"
                  data-test="note-image-own"
                  @click="onWidth(i, null); endWidth()"
                >Own size</Button>
                <Button size="sm" variant="ghost" icon="pi-trash" hint="Take the picture out" :aria-label="`Remove ${r.alt || 'the picture'}`" data-test="note-image-remove" @click="onRemove(i)" />
              </div>
            </div>
          </li>
        </ul>
      </template>
      <p class="wp-note-ed__hint">Pictures are saved in the workflow, made smaller (at most 1280 px, about 400 KB each). Width is a share of the note, so a picture never makes the note bigger.</p>
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
      @beforeinput="onBeforeInput"
      @input="onInput"
      @keydown="onKey"
      @keyup="remember"
      @mouseup="remember(); hist.breakRun()"
      @select="remember"
      @blur="remember"
      @paste="onPaste"
      @dragover="onDragOver"
      @drop="onDrop"
    />
    <div v-if="mode === 'preview'" class="wp-note-ed__preview" data-test="note-preview">
      <NoteMarkdown v-if="modelValue.trim()" :text="modelValue" :images="images" />
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
/* One row at the editor's width (360 px): 24 px buttons, the preview
   toggle pushed to the end. A narrower node wraps it rather than spill. */
.wp-note-ed__bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
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
/* PrimeIcons has no redo arrow: the undo arrow, mirrored. */
.wp-note-ed__redo :deep(.pi) { transform: scaleX(-1); }
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
.wp-note-ed__file { display: none; }
.wp-note-ed__assets { display: flex; flex-wrap: wrap; gap: 6px; }
/* A kit Button holding a thumbnail: taller than a control, the picture over its name. */
.wp-note-ed__asset.wp-btn {
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  height: auto;
  max-width: 100%;
  padding: 4px;
  font-size: 11px;
  font-weight: 400;
  text-align: left;
  white-space: normal;
}
.wp-note-ed__asset :deep(.wp-btn__label) {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: visible;
  white-space: normal;
  line-height: 14px;
}
.wp-note-ed__asset img { display: block; width: 100%; max-width: 280px; height: auto; border-radius: min(4px, var(--wp-radius-cap, 999px)); }
.wp-note-ed__pics { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.wp-note-ed__pic { display: flex; gap: 8px; align-items: center; }
.wp-note-ed__thumb {
  flex: none;
  width: 48px;
  height: 36px;
  object-fit: cover;
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  border: 1px solid var(--wp-border);
}
.wp-note-ed__thumb--none { display: flex; align-items: center; justify-content: center; color: var(--wp-text-dim); }
.wp-note-ed__picbody { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.wp-note-ed__picname { font-size: 12px; color: var(--wp-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-note-ed__picsize { flex-wrap: nowrap; gap: 4px; }
.wp-note-ed__slider { flex: 1 1 auto; min-width: 0; }
.wp-note-ed__preview {
  min-height: 60px;
  padding: 6px 8px;
  border: 1px dashed var(--wp-border-strong, var(--wp-border));
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  color: var(--wp-text-muted, var(--wp-text));
}
</style>
