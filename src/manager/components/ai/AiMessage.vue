<script setup lang="ts">
/**
 * One assistant message: its Markdown (see `utils/chat-markdown.ts`) drawn
 * with plain elements, and [[Name]] mentions as chips that open the item.
 * A mention the server couldn't match to an item stays a plain label.
 *
 * Prompt syntax in the text is coloured the way the editors colour it:
 * `$variables` in their own hashed colour, `{a|b}` picks, `{2$$, $$…}`
 * multi-picks, `@{…}` references, `<lora:…>` / `embedding:` runs and
 * `#tags`. A line opening with "Tip:", "Note:" or "Warning:" is a callout.
 */
import { computed, h, ref, type VNode } from "vue";
import { useRouter } from "vue-router";
import { KIND_ICON_MAP } from "../../../components/shared/kind-icons";
import type { AiChatRef } from "../../api/types";
import { parseMarkdown, type Block, type Inline, type ListItem } from "../../utils/chat-markdown";
import { tokenizeRich } from "@/widgets/richTokenize";
import { varColorIndex } from "../../../components/shared/var-color";

const props = defineProps<{ text: string; refs?: Record<string, AiChatRef> }>();
const router = useRouter();

const EDIT_ROUTES: Record<string, string> = {
  wildcard: "wildcards-edit", combine: "combines-edit", derivation: "derivations-edit",
  constraint: "constraints-edit", fixed_values: "fixed-values-edit", bundle: "bundles-edit",
  template: "templates-edit",
};

function chip(label: string): VNode {
  const found = props.refs?.[label];
  if (found && !found.id) {
    return h("span", {
      class: "wp-ai-msg__chip", "data-missing": "true", "data-test": "ai-msg-chip-shared",
      title: `${found.shared ?? "Several"} items are called ${found.name}; the answer didn't say which`,
    }, found.name);
  }
  // `[[id#Name]]`: the name is what reads when the id is unknown.
  if (!found) return h("span", { class: "wp-ai-msg__chip", "data-missing": "true" }, label.includes("#") ? label.slice(label.indexOf("#") + 1) : label);
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

/** `<lora:…>`, `embedding:…` and `#tags`: not tokenizer kinds, so split first. */
const EXTRA = /<lora:[^>\s]*>|embedding:[^\s,]+|(?<![\w&#/])#[A-Za-z][\w-]*/g;

function tokens(text: string): Array<VNode | string> {
  const out: Array<VNode | string> = [];
  for (const t of tokenizeRich(text)) {
    switch (t.kind) {
      case "var":
        out.push(h("span", {
          class: "wp-ai-msg__var", style: { color: `var(--wp-var-${varColorIndex(t.meta?.name ?? "")})` },
        }, t.raw));
        break;
      case "ref": out.push(h("span", { class: "wp-ai-msg__ref" }, t.raw)); break;
      case "dp-brace": out.push(h("span", { class: "wp-ai-msg__pick" }, t.raw)); break;
      case "dp-multi": out.push(h("span", { class: "wp-ai-msg__multi" }, t.raw)); break;
      case "escape": out.push(h("span", { class: "wp-ai-msg__esc" }, t.raw)); break;
      default: out.push(t.raw);
    }
  }
  return out;
}

function syntax(text: string): Array<VNode | string> {
  const out: Array<VNode | string> = [];
  let last = 0;
  for (const m of text.matchAll(EXTRA)) {
    const at = m.index ?? 0;
    if (at > last) out.push(...tokens(text.slice(last, at)));
    const raw = m[0];
    const cls = raw[0] === "#" ? "wp-ai-msg__tag" : raw[0] === "<" ? "wp-ai-msg__lora" : "wp-ai-msg__emb";
    out.push(h("span", { class: cls }, raw));
    last = at + raw.length;
  }
  if (last < text.length) out.push(...tokens(text.slice(last)));
  return out;
}

function inline(nodes: Inline[]): Array<VNode | string> {
  return nodes.flatMap((n) => {
    switch (n.t) {
      case "text": return syntax(n.v);
      case "b": return [h("strong", inline(n.c))];
      case "i": return [h("em", inline(n.c))];
      case "s": return [h("s", inline(n.c))];
      case "code": return [h("code", { class: "wp-ai-msg__code" }, syntax(n.v))];
      case "ref": return [chip(n.v)];
      // Never followed: the text, with the address in a tooltip.
      case "link": return [h("span", { class: "wp-ai-msg__link", title: n.href }, inline(n.c))];
    }
  });
}

const copied = ref<string | null>(null);

function copy(v: string): void {
  void navigator.clipboard?.writeText(v).then(() => {
    copied.value = v;
    setTimeout(() => { if (copied.value === v) copied.value = null; }, 1500);
  });
}

function pre(lang: string, v: string): VNode {
  const done = copied.value === v;
  return h("div", { class: "wp-ai-msg__codeblock" }, [
    h("div", { class: "wp-ai-msg__codehead" }, [
      h("span", lang || "text"),
      h("button", {
        type: "button", class: "wp-ai-msg__copy", "data-test": "ai-msg-copy",
        "aria-label": done ? "Copied" : "Copy code", title: done ? "Copied" : "Copy",
        onClick: () => copy(v),
      }, [h("i", { class: done ? "pi pi-check" : "pi pi-copy", "aria-hidden": "true" })]),
    ]),
    h("pre", { class: "wp-ai-msg__pre" }, syntax(v)),
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

function callout(tone: "tip" | "warn", rest: Inline[]): VNode {
  return h("p", { class: "wp-ai-msg__callout", "data-tone": tone }, [
    h("i", { class: tone === "warn" ? "pi pi-exclamation-triangle" : "pi pi-lightbulb", "aria-hidden": "true" }),
    h("span", inline(rest)),
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
    case "list":
      return b.ordered
        ? h("ol", b.start !== 1 ? { start: b.start } : {}, b.items.map(item))
        : h("ul", b.items.map(item));
    case "pre": return pre(b.lang, b.v);
    case "quote": {
      // "> Tip: …" is a callout too.
      const only = b.blocks.length === 1 && b.blocks[0].t === "p" ? calloutOf(b.blocks[0].c) : null;
      return only ? callout(only.tone, only.rest) : h("blockquote", b.blocks.map(block));
    }
    case "table": return table(b);
    case "hr": return h("hr");
  }
}

const blocks = computed(() => parseMarkdown(props.text));
const Body = () => blocks.value.map(block);
</script>

<template>
  <div class="wp-ai-msg" data-test="ai-msg"><Body /></div>
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
.wp-ai-msg :deep(.wp-ai-msg__var) { font-family: var(--wp-font-mono, ui-monospace, monospace); font-size: 0.95em; font-weight: 500; }
.wp-ai-msg :deep(.wp-ai-msg__ref) { color: var(--wp-accent-text); font-family: var(--wp-font-mono, ui-monospace, monospace); font-size: 0.95em; }
.wp-ai-msg :deep(.wp-ai-msg__pick) { color: var(--wp-warn); font-family: var(--wp-font-mono, ui-monospace, monospace); font-size: 0.95em; }
.wp-ai-msg :deep(.wp-ai-msg__multi) { color: var(--wp-rt-token-good); font-family: var(--wp-font-mono, ui-monospace, monospace); font-size: 0.95em; }
.wp-ai-msg :deep(.wp-ai-msg__esc) { color: var(--wp-text-muted); opacity: 0.75; }
.wp-ai-msg :deep(.wp-ai-msg__lora) { color: var(--wp-var-6); font-family: var(--wp-font-mono, ui-monospace, monospace); font-size: 0.95em; }
.wp-ai-msg :deep(.wp-ai-msg__emb) { color: var(--wp-var-7); font-family: var(--wp-font-mono, ui-monospace, monospace); font-size: 0.95em; }
.wp-ai-msg :deep(.wp-ai-msg__tag) { color: var(--wp-text-muted); font-weight: 500; }
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
.wp-ai-msg :deep(.wp-ai-msg__chip[data-missing]) { cursor: default; color: var(--wp-text-muted); background: transparent; border-color: var(--wp-border); }
.wp-ai-msg :deep(.wp-ai-msg__chip[data-pending]) { cursor: default; border-style: dashed; }
</style>
