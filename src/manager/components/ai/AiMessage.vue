<script setup lang="ts">
/**
 * One assistant message: its Markdown (see `utils/chat-markdown.ts`) drawn
 * with plain elements, and [[Name]] mentions as chips that open the item.
 * A mention the server couldn't match to an item stays a plain label.
 */
import { computed, h, type VNode } from "vue";
import { useRouter } from "vue-router";
import { KIND_ICON_MAP } from "../../../components/shared/kind-icons";
import type { AiChatRef } from "../../api/types";
import { parseMarkdown, type Block, type Inline } from "../../utils/chat-markdown";

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

function inline(nodes: Inline[]): Array<VNode | string> {
  return nodes.map((n) => {
    switch (n.t) {
      case "text": return n.v;
      case "b": return h("strong", inline(n.c));
      case "i": return h("em", inline(n.c));
      case "code": return h("code", { class: "wp-ai-msg__code" }, n.v);
      case "ref": return chip(n.v);
    }
  });
}

function block(b: Block): VNode {
  switch (b.t) {
    case "p": return h("p", inline(b.c));
    case "h": return h("p", { class: "wp-ai-msg__h" }, inline(b.c));
    case "ul": case "ol": return h(b.t, b.items.map((it) => h("li", inline(it))));
    case "pre": return h("pre", { class: "wp-ai-msg__pre" }, b.v);
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
  padding: 0 7px; margin: 0 1px; border-radius: 999px; font: inherit; font-size: 12px; line-height: 1.6;
  color: var(--wp-accent-text); cursor: pointer;
  background: color-mix(in oklab, var(--wp-accent-500) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 35%, transparent);
}
.wp-ai-msg :deep(.wp-ai-msg__chip i) { font-size: 10px; }
.wp-ai-msg :deep(.wp-ai-msg__chip:hover) { background: color-mix(in oklab, var(--wp-accent-500) 22%, transparent); }
.wp-ai-msg :deep(.wp-ai-msg__chip[data-missing]) { cursor: default; color: var(--wp-text-muted); background: transparent; border-color: var(--wp-border); }
</style>
