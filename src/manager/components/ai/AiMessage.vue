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
import { computed, h, type VNode } from "vue";
import { useRouter } from "vue-router";
import { KIND_ICON_MAP } from "../../../components/shared/kind-icons";
import type { AiChatRef } from "../../api/types";
import { parseMarkdown, type Block, type Inline } from "../../utils/chat-markdown";
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
  const ref = props.refs?.[label];
  if (!ref) return h("span", { class: "wp-ai-msg__chip", "data-missing": "true" }, label);
  const icon = KIND_ICON_MAP[ref.type as keyof typeof KIND_ICON_MAP] ?? "pi pi-circle";
  const route = EDIT_ROUTES[ref.type];
  return h("button", {
    type: "button", class: "wp-ai-msg__chip", "data-test": "ai-msg-chip", "data-kind": ref.type,
    title: `Open ${ref.name}`,
    onClick: () => { if (route) void router.push({ name: route, params: { id: ref.id } }); },
  }, [h("i", { class: icon, "aria-hidden": "true" }), ref.name]);
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
      case "code": return [h("code", { class: "wp-ai-msg__code" }, syntax(n.v))];
      case "ref": return [chip(n.v)];
    }
  });
}

const CALLOUT = /^(tip|note|warning|careful|heads up)\s*:\s*/i;

function block(b: Block): VNode {
  switch (b.t) {
    case "p": {
      const first = b.c[0];
      const m = first?.t === "text" ? CALLOUT.exec(first.v) : null;
      if (first?.t === "text" && m) {
        const tone = /warn|careful/i.test(m[1]) ? "warn" : "tip";
        const rest: Inline[] = [{ t: "text", v: first.v.slice(m[0].length) }, ...b.c.slice(1)];
        return h("p", { class: "wp-ai-msg__callout", "data-tone": tone }, [
          h("i", { class: tone === "warn" ? "pi pi-exclamation-triangle" : "pi pi-lightbulb", "aria-hidden": "true" }),
          h("span", inline(rest)),
        ]);
      }
      return h("p", inline(b.c));
    }
    case "h": return h("p", { class: "wp-ai-msg__h" }, inline(b.c));
    case "ul": case "ol": return h(b.t, b.items.map((it) => h("li", inline(it))));
    case "pre": return h("pre", { class: "wp-ai-msg__pre" }, syntax(b.v));
    case "quote": return h("blockquote", inline(b.c));
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
.wp-ai-msg :deep(ul), .wp-ai-msg :deep(ol) { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 2px; }
.wp-ai-msg :deep(blockquote) { margin: 0; padding-left: 8px; border-left: 2px solid var(--wp-border-strong, var(--wp-border)); color: var(--wp-text-muted); }
.wp-ai-msg :deep(.wp-ai-msg__h) { font-weight: 600; color: var(--wp-text); margin-top: 2px; }
.wp-ai-msg :deep(.wp-ai-msg__code) {
  font-family: var(--wp-font-mono, ui-monospace, monospace); font-size: 12px;
  padding: 0 4px; border-radius: var(--wp-radius-sm); background: var(--wp-bg-3, var(--wp-bg-2));
}
.wp-ai-msg :deep(.wp-ai-msg__pre) {
  margin: 0; padding: 8px; border-radius: var(--wp-radius-sm); background: var(--wp-bg-3, var(--wp-bg-2));
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
</style>
