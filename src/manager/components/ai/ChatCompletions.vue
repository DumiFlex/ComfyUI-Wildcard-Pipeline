<script setup lang="ts">
/**
 * Autocomplete for an AI chat box: `@` library items, `$` variables, booru
 * tags, LoRAs and embeddings, in a plain `<textarea>`.
 *
 * Drop it next to the box and pass the element: `<ChatCompletions
 * :target="box" />`. It listens on the textarea itself (input, caret moves,
 * keys) and edits through `setRangeText` plus an `input` event, so the box's
 * own `v-model` stays the single source of the text and its own key handler
 * (Enter to send) still runs whenever the menu is closed. While the menu is
 * open it takes Up / Down, Enter / Tab and Escape first (a capture listener
 * on the document, which runs before the box's own).
 *
 * What gets inserted, and why: `utils/chat-completions.ts`.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { getActivePinia } from "pinia";
import { api } from "../../api/client";
import type { ModelKind, ModelSuggestion, TagSuggestion } from "../../api/types";
import { useModuleStore } from "../../stores/moduleStore";
import { useBundleStore } from "../../stores/bundleStore";
import { collectLibraryVarHints } from "../../utils/library-suggestions";
import {
  applyRow, matchItems, matchVars, mentionItems, probeChat, rememberMention, rowText,
  type ChatProbe, type ChatRow, type MentionItem, type VarItem,
} from "../../utils/chat-completions";
import { textareaCaretRect } from "../../utils/textarea-caret";
import { loadTagAvailability } from "../../utils/tagStatus";
import {
  autocompleteSeparatorEnabled,
  completionLimit,
  completionSettingsVersion,
  completionSourceEnabled as sourceOn,
} from "../../utils/tagSetting";
import { varColorClass } from "../../../components/shared/var-color";
import { KIND_ICON_MAP } from "../../../components/shared/kind-icons";

const props = defineProps<{ target: HTMLTextAreaElement | null | undefined }>();

// Stores only when the app has Pinia: panels are mounted bare in tests and
// demos, and the box must still work there (with nothing to offer for @ / $).
const pinia = getActivePinia();
const modules = pinia ? useModuleStore() : { catalog: [], fetchCatalog: async () => undefined };
const bundles = pinia ? useBundleStore() : { catalog: [], fetchCatalog: async () => undefined };

const probe = ref<ChatProbe | null>(null);
const rows = ref<ChatRow[]>([]);
const active = ref(0);
const pos = ref({ top: 0, left: 0, up: false });
const tagsReady = ref(false);
let fetchSeq = 0;
let fetchTimer: ReturnType<typeof setTimeout> | undefined;
let catalogAsked = false;
/** Set while our own `input` event is in flight, so it doesn't reopen us. */
let picking = false;

const open = computed(() => probe.value !== null && rows.value.length > 0);
const listId = `wp-ai-ac-${Math.random().toString(36).slice(2, 8)}`;

/** Every module and bundle, for the `@` menu. */
const items = computed<MentionItem[]>(() => mentionItems(modules.catalog, bundles.catalog));

const vars = computed<VarItem[]>(() =>
  collectLibraryVarHints(modules).map((h) => ({ name: h.label, kind: h.kind })));

function ensureCatalog(): void {
  if (catalogAsked) return;
  catalogAsked = true;
  // An optional convenience: nothing here may ever throw into the box.
  try {
    if (!modules.catalog.length) void modules.fetchCatalog().catch(() => undefined);
    if (!bundles.catalog.length) void bundles.fetchCatalog().catch(() => undefined);
    void loadTagAvailability().then((s) => { tagsReady.value = s.available; }).catch(() => undefined);
  } catch {
    // No API here (a bare test mount): just offer nothing.
  }
}

function close(): void {
  probe.value = null;
  rows.value = [];
  if (fetchTimer !== undefined) clearTimeout(fetchTimer);
  fetchSeq++;
}

function place(el: HTMLTextAreaElement, at: number): void {
  const r = textareaCaretRect(el, at);
  const MENU_H = 240;
  const up = window.innerHeight - (r.top + r.height) < MENU_H + 8 && r.top > MENU_H;
  pos.value = {
    top: up ? r.top - 4 : r.top + r.height + 4,
    left: Math.max(8, Math.min(r.left, window.innerWidth - 300)),
    up,
  };
}

/** Booru tags + model files for a bare word or a `<lora:` / `embedding:`
 *  reference. One settle for both, like the editors, so the list does not
 *  rebuild twice per keystroke. Off sources are not asked. */
function fetchWords(p: ChatProbe): void {
  if (fetchTimer !== undefined) clearTimeout(fetchTimer);
  const seq = ++fetchSeq;
  fetchTimer = setTimeout(() => {
    void completionSettingsVersion.value;
    const max = completionLimit("maxSuggestions");
    const wantTags = p.mode === "word" && sourceOn("tag") && tagsReady.value;
    const kinds: ModelKind[] = p.mode === "model"
      ? [p.kind]
      : [...(sourceOn("lora") ? ["lora" as const] : []), ...(sourceOn("embedding") ? ["embedding" as const] : [])];
    const ask = <T>(call: () => Promise<T>): Promise<T | null> => {
      try { return call(); } catch { return Promise.resolve(null); }
    };
    void Promise.allSettled([
      wantTags ? ask(() => api.tags.suggest(p.query, max)) : Promise.resolve(null),
      kinds.length ? ask(() => api.models.suggest(p.query, kinds, Math.min(8, max), p.mode === "model")) : Promise.resolve(null),
    ]).then(([t, m]) => {
      if (seq !== fetchSeq || probe.value !== p) return;
      const tags: TagSuggestion[] = t.status === "fulfilled" && t.value ? t.value.tags : [];
      const res = m.status === "fulfilled" && m.value ? m.value.results : {};
      const loras: ModelSuggestion[] = res.lora ?? [];
      const embeds: ModelSuggestion[] = res.embedding ?? [];
      rows.value = [
        ...(loras.length || embeds.length ? tags.slice(0, 5) : tags).map((tag) => ({ source: "tag" as const, tag })),
        ...loras.map((model) => ({ source: "lora" as const, model })),
        ...embeds.map((model) => ({ source: "embedding" as const, model })),
      ];
      active.value = 0;
    });
  }, 120);
}

function refresh(): void {
  if (picking) return;
  const el = props.target;
  if (!el || el.disabled || el.selectionStart !== el.selectionEnd) return close();
  const p = probeChat(el.value, el.selectionStart);
  if (!p) return close();
  ensureCatalog();
  probe.value = p;
  place(el, p.start);
  if (p.mode === "item") {
    rows.value = matchItems(items.value, p.query).map((item) => ({ source: "item", item }));
    active.value = 0;
  } else if (p.mode === "var") {
    rows.value = matchVars(vars.value, p.query).map((v) => ({ source: "var", v }));
    active.value = 0;
  } else {
    fetchWords(p);
  }
}

function pick(row: ChatRow): void {
  const el = props.target;
  const p = probe.value;
  if (!el || !p) return;
  const suffix = row.source === "tag" && autocompleteSeparatorEnabled() ? ", " : "";
  const next = applyRow(el.value, el.selectionStart, p, row, suffix);
  // The box shows `@Name`; the id goes with the message (`withMentionIds`).
  if (row.source === "item") rememberMention(row.item);
  el.focus();
  el.setRangeText(next.insert, next.from, next.to, "end");
  picking = true;
  try {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } finally {
    picking = false;
  }
  el.setSelectionRange(next.caret, next.caret);
  close();
}

function onKeydown(ev: KeyboardEvent): void {
  if (!open.value || ev.target !== props.target) return;
  const n = rows.value.length;
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    active.value = (active.value + (ev.key === "ArrowDown" ? 1 : n - 1)) % n;
  } else if ((ev.key === "Enter" && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) || ev.key === "Tab") {
    const row = rows.value[active.value];
    if (row) pick(row);
  } else if (ev.key === "Escape") {
    close();
  } else {
    return;
  }
  ev.preventDefault();
  ev.stopImmediatePropagation();
}

function onCaretMove(ev: Event): void {
  if (ev instanceof KeyboardEvent && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(ev.key)) return;
  refresh();
}

function onBlur(): void {
  // After a row's mousedown has run.
  setTimeout(close, 120);
}

function bind(el: HTMLTextAreaElement | null | undefined, on: boolean): void {
  if (!el) return;
  const fn = on ? el.addEventListener.bind(el) : el.removeEventListener.bind(el);
  // On the document in capture, so the menu sees the key before ANY listener
  // on the box itself (its Enter-to-send), whatever order they were added in.
  if (on) el.ownerDocument.addEventListener("keydown", onKeydown, true);
  else el.ownerDocument.removeEventListener("keydown", onKeydown, true);
  fn("input", refresh);
  fn("keyup", onCaretMove);
  fn("click", refresh);
  fn("blur", onBlur);
  if (on) {
    el.setAttribute("aria-autocomplete", "list");
    el.setAttribute("aria-controls", listId);
  }
}

watch(() => props.target, (el, old) => {
  bind(old, false);
  bind(el, true);
}, { immediate: true });

watch(open, (o) => {
  const el = props.target;
  if (!el) return;
  if (o) el.setAttribute("aria-expanded", "true");
  else { el.removeAttribute("aria-expanded"); el.removeAttribute("aria-activedescendant"); }
});
watch(active, (i) => {
  if (open.value) props.target?.setAttribute("aria-activedescendant", `${listId}-${i}`);
});

onBeforeUnmount(() => { bind(props.target, false); close(); });

const SECTION: Record<ChatRow["source"], string> = {
  item: "library", var: "variables", tag: "tags", lora: "loras", embedding: "embeddings",
};
const sections = computed(() => {
  const out: Array<{ label: string; rows: Array<{ row: ChatRow; index: number }> }> = [];
  rows.value.forEach((row, index) => {
    const label = SECTION[row.source];
    const last = out[out.length - 1];
    if (last && last.label === label) last.rows.push({ row, index });
    else out.push({ label, rows: [{ row, index }] });
  });
  return out;
});

function rowIcon(row: ChatRow): string {
  if (row.source === "item") return row.item.kind === "bundle" ? "pi pi-box" : (KIND_ICON_MAP as Record<string, string>)[row.item.kind] ?? "pi pi-circle";
  if (row.source === "var") return "pi pi-dollar";
  return row.source === "tag" ? "pi pi-tags" : row.source === "lora" ? "pi pi-asterisk" : "pi pi-code";
}
function rowLabel(row: ChatRow): string {
  if (row.source === "item") return row.item.name;
  if (row.source === "var") return "$" + row.v.name;
  if (row.source === "tag") return row.tag.name;
  return row.model.name;
}
function rowNote(row: ChatRow): string {
  if (row.source === "item") return [row.item.kind.replace("_", " "), row.item.variable ? "$" + row.item.variable : ""].filter(Boolean).join(" · ");
  if (row.source === "var") return row.v.kind.replace("_", " ");
  if (row.source === "tag") return row.tag.count ? row.tag.count.toLocaleString() : "";
  return row.model.folder;
}
function rowTitle(row: ChatRow): string {
  return probe.value ? `Inserts ${rowText(row, probe.value)}` : "";
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      :id="listId"
      class="wp-ai-ac"
      :class="{ 'wp-ai-ac--up': pos.up }"
      :style="{ top: `${pos.top}px`, left: `${pos.left}px` }"
      role="listbox"
      aria-label="Suggestions"
      data-test="ai-ac"
    >
      <template v-for="s in sections" :key="s.label">
        <div class="wp-ai-ac__head">{{ s.label }}</div>
        <!-- A combobox option: the composer keeps focus and moves through the rows with the arrow keys (aria-activedescendant). -->
        <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus, vuejs-accessibility/mouse-events-have-key-events -->
        <div
          v-for="e in s.rows"
          :id="`${listId}-${e.index}`"
          :key="e.index"
          class="wp-ai-ac__row"
          :data-active="e.index === active || undefined"
          role="option"
          :aria-selected="e.index === active"
          :title="rowTitle(e.row)"
          :data-test="`ai-ac-row-${e.index}`"
          @mousedown.prevent="pick(e.row)"
          @mouseenter="active = e.index"
        >
          <i :class="rowIcon(e.row)" class="wp-ai-ac__icon" aria-hidden="true" />
          <span
            class="wp-ai-ac__label"
            :class="e.row.source === 'var' ? varColorClass(e.row.v.name) : null"
          >{{ rowLabel(e.row) }}</span>
          <span class="wp-ai-ac__note">{{ rowNote(e.row) }}</span>
        </div>
      </template>
      <div class="wp-ai-ac__foot">↑↓ choose · Enter or Tab inserts · Esc closes</div>
    </div>
  </Teleport>
</template>

<style scoped>
.wp-ai-ac {
  position: fixed;
  z-index: 10040;
  width: 290px;
  max-height: 240px;
  overflow-y: auto;
  padding: 4px 0;
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border-strong, var(--wp-border));
  border-radius: 7px;
  box-shadow: var(--wp-shadow-md);
  font-size: var(--wp-text-sm, 12px);
}
.wp-ai-ac--up { transform: translateY(-100%); }
.wp-ai-ac__head {
  padding: 4px 10px 2px;
  font-size: 10px; /* audit-exempt: micro section label */
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--wp-text-dim);
}
.wp-ai-ac__row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 10px;
  cursor: pointer;
  color: var(--wp-text);
}
.wp-ai-ac__row[data-active] { background: color-mix(in oklab, var(--wp-accent-500) 22%, transparent); }
.wp-ai-ac__icon { flex: none; width: 14px; font-size: 11px; color: var(--wp-text-muted); text-align: center; }
.wp-ai-ac__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--wp-font-mono); }
.wp-ai-ac__note { margin-left: auto; flex: none; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--wp-text-dim); font-size: 11px; }
.wp-ai-ac__foot { padding: 4px 10px 2px; border-top: 1px solid var(--wp-border); margin-top: 4px; color: var(--wp-text-dim); font-size: 10.5px; } /* audit-exempt: micro hint */
</style>
