<script setup lang="ts">
/**
 * AiChatDrawer — the assistant chat, docked on the right of the manager.
 *
 * The model reads the library with tools and answers; anything it would
 * change comes back as a proposal card. Apply saves it through the stores,
 * Undo puts back what it replaced, Dismiss tells the model the user said
 * no. State lives in `useAiChat`, so closing the drawer keeps the chat.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "../ui/Button.vue";
import { useAiChat, type ChatAssistantEntry } from "../../composables/useAiChat";
import { useAiConfig } from "../../composables/useAiConfig";
import type { AiChatProposal } from "../../api/types";

const EDIT_ROUTES: Record<string, string> = {
  wildcard: "wildcards-edit",
  combine: "combines-edit",
  derivation: "derivations-edit",
  constraint: "constraints-edit",
  fixed_values: "fixed-values-edit",
  bundle: "bundles-edit",
};
const PREVIEW_LINES = 6;
const SUGGESTIONS = [
  "What does my library set up for characters?",
  "Make a wildcard of weather with tags for warm and cold",
  "Which wildcards have no description? Write them one",
];

const chat = useAiChat();
const { config } = useAiConfig();
const route = useRoute();
const router = useRouter();
const scroller = ref<HTMLElement | null>(null);
const box = ref<HTMLTextAreaElement | null>(null);
const expanded = ref(new Set<string>());

const modelLabel = computed(() => config.value?.model ?? "");
const isLocal = computed(() => {
  const c = config.value;
  return c ? c.presets[c.provider].local : true;
});

function page(): { route: string; id?: string } {
  const id = route.params.id;
  return {
    route: String(route.name ?? route.path),
    ...(typeof id === "string" && id ? { id } : {}),
  };
}

function send(): void {
  void chat.send(page());
}

function suggest(text: string): void {
  chat.input.value = text;
  box.value?.focus();
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
    ev.preventDefault();
    send();
  } else if (ev.key === "Escape") {
    chat.open.value = false;
  }
}

function key(i: number, p: AiChatProposal): string {
  return `${i}:${p.pid}`;
}

function preview(i: number, p: AiChatProposal): string[] {
  return expanded.value.has(key(i, p)) ? p.preview : p.preview.slice(0, PREVIEW_LINES);
}

function toggle(i: number, p: AiChatProposal): void {
  const k = key(i, p);
  const next = new Set(expanded.value);
  if (next.has(k)) next.delete(k);
  else next.add(k);
  expanded.value = next;
}

/** The editor route for a proposal's item, once there is an item. */
function target(entry: ChatAssistantEntry, p: AiChatProposal): { name: string; id: string } | null {
  const op = p.op;
  if (op.op === "create") {
    const id = entry.created[p.pid];
    return id ? { name: EDIT_ROUTES[op.body.type] ?? "", id } : null;
  }
  return { name: EDIT_ROUTES[op.type] ?? "", id: op.id };
}

function openItem(entry: ChatAssistantEntry, p: AiChatProposal): void {
  const t = target(entry, p);
  if (t?.name) void router.push({ name: t.name, params: { id: t.id } });
}

function scrollDown(): void {
  void nextTick(() => {
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

watch(() => [chat.entries.value.length, chat.loading.value], scrollDown);

function onGlobalKey(ev: KeyboardEvent): void {
  if (ev.key === "Escape" && chat.open.value && !chat.loading.value) chat.open.value = false;
}
onMounted(() => {
  scrollDown();
  void nextTick(() => box.value?.focus());
  window.addEventListener("keydown", onGlobalKey);
});
onBeforeUnmount(() => window.removeEventListener("keydown", onGlobalKey));
</script>

<template>
  <aside class="wp-ai-chat" role="dialog" aria-label="AI assistant" data-test="ai-chat">
    <header class="wp-ai-chat__head">
      <span class="wp-ai-chat__title"><i class="pi pi-microchip-ai" aria-hidden="true" /> Assistant</span>
      <span
        class="wp-ai-chat__model"
        :data-local="isLocal ? 'true' : 'false'"
        :title="isLocal ? 'Runs on your machine' : 'Sent to a cloud provider'"
      >{{ modelLabel }}</span>
      <span class="wp-ai-chat__spacer" />
      <Button
        variant="ghost"
        size="sm"
        icon="pi-plus"
        :disabled="!chat.started.value && !chat.loading.value"
        data-test="ai-chat-new"
        title="Start a new chat"
        @click="chat.reset"
      >New chat</Button>
      <button
        type="button"
        class="wp-ai-chat__close"
        aria-label="Close the assistant"
        data-test="ai-chat-close"
        @click="chat.open.value = false"
      ><i class="pi pi-times" aria-hidden="true" /></button>
    </header>

    <div ref="scroller" class="wp-ai-chat__body" data-test="ai-chat-body">
      <div v-if="!chat.started.value" class="wp-ai-chat__empty" data-test="ai-chat-empty">
        <p>Ask about your library, or ask for a change. The assistant reads what you have and proposes changes as cards; nothing is saved until you press Apply.</p>
        <button
          v-for="s in SUGGESTIONS"
          :key="s"
          type="button"
          class="wp-ai-chat__suggestion"
          data-test="ai-chat-suggestion"
          @click="suggest(s)"
        >{{ s }}</button>
      </div>

      <template v-for="(entry, i) in chat.entries.value" :key="i">
        <div v-if="entry.role === 'user'" class="wp-ai-chat__user" data-test="ai-chat-user">{{ entry.text }}</div>
        <div v-else class="wp-ai-chat__reply" data-test="ai-chat-reply">
          <ul v-if="entry.result.steps.length" class="wp-ai-chat__steps" data-test="ai-chat-steps">
            <li v-for="(s, j) in entry.result.steps" :key="j" :data-ok="s.ok ? 'true' : 'false'">
              <i :class="['pi', s.ok ? 'pi-check' : 'pi-exclamation-circle']" aria-hidden="true" />
              {{ s.note }}
            </li>
          </ul>
          <p class="wp-ai-chat__text">{{ entry.result.message }}</p>

          <article
            v-for="p in entry.result.proposals"
            :key="p.pid"
            class="wp-ai-chat__card"
            :data-status="entry.status[p.pid] ?? 'pending'"
            data-test="ai-chat-proposal"
          >
            <div class="wp-ai-chat__card-head">
              <span class="wp-ai-chat__card-title">{{ p.title }}</span>
              <span class="wp-ai-chat__card-summary">{{ p.summary }}</span>
            </div>
            <ul v-if="p.preview.length" class="wp-ai-chat__preview">
              <li v-for="(line, j) in preview(i, p)" :key="j">{{ line }}</li>
            </ul>
            <button
              v-if="p.preview.length > PREVIEW_LINES"
              type="button"
              class="wp-ai-chat__more"
              data-test="ai-chat-more"
              @click="toggle(i, p)"
            >{{ expanded.has(key(i, p)) ? "Show less" : `Show all ${p.preview.length}` }}</button>
            <ul v-if="p.warnings.length" class="wp-ai-chat__warnings">
              <li v-for="(w, j) in p.warnings" :key="j"><i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ w }}</li>
            </ul>
            <p v-if="entry.errors[p.pid]" class="wp-ai-chat__error" role="alert">{{ entry.errors[p.pid] }}</p>
            <div class="wp-ai-chat__actions">
              <template v-if="p.op.op === 'open'">
                <Button size="sm" icon="pi-arrow-up-right" data-test="ai-chat-open" @click="openItem(entry, p)">Open</Button>
              </template>
              <template v-else-if="entry.status[p.pid] === 'applied'">
                <span class="wp-ai-chat__done"><i class="pi pi-check" aria-hidden="true" /> Applied</span>
                <Button variant="ghost" size="sm" data-test="ai-chat-undo" @click="chat.undo(entry, p)">Undo</Button>
                <Button v-if="target(entry, p)?.name" variant="ghost" size="sm" icon="pi-arrow-up-right" data-test="ai-chat-open" @click="openItem(entry, p)">Open</Button>
              </template>
              <template v-else-if="entry.status[p.pid] === 'dismissed'">
                <span class="wp-ai-chat__dismissed">Dismissed</span>
              </template>
              <template v-else>
                <span v-if="chat.blockedReason(entry, p)" class="wp-ai-chat__blocked">{{ chat.blockedReason(entry, p) }}</span>
                <Button variant="ghost" size="sm" data-test="ai-chat-dismiss" @click="chat.dismiss(entry, p)">Dismiss</Button>
                <Button
                  variant="primary"
                  size="sm"
                  icon="pi-check"
                  :disabled="!!chat.blockedReason(entry, p)"
                  data-test="ai-chat-apply"
                  @click="chat.apply(entry, p)"
                >Apply</Button>
              </template>
            </div>
          </article>
        </div>
      </template>

      <p v-if="chat.loading.value" class="wp-ai-chat__status" role="status" data-test="ai-chat-loading">
        <i class="pi pi-spin pi-spinner" aria-hidden="true" /> Working… it may read a few items first.
      </p>
    </div>

    <footer class="wp-ai-chat__foot">
      <p v-if="chat.error.value" class="wp-ai-chat__error" role="alert" data-test="ai-chat-error">{{ chat.error.value }}</p>
      <textarea
        ref="box"
        v-model="chat.input.value"
        class="wp-textarea wp-ai-chat__input"
        rows="2"
        placeholder="Ask or ask for a change…"
        aria-label="Message the assistant"
        data-test="ai-chat-input"
        :disabled="chat.loading.value"
        @keydown="onKeydown"
      ></textarea>
      <div class="wp-ai-chat__controls">
        <span class="wp-ai-chat__hint">Enter sends, Shift+Enter starts a new line. Changes wait for your Apply.</span>
        <Button v-if="chat.loading.value" size="sm" icon="pi-stop" data-test="ai-chat-stop" @click="chat.stop">Stop</Button>
        <Button
          v-else
          variant="primary"
          size="sm"
          icon="pi-send"
          :disabled="!chat.input.value.trim()"
          data-test="ai-chat-send"
          @click="send"
        >Send</Button>
      </div>
    </footer>
  </aside>
</template>

<style scoped>
.wp-ai-chat {
  position: fixed;
  top: var(--wp-topbar-h, 48px);
  right: 0;
  bottom: 0;
  z-index: 50;
  width: min(440px, 100vw);
  display: flex;
  flex-direction: column;
  background: var(--wp-bg-1);
  border-left: 1px solid var(--wp-border);
  box-shadow: -8px 0 24px rgb(0 0 0 / 0.25);
}
.wp-ai-chat__head {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-bottom: 1px solid var(--wp-border);
}
.wp-ai-chat__title { font-weight: 600; color: var(--wp-accent-text); display: inline-flex; gap: 6px; align-items: center; }
.wp-ai-chat__model {
  font-family: var(--wp-font-mono, monospace); font-size: 11px; padding: 1px 7px; border-radius: 5px;
  color: var(--wp-warn); border: 1px solid color-mix(in oklab, var(--wp-warn) 45%, transparent);
  max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wp-ai-chat__model[data-local="true"] { color: var(--wp-success); border-color: color-mix(in oklab, var(--wp-success) 45%, transparent); }
.wp-ai-chat__spacer { flex: 1; }
.wp-ai-chat__close {
  display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
  border: 0; border-radius: 6px; background: none; color: var(--wp-text-muted); cursor: pointer;
}
.wp-ai-chat__close:hover { color: var(--wp-text); background: var(--wp-bg-2); }
.wp-ai-chat__body {
  flex: 1; overflow-y: auto; overscroll-behavior: contain;
  padding: 14px 12px; display: flex; flex-direction: column; gap: 12px;
}
.wp-ai-chat__empty { display: flex; flex-direction: column; gap: 8px; color: var(--wp-text-muted); font-size: 13px; }
.wp-ai-chat__empty p { margin: 0 0 4px; }
.wp-ai-chat__suggestion {
  text-align: left; padding: 8px 10px; border-radius: 8px; cursor: pointer; font-size: 13px;
  border: 1px solid var(--wp-border); background: var(--wp-bg-2); color: var(--wp-text);
}
.wp-ai-chat__suggestion:hover { border-color: var(--wp-accent-400); }
.wp-ai-chat__user {
  align-self: flex-end; max-width: 85%; padding: 8px 11px; border-radius: 10px 10px 2px 10px;
  background: color-mix(in oklab, var(--wp-accent-500) 18%, var(--wp-bg-2));
  white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px;
}
.wp-ai-chat__reply { display: flex; flex-direction: column; gap: 8px; }
.wp-ai-chat__steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.wp-ai-chat__steps li { font-size: 11px; color: var(--wp-text-dim); display: flex; gap: 6px; align-items: baseline; overflow-wrap: anywhere; }
.wp-ai-chat__steps li[data-ok="false"] { color: var(--wp-warn); }
.wp-ai-chat__steps .pi { font-size: 10px; }
.wp-ai-chat__text { margin: 0; font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
.wp-ai-chat__card {
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 35%, var(--wp-border));
  border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 6px;
  background: color-mix(in oklab, var(--wp-accent-500) 4%, var(--wp-bg-2));
}
.wp-ai-chat__card[data-status="applied"] { border-color: color-mix(in oklab, var(--wp-success) 50%, var(--wp-border)); }
.wp-ai-chat__card[data-status="dismissed"] { opacity: 0.6; }
.wp-ai-chat__card[data-status="failed"] { border-color: color-mix(in oklab, var(--wp-danger) 50%, var(--wp-border)); }
.wp-ai-chat__card-head { display: flex; flex-direction: column; gap: 1px; }
.wp-ai-chat__card-title { font-weight: 600; font-size: 13px; }
.wp-ai-chat__card-summary { font-size: 12px; color: var(--wp-text-muted); }
.wp-ai-chat__preview {
  margin: 0; padding: 6px 8px 6px 22px; font-size: 12px; border-radius: 6px;
  background: var(--wp-bg-1); display: flex; flex-direction: column; gap: 2px; overflow-wrap: anywhere;
}
.wp-ai-chat__more { align-self: flex-start; border: 0; background: none; padding: 0; font-size: 12px; color: var(--wp-accent-text); cursor: pointer; }
.wp-ai-chat__warnings { list-style: none; margin: 0; padding: 0; font-size: 12px; color: var(--wp-warn); display: flex; flex-direction: column; gap: 2px; }
.wp-ai-chat__actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.wp-ai-chat__done { font-size: 12px; color: var(--wp-success); margin-right: auto; display: inline-flex; gap: 5px; align-items: center; }
.wp-ai-chat__dismissed, .wp-ai-chat__blocked { font-size: 12px; color: var(--wp-text-muted); margin-right: auto; }
.wp-ai-chat__status { margin: 0; font-size: 12px; color: var(--wp-text-muted); display: flex; gap: 6px; align-items: center; }
.wp-ai-chat__foot { border-top: 1px solid var(--wp-border); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.wp-ai-chat__input { width: 100%; resize: vertical; font-size: 13px; max-height: 40vh; }
.wp-ai-chat__controls { display: flex; align-items: center; gap: 10px; }
.wp-ai-chat__hint { flex: 1; font-size: 11px; color: var(--wp-text-dim); }
.wp-ai-chat__error { margin: 0; font-size: 12px; color: var(--wp-danger); }
</style>
