<script setup lang="ts">
/**
 * One assistant message: its Markdown (see `utils/chat-markdown.ts`) drawn
 * with plain elements, and [[Name]] mentions as chips that open the item.
 * A mention the server couldn't match to an item stays a plain label.
 * A list of three or more items, each opening with a mention, is drawn as
 * a compact item list: kind icon, name and category chip, then the rest
 * of the line.
 *
 * Prompt syntax in the text is coloured the way the editors colour it
 * (`utils/chat-syntax.ts`, shared with the cards). A line opening with "Tip:", "Note:" or "Warning:" is a callout,
 * and so is a quote opening with a GitHub alert (`> [!NOTE]`, `> [!WARNING]`).
 * A code span that is only a key combo (`Ctrl+Enter`) shows as keys, and a
 * code block longer than FOLD_AT lines folds.
 *
 * Step fields a JSON-mode reply wrote into its text ("calls: []") are left
 * out (`utils/chat-step-fields.ts`).
 *
 * `live`: the answer is still streaming. Open `**` / `` ` `` / `[[` at the
 * end are closed first (`closeOpen`), and the words added since the last
 * update fade in (never inside code; off with reduced motion).
 */
import { computed, h, ref, watch, type VNode } from "vue";
import { useRouter } from "vue-router";
import { deletedIds } from "../../composables/useLibraryChanged";
import { useCardViewContext } from "../../composables/card-views/context";
import CategoryChip from "../CategoryChip.vue";
import { KIND_ICON_MAP } from "../../../components/shared/kind-icons";
import type { AiChatRef } from "../../api/types";
import { closeOpen, parseMarkdown, type Block, type Inline, type ListItem, type Tone } from "../../utils/chat-markdown";
import { copyText } from "../../utils/clipboard";
import { syntaxNodes } from "../../utils/chat-syntax";
import { stripStepFields } from "../../utils/chat-step-fields";

const props = defineProps<{ text: string; refs?: Record<string, AiChatRef>; live?: boolean }>();
const router = useRouter();

const EDIT_ROUTES: Record<string, string> = {
  wildcard: "wildcards-edit", combine: "combines-edit", derivation: "derivations-edit",
  constraint: "constraints-edit", fixed_values: "fixed-values-edit", bundle: "bundles-edit",
  template: "templates-edit",
};

/* ── Live fade ─────────────────────────────────────────────────────────
   While streaming, a marker goes in the text where the new words start.
   Rendering drops it, and every text run after it is wrapped in a span
   that fades in. Each update keys those spans afresh so they replay. */
const MARK = "\u{e000}";
const MARKS = /\u{e000}/gu;
const unmark = (v: string): string => (v.includes(MARK) ? v.replace(MARKS, "") : v);
/** Lines the marker would break: fences, table rules, `---` rules. */
const NO_MARK_LINE = /^\s*(?:`{3}|~{3}|[|:\s-]+$|[*_=\s-]+$)/;
/** List, quote, heading and task markup at a line's start. */
const LINE_MARKUP = /^\s*(?:(?:#{1,6}|>|[-*+•]|\d{1,9}[.)]|\[[ xX]\])[ \t]+)*/;

/** Where to put the marker for text that grew from `before`: just before
 *  the space that opens the first new word, never inside a line's markup
 *  or first word (block patterns look there), else -1. */
function markAt(text: string, before: string): number {
  if (before.length >= text.length || !text.startsWith(before)) return -1;
  let at = before.length;
  while (at > 0 && !/\s/.test(text[at - 1])) at--;
  if (at > 0 && text[at - 1] !== "\n") at--; // onto the space before the word
  const start = text.lastIndexOf("\n", at - 1) + 1;
  const lineEnd = text.indexOf("\n", start);
  const line = text.slice(start, lineEnd < 0 ? text.length : lineEnd);
  if (NO_MARK_LINE.test(line)) return -1;
  // The end of the line's first word after its markup.
  const markup = LINE_MARKUP.exec(line)?.[0].length ?? 0;
  const word = /^\S+/.exec(line.slice(markup));
  const minAt = start + markup + (word ? word[0].length : 0);
  if (at < minAt) at = minAt;
  return at < start + line.length && /\s/.test(text[at]) ? at : -1;
}

/** The text without step fields a JSON-mode reply wrote into it ("calls: []"). */
const text = computed(() => stripStepFields(props.text));

/** References stay text in a reply; chips are for cards (`chat-syntax.ts`). */
const syntax = (v: string): Array<VNode | string> => syntaxNodes(v, { chips: false });

let before = "";
watch(text, (_now, old) => { before = old ?? ""; }, { flush: "sync" });

/** Render state: past the marker yet, and how many fade spans so far.
 *  Spans are keyed by where the marker sits, so only new words replay. */
let fading = false;
let fadeKey = 0;
let fadeAt = -1;

function fade(parts: Array<VNode | string>): Array<VNode | string> {
  if (!parts.length) return parts;
  return [h("span", { class: "wp-ai-msg__new", key: `n${fadeAt}.${fadeKey++}` }, parts)];
}

/** Text with the marker taken out; what follows it fades. */
function liveText(v: string): Array<VNode | string> {
  if (fading) return fade(syntax(unmark(v)));
  const at = v.indexOf(MARK);
  if (at < 0) return syntax(v);
  fading = true;
  return [...syntax(v.slice(0, at)), ...fade(syntax(unmark(v.slice(at))))];
}

/** Code shows no fade, but the words after it do. */
function codeText(v: string): string {
  if (v.includes(MARK)) fading = true;
  return unmark(v);
}

/* ── Keys ─────────────────────────────────────────────────────────────── */

const MOD = "Ctrl|Control|Cmd|Command|Alt|Option|Opt|Shift|Meta|Win|Super|⌘|⌥|⇧|⌃";
const KEY = "Enter|Return|Esc|Escape|Tab|Space|Backspace|Delete|Del|Insert|Home|End|PgUp|PgDn|PageUp|PageDown"
  + "|Up|Down|Left|Right|Click|Left-click|Right-click|Middle-click|Double-click|Drag|Scroll|Wheel|F\\d{1,2}|[A-Za-z0-9]|[-=,./;'`\\[\\]]";
/** `Ctrl+Enter`, `Shift + Click`, or a lone named key (`Enter`, `Esc`, `F5`). */
const KEYS = new RegExp(`^(?:(?:${MOD})\\s*\\+\\s*)+(?:${MOD}|${KEY})$|^(?:Enter|Esc|Escape|Backspace|F\\d{1,2})$`, "i");

function keys(v: string): VNode | null {
  if (v.length > 40 || !KEYS.test(v.trim())) return null;
  const parts = v.trim().split(/\s*\+\s*/);
  return h("span", { class: "wp-ai-msg__keys", "data-test": "ai-msg-keys" },
    parts.flatMap((k, i) => (i ? ["+", h("kbd", k)] : [h("kbd", k)])));
}

function chip(raw: string): VNode {
  const label = unmark(raw);
  const found = props.refs?.[label];
  if (found && !found.id) {
    return h("span", {
      class: "wp-ai-msg__chip", "data-missing": "true", "data-test": "ai-msg-chip-shared",
      title: `${found.shared ?? "Several"} items are called ${found.name}; the answer didn't say which`,
    }, found.name);
  }
  // `[[id#Name]]`: the name is what reads when the id is unknown.
  if (!found) return h("span", { class: "wp-ai-msg__chip", "data-missing": "true" }, label.includes("#") ? label.slice(label.indexOf("#") + 1) : label);
  if (deletedIds.value.has(found.id)) {
    return h("span", {
      class: "wp-ai-msg__chip", "data-missing": "true", "data-deleted": "true", "data-test": "ai-msg-chip-deleted",
      title: `${found.name} was deleted after this was written`,
    }, found.name);
  }
  if (found.pending) {
    const icon0 = KIND_ICON_MAP[found.type as keyof typeof KIND_ICON_MAP] ?? "pi pi-circle";
    return h("span", {
      class: "wp-ai-msg__chip", "data-pending": "true", "data-test": "ai-msg-chip-pending",
      title: `${found.name} isn't in your library yet: apply its card to create it`,
    }, [h("i", { class: icon0, "aria-hidden": "true" }), found.name]);
  }
  const icon = KIND_ICON_MAP[found.type as keyof typeof KIND_ICON_MAP] ?? "pi pi-circle";
  const route = EDIT_ROUTES[found.type];
  return h("button", {
    type: "button", class: "wp-ai-msg__chip", "data-test": "ai-msg-chip", "data-kind": found.type,
    title: `Open ${found.name}`,
    onClick: () => { if (route) void router.push({ name: route, params: { id: found.id } }); },
  }, [h("i", { class: icon, "aria-hidden": "true" }), found.name]);
}

function inline(nodes: Inline[]): Array<VNode | string> {
  return nodes.flatMap((n) => {
    switch (n.t) {
      case "text": return props.live ? liveText(n.v) : syntax(n.v);
      case "b": return [h("strong", inline(n.c))];
      case "i": return [h("em", inline(n.c))];
      case "s": return [h("s", inline(n.c))];
      case "code": {
        const v = codeText(n.v);
        return [keys(v) ?? h("code", { class: "wp-ai-msg__code" }, syntax(v))];
      }
      case "ref": return [chip(n.v)];
      // Never followed: the text, with the address in a tooltip.
      case "link": return [h("span", { class: "wp-ai-msg__link", title: unmark(n.href) }, inline(n.c))];
    }
  });
}

const copied = ref<string | null>(null);

function copy(v: string): void {
  void copyText(v).then((ok) => {
    if (!ok) return;
    copied.value = v;
    setTimeout(() => { if (copied.value === v) copied.value = null; }, 1500);
  });
}

/** Blocks longer than FOLD_AT lines show FOLD_SHOW of them until opened. */
const FOLD_AT = 20;
const FOLD_SHOW = 12;
const unfolded = ref(new Set<string>());

function toggleFold(v: string): void {
  const next = new Set(unfolded.value);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  unfolded.value = next;
}

function pre(lang: string, raw: string): VNode {
  const v = codeText(raw);
  const done = copied.value === v;
  const lines = v.split("\n");
  // A block still streaming isn't folded: it would fold under the reader.
  const foldable = !props.live && lines.length > FOLD_AT;
  const open = !foldable || unfolded.value.has(v);
  const shown = open ? v : lines.slice(0, FOLD_SHOW).join("\n");
  return h("div", { class: "wp-ai-msg__codeblock" }, [
    h("div", { class: "wp-ai-msg__codehead" }, [
      h("span", unmark(lang) || "text"),
      h("button", {
        type: "button", class: "wp-ai-msg__copy", "data-test": "ai-msg-copy",
        "aria-label": done ? "Copied" : "Copy code", title: done ? "Copied" : "Copy",
        onClick: () => copy(v),
      }, [h("i", { class: done ? "pi pi-check" : "pi pi-copy", "aria-hidden": "true" })]),
    ]),
    h("pre", { class: "wp-ai-msg__pre", "data-folded": open ? undefined : "true" }, syntax(shown)),
    foldable ? h("button", {
      type: "button", class: "wp-ai-msg__fold", "data-test": "ai-msg-fold", "aria-expanded": open ? "true" : "false",
      onClick: () => toggleFold(v),
    }, open ? "Show fewer lines" : `Show all ${lines.length} lines`) : null,
  ]);
}

function table(b: Extract<Block, { t: "table" }>): VNode {
  const style = (i: number): Record<string, string> | undefined =>
    b.align[i] ? { textAlign: b.align[i] as string } : undefined;
  return h("div", { class: "wp-ai-msg__table", tabindex: 0, role: "region", "aria-label": "Table" }, [
    h("table", [
      h("thead", [h("tr", b.head.map((c, i) => h("th", { style: style(i) }, inline(c))))]),
      h("tbody", b.rows.map((r) => h("tr", r.map((c, i) => h("td", { style: style(i) }, inline(c)))))),
    ]),
  ]);
}

/* ── Item lists ──────────────────────────────────────────────────────── */

const ITEM_LIST_MIN = 3;
const lookups = useCardViewContext();

function categoryChip(id: string | undefined): VNode | null {
  if (!id) return null;
  let c: ReturnType<NonNullable<typeof lookups.category>> = null;
  try { c = lookups.category?.(id) ?? null; } catch { c = null; }
  return c ? h(CategoryChip, { name: c.name, color: c.color, icon: c.icon, class: "wp-ai-msg__item-cat" }) : null;
}

/** Each item of a list as its mention and the words after it, when every
 *  item is one line opening with a mention of a real item. */
function itemRows(items: ListItem[]): Array<{ ref: string; rest: Inline[] }> | null {
  if (items.length < ITEM_LIST_MIN) return null;
  const rows: Array<{ ref: string; rest: Inline[] }> = [];
  for (const it of items) {
    const b = it.blocks;
    if (it.task !== null || b.length !== 1 || b[0].t !== "p") return null;
    const [first, ...rest] = b[0].c;
    if (first?.t !== "ref" || !props.refs?.[unmark(first.v)]?.id) return null;
    // "— a wildcard of …", ": …", "- …": the joiner goes, the words stay.
    if (rest[0]?.t === "text") rest[0] = { t: "text", v: rest[0].v.replace(/^\s*(?:[—–:-]\s*)?/, "") };
    rows.push({ ref: first.v, rest: rest.filter((n) => n.t !== "text" || n.v) });
  }
  return rows;
}

function itemList(rows: Array<{ ref: string; rest: Inline[] }>, ordered: boolean): VNode {
  return h(ordered ? "ol" : "ul", { class: "wp-ai-msg__items", "data-test": "ai-msg-items" }, rows.map((r) =>
    h("li", { class: "wp-ai-msg__item" }, [
      chip(r.ref),
      categoryChip(props.refs?.[unmark(r.ref)]?.category),
      r.rest.length ? h("span", { class: "wp-ai-msg__item-rest" }, inline(r.rest)) : null,
    ])));
}

function item(it: ListItem): VNode {
  const body = it.blocks.map(block);
  if (it.task === null) return h("li", body);
  return h("li", { class: "wp-ai-msg__task" }, [
    h("i", {
      class: it.task ? "pi pi-check-square" : "pi pi-stop",
      role: "img", "aria-label": it.task ? "Done" : "Not done",
    }),
    h("div", body),
  ]);
}

const CALLOUT = /^(?:💡|⚠️?|ℹ️?)?\s*(tip|note|warning|careful|heads up)\s*:\s*/i;
const CALLOUT_EMOJI = /^(💡|⚠️?)\s*/u;

/** A paragraph that opens with "Tip:" / "Warning:" (also written bold,
 *  "**Tip:**", or as a 💡 / ⚠️ line): its tone and the rest of it. */
function calloutOf(c: Inline[]): { tone: "tip" | "warn"; rest: Inline[] } | null {
  const first = c[0];
  if (first?.t === "text") {
    const m = CALLOUT.exec(first.v);
    if (m) return { tone: /warn|careful/i.test(m[1]) ? "warn" : "tip", rest: [{ t: "text", v: first.v.slice(m[0].length) }, ...c.slice(1)] };
    const e = CALLOUT_EMOJI.exec(first.v);
    if (e) return { tone: e[1].startsWith("⚠") ? "warn" : "tip", rest: [{ t: "text", v: first.v.slice(e[0].length) }, ...c.slice(1)] };
  }
  // "**Tip:** text" or "**Tip**: text".
  if ((first?.t === "b" || first?.t === "i") && first.c.length === 1 && first.c[0].t === "text") {
    const label = first.c[0].v.trim();
    const after = c[1]?.t === "text" ? c[1].v : "";
    const m = /^(tip|note|warning|careful|heads up)\s*:?$/i.exec(label);
    if (m && (label.endsWith(":") || after.trimStart().startsWith(":"))) {
      const rest = c.slice(1);
      if (rest[0]?.t === "text") rest[0] = { t: "text", v: rest[0].v.replace(/^\s*:?\s*/, "") };
      return { tone: /warn|careful/i.test(m[1]) ? "warn" : "tip", rest };
    }
  }
  return null;
}

function calloutIcon(tone: Tone): VNode {
  return h("i", { class: tone === "warn" ? "pi pi-exclamation-triangle" : "pi pi-lightbulb", "aria-hidden": "true" });
}

function callout(tone: Tone, rest: Inline[]): VNode {
  return h("p", { class: "wp-ai-msg__callout", "data-tone": tone }, [calloutIcon(tone), h("span", inline(rest))]);
}

/** A GitHub alert quote: the callout look around all of its blocks. */
function calloutBlocks(tone: Tone, blocks: Block[]): VNode {
  return h("div", { class: "wp-ai-msg__callout", "data-tone": tone, "data-test": "ai-msg-alert" }, [
    calloutIcon(tone), h("div", { class: "wp-ai-msg__callout-body" }, blocks.map(block)),
  ]);
}

function block(b: Block): VNode {
  switch (b.t) {
    case "p": {
      const co = calloutOf(b.c);
      if (co) return callout(co.tone, co.rest);
      return h("p", inline(b.c));
    }
    // Message headings sit under the drawer's own, so they start at h3.
    case "h": return h(`h${Math.min(6, b.level + 2)}`, { class: "wp-ai-msg__h", "data-level": b.level }, inline(b.c));
    case "list": {
      const rows = itemRows(b.items);
      if (rows) return itemList(rows, b.ordered);
      return b.ordered
        ? h("ol", b.start !== 1 ? { start: b.start } : {}, b.items.map(item))
        : h("ul", b.items.map(item));
    }
    case "pre": return pre(b.lang, b.v);
    case "quote": {
      if (b.tone) return calloutBlocks(b.tone, b.blocks);
      // "> Tip: …" is a callout too.
      const only = b.blocks.length === 1 && b.blocks[0].t === "p" ? calloutOf(b.blocks[0].c) : null;
      return only ? callout(only.tone, only.rest) : h("blockquote", b.blocks.map(block));
    }
    case "table": return table(b);
    case "hr": return h("hr");
  }
}

const parsed = computed((): { blocks: Block[]; at: number } => {
  if (!props.live) return { blocks: parseMarkdown(text.value), at: -1 };
  const at = markAt(text.value, before);
  const closed = closeOpen(text.value);
  // closeOpen only changes the end; the marker goes in when it's before that.
  const ok = at >= 0 && at < closed.length && closed.startsWith(text.value.slice(0, at));
  return { blocks: parseMarkdown(ok ? closed.slice(0, at) + MARK + closed.slice(at) : closed), at: ok ? at : -1 };
});
const Body = () => {
  fading = false;
  fadeKey = 0;
  fadeAt = parsed.value.at;
  return parsed.value.blocks.map(block);
};
</script>

<template>
  <div class="wp-ai-msg" :class="{ 'wp-ai-msg--live': live }" data-test="ai-msg"><Body /></div>
</template>

<style scoped>
.wp-ai-msg { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; display: flex; flex-direction: column; gap: 6px; }
.wp-ai-msg :deep(p) { margin: 0; white-space: pre-wrap; }
.wp-ai-msg :deep(ul), .wp-ai-msg :deep(ol) { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 2px; }
/* The app resets list markers; a reply's lists keep theirs. */
.wp-ai-msg :deep(ul) { list-style: disc; }
.wp-ai-msg :deep(ul ul) { list-style: circle; }
.wp-ai-msg :deep(ol) { list-style: decimal; }
.wp-ai-msg :deep(li) { display: list-item; }
.wp-ai-msg :deep(li::marker) { color: var(--wp-text-muted); }
.wp-ai-msg :deep(blockquote) { margin: 0; padding-left: 8px; border-left: 2px solid var(--wp-border-strong, var(--wp-border)); color: var(--wp-text-muted); }
.wp-ai-msg :deep(.wp-ai-msg__h) { margin: 2px 0 0; font-size: 13px; font-weight: 600; line-height: 1.35; color: var(--wp-text); }
.wp-ai-msg :deep(.wp-ai-msg__h[data-level="1"]) { font-size: 15px; }
.wp-ai-msg :deep(.wp-ai-msg__h[data-level="2"]) { font-size: 14px; }
.wp-ai-msg :deep(li > p + *), .wp-ai-msg :deep(li > * + p) { margin-top: 4px; }
.wp-ai-msg :deep(li > ul), .wp-ai-msg :deep(li > ol) { margin-top: 2px; }
.wp-ai-msg :deep(li.wp-ai-msg__task) { list-style: none; margin-left: -18px; display: flex; gap: 6px; align-items: baseline; }
.wp-ai-msg :deep(.wp-ai-msg__task > i) { font-size: 12px; color: var(--wp-text-muted); }
.wp-ai-msg :deep(blockquote > * + *) { margin-top: 4px; }
.wp-ai-msg :deep(hr) { width: 100%; margin: 4px 0; border: 0; border-top: 1px solid var(--wp-border); }
.wp-ai-msg :deep(s) { color: var(--wp-text-muted); }
.wp-ai-msg :deep(.wp-ai-msg__link) { text-decoration: underline dotted; text-underline-offset: 2px; cursor: help; }
.wp-ai-msg :deep(.wp-ai-msg__table) { max-width: 100%; overflow-x: auto; border: 1px solid var(--wp-border); border-radius: var(--wp-radius-sm); }
.wp-ai-msg :deep(.wp-ai-msg__table:focus-visible) { outline: 2px solid var(--wp-accent-500); outline-offset: 1px; }
.wp-ai-msg :deep(.wp-ai-msg__table table) { border-collapse: collapse; font-size: 12.5px; min-width: 100%; }
.wp-ai-msg :deep(.wp-ai-msg__table th), .wp-ai-msg :deep(.wp-ai-msg__table td) {
  padding: 4px 8px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--wp-border); overflow-wrap: normal; min-width: 4ch;
}
.wp-ai-msg :deep(.wp-ai-msg__table th) { font-weight: 600; background: var(--wp-bg-2); white-space: nowrap; }
.wp-ai-msg :deep(.wp-ai-msg__table tbody tr:last-child td) { border-bottom: 0; }
.wp-ai-msg :deep(.wp-ai-msg__codeblock) { border-radius: var(--wp-radius-sm); background: var(--wp-bg-3, var(--wp-bg-2)); overflow: hidden; }
.wp-ai-msg :deep(.wp-ai-msg__codehead) {
  display: flex; align-items: center; justify-content: space-between; padding: 2px 4px 2px 8px;
  font-size: 11px; color: var(--wp-text-muted); border-bottom: 1px solid var(--wp-border);
}
.wp-ai-msg :deep(.wp-ai-msg__copy) {
  display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0;
  border: 0; border-radius: var(--wp-radius-sm); background: transparent; color: inherit; cursor: pointer;
}
.wp-ai-msg :deep(.wp-ai-msg__copy:hover) { color: var(--wp-text); background: var(--wp-bg-2); }
.wp-ai-msg :deep(.wp-ai-msg__copy i) { font-size: 11px; }
.wp-ai-msg :deep(.wp-ai-msg__code) {
  font-family: var(--wp-font-mono, ui-monospace, monospace); font-size: 12px;
  padding: 0 4px; border-radius: var(--wp-radius-sm); background: var(--wp-bg-3, var(--wp-bg-2));
}
.wp-ai-msg :deep(.wp-ai-msg__pre) {
  margin: 0; padding: 8px; overflow-x: auto;
  font-family: var(--wp-font-mono, ui-monospace, monospace); font-size: 12px; white-space: pre-wrap;
}
.wp-ai-msg :deep(.wp-ai-msg__chip) {
  display: inline-flex; align-items: center; gap: 4px; vertical-align: baseline;
  padding: 0 6px; margin: 0 1px; border-radius: var(--wp-radius-sm); font: inherit; font-size: 12px; line-height: 1.6;
  color: var(--wp-accent-text); cursor: pointer;
  background: color-mix(in oklab, var(--wp-accent-500) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 35%, transparent);
}
.wp-ai-msg :deep(.wp-ai-msg__chip i) { font-size: 10px; }
.wp-ai-msg :deep(.wp-ai-msg__chip:hover) { background: color-mix(in oklab, var(--wp-accent-500) 22%, transparent); }
.wp-ai-msg :deep(.wp-ai-msg__callout) {
  display: flex; gap: 8px; align-items: baseline; padding: 6px 10px; border-radius: var(--wp-radius-sm);
  background: color-mix(in oklab, var(--wp-accent-500) 8%, transparent);
  border-left: 3px solid color-mix(in oklab, var(--wp-accent-500) 60%, transparent);
}
.wp-ai-msg :deep(.wp-ai-msg__callout[data-tone="warn"]) {
  background: color-mix(in oklab, var(--wp-warn) 8%, transparent);
  border-left-color: color-mix(in oklab, var(--wp-warn) 70%, transparent);
}
.wp-ai-msg :deep(.wp-ai-msg__callout i) { font-size: 12px; color: var(--wp-accent-text); }
.wp-ai-msg :deep(.wp-ai-msg__callout[data-tone="warn"] i) { color: var(--wp-warn); }
.wp-ai-msg :deep(div.wp-ai-msg__callout) { align-items: flex-start; }
.wp-ai-msg :deep(div.wp-ai-msg__callout > i) { margin-top: 3px; }
.wp-ai-msg :deep(.wp-ai-msg__callout-body) { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.wp-ai-msg :deep(.wp-ai-msg__keys) { white-space: nowrap; color: var(--wp-text-muted); }
.wp-ai-msg :deep(.wp-ai-msg__keys kbd) {
  display: inline-block; padding: 0 5px; margin: 0 1px; min-width: 1.6em; text-align: center;
  font-family: var(--wp-font-mono, ui-monospace, monospace); font-size: 11px; line-height: 1.6; color: var(--wp-text);
  background: var(--wp-bg-2); border: 1px solid var(--wp-border); border-bottom-width: 2px; border-radius: var(--wp-radius-sm);
}
.wp-ai-msg :deep(.wp-ai-msg__pre[data-folded]) {
  mask-image: linear-gradient(to bottom, #000 70%, transparent);
}
.wp-ai-msg :deep(.wp-ai-msg__fold) {
  display: block; width: 100%; padding: 3px 8px; border: 0; border-top: 1px solid var(--wp-border);
  background: transparent; color: var(--wp-text-muted); font: inherit; font-size: 11px; text-align: left; cursor: pointer;
}
.wp-ai-msg :deep(.wp-ai-msg__fold:hover) { color: var(--wp-text); background: var(--wp-bg-2); }
.wp-ai-msg :deep(.wp-ai-msg__fold:focus-visible) { outline: 2px solid var(--wp-accent-500); outline-offset: -2px; }
.wp-ai-msg--live :deep(.wp-ai-msg__new) { animation: wp-ai-msg-fade 150ms ease-out; }
.wp-ai-msg--live > :deep(:last-child:not(.wp-ai-msg__codeblock)) { animation: wp-ai-msg-fade 150ms ease-out; }
@keyframes wp-ai-msg-fade { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .wp-ai-msg--live :deep(.wp-ai-msg__new), .wp-ai-msg--live > :deep(:last-child:not(.wp-ai-msg__codeblock)) { animation: none; }
}
.wp-ai-msg :deep(.wp-ai-msg__items) {
  list-style: none; padding: 4px; gap: 0; border: 1px solid var(--wp-border); border-radius: var(--wp-radius-sm);
}
.wp-ai-msg :deep(.wp-ai-msg__item) {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 6px; padding: 3px 4px; border-radius: var(--wp-radius-sm);
}
.wp-ai-msg :deep(.wp-ai-msg__item + .wp-ai-msg__item) { border-top: 1px solid var(--wp-border); border-radius: 0; }
.wp-ai-msg :deep(.wp-ai-msg__item-cat) { font-size: 11px; }
.wp-ai-msg :deep(.wp-ai-msg__item-rest) { flex: 1 1 12em; min-width: 0; color: var(--wp-text-muted); font-size: 12.5px; }
.wp-ai-msg :deep(.wp-ai-msg__chip[data-missing]) { cursor: default; color: var(--wp-text-muted); background: transparent; border-color: var(--wp-border); }
.wp-ai-msg :deep(.wp-ai-msg__chip[data-deleted]) { text-decoration: line-through; }
.wp-ai-msg :deep(.wp-ai-msg__chip[data-pending]) { cursor: default; border-style: dashed; }
</style>
