<script setup lang="ts">
/**
 * AiChatDrawer — the assistant chat, docked on the right of the manager.
 *
 * The model reads the library and the docs with tools and answers; anything
 * it would change comes back as a proposal card. Apply saves it through the
 * stores (or puts it into the open editor, when it was built on that
 * editor's unsaved version), Undo puts back what it replaced, Dismiss tells
 * the model the user said no. Each message carries what's on screen: the
 * route, the open editor's item, the docs page and the view's own note.
 * State lives in `useAiChat`, so closing the drawer keeps the chat.
 *
 * Page tools (open, point at, hand work to a page) run while the drawer is
 * open, through the router it hands to `useAiChat.attach`. A web search the
 * model asks for shows its exact query with Allow once / Allow for this
 * chat / Deny; nothing leaves the machine before the user picks.
 *
 * Chats opens the stored chats (`AiChatList`); the answer being written
 * shows as it streams in; Try again runs the last message again; the meter
 * under the box says how full the model's window is, with Compact to
 * summarise older turns.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { isNavigationFailure, useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import Button from "../ui/Button.vue";
import Select, { type SelectOption } from "../ui/Select.vue";
import { api } from "../../api/client";
import AiMessage from "./AiMessage.vue";
import AiPointer from "./AiPointer.vue";
import AiChatList from "./AiChatList.vue";
import { useAiChat, type ChatAssistantEntry, type SearchApproval } from "../../composables/useAiChat";
import { clearPointer, EDIT_ROUTES } from "../../composables/useAiActions";
import { useAiConfig } from "../../composables/useAiConfig";
import { useAiChatWidth } from "../../composables/useAiChatWidth";
import type { AiChatPage, AiChatProposal, AiPendingCall } from "../../api/types";
import { currentPageNote, openEditor } from "../../composables/useOpenEditor";
import { usePackBuilder } from "../../composables/usePackBuilder";

const PREVIEW_LINES = 6;
const SUGGESTIONS = [
  "What does my library set up for characters?",
  "Make a wildcard of weather with tags for warm and cold",
  "How do constraints work?",
];
const DOC_SUGGESTIONS = [
  "Explain this page in simpler words",
  "Show me a small example of this",
];
const TEST_SUGGESTIONS = [
  "Explain this run",
  "Why do I never get some of these options?",
];
const EDITOR_SUGGESTIONS = [
  "What could make this better?",
  "Remove options that repeat each other",
];

const chat = useAiChat();
const { config, save: saveConfig } = useAiConfig();
const route = useRoute();
const router = useRouter();
const scroller = ref<HTMLElement | null>(null);
const box = ref<HTMLTextAreaElement | null>(null);
const expanded = ref(new Set<string>());
const size = useAiChatWidth();

const modelLabel = computed(() => config.value?.model ?? "");
const isLocal = computed(() => {
  const c = config.value;
  return c ? c.presets[c.provider].local : true;
});

/* ── Model picker ── */

/** Names that look like embedding models: they can't chat. */
const EMBED_NAME = /embed|bge|minilm|e5-|gte-|nomic|arctic/i;
const models = ref<string[]>([]);
/** A line under the header after the model changed (or failed to). */
const modelNote = ref("");
const modelOptions = computed<SelectOption[]>(() => {
  const names = models.value.filter((m) => !EMBED_NAME.test(m));
  const cur = modelLabel.value;
  if (cur && !names.includes(cur)) names.unshift(cur);
  const dot = isLocal.value ? "var(--wp-success)" : "var(--wp-warn)";
  return names.map((m) => ({ value: m, label: m, dot }));
});

async function loadModels(): Promise<void> {
  try {
    models.value = (await api.ai.models()).models;
  } catch {
    models.value = []; // the picker still shows the current model
  }
}

async function pickModel(v: string | number | null): Promise<void> {
  if (typeof v !== "string" || !v || v === modelLabel.value || chat.loading.value) return;
  try {
    await saveConfig({ model: v });
    // The provider's cache holds this chat for the old model only.
    modelNote.value = chat.started.value
      ? `Now using ${v}. Its next answer reads this chat again from the start, so it may take longer. Start a new chat if it struggles.`
      : "";
  } catch (err) {
    modelNote.value = `Couldn't switch the model: ${err instanceof Error ? err.message : String(err)}`;
  }
}

watch(() => chat.entries.value.length, () => { modelNote.value = ""; });

/* ── Stored chats ── */

const showList = ref(false);

async function pickChat(id: string): Promise<void> {
  showList.value = false;
  if (id === chat.chatId.value) return;
  try {
    await chat.load(id);
    scrollDown();
  } catch (err) {
    chat.error.value = `Couldn't open that chat: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function onDeleted(id: string): void {
  if (id === chat.chatId.value) chat.reset();
}

function newChat(): void {
  showList.value = false;
  chat.reset();
}

/* ── Retry, the live answer, the meter ── */

const canRetry = computed(() => {
  const last = chat.entries.value[chat.entries.value.length - 1];
  return !chat.loading.value && last?.role === "assistant" && !!chat.chatId.value;
});

function retry(): void {
  void chat.retry(page());
}

const liveStatus = computed(() => {
  const l = chat.live.value;
  if (chat.running.value) return `${chat.running.value}…`;
  if (l.status) return `${l.status}…`;
  if (l.text) return "Writing…";
  if (l.thinking) return "Thinking…";
  return "Working… it may read a few items first.";
});

/** Compact is offered from here; amber from where it happens by itself. */
const OFFER_COMPACT = 0.5;
const AUTO_COMPACT = 0.75;

function short(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

const meter = computed(() => {
  const c = chat.context.value;
  if (!c || !c.window) return null;
  const ratio = Math.min(1, c.used / c.window);
  const label = `${c.estimated ? "~" : ""}${short(c.used)} of ${c.about ? "about " : ""}${short(c.window)} tokens`;
  const why = [
    `The last request used ${c.used.toLocaleString()} tokens${c.estimated ? " (estimated)" : ""}`,
    `of the ${c.window.toLocaleString()} the model holds${c.about ? " (a cloud model's usual size)" : ""}.`,
    `Past ${Math.round(AUTO_COMPACT * 100)}% the older messages are summarised to make room.`,
    c.compactions ? `Summarised ${c.compactions === 1 ? "once" : `${c.compactions} times`} so far.` : "",
  ].filter(Boolean).join(" ");
  return { ratio, label, why, high: ratio >= AUTO_COMPACT, offer: ratio >= OFFER_COMPACT };
});

async function compact(): Promise<void> {
  const err = await chat.compact();
  chat.error.value = err ? `Couldn't summarise: ${err}` : "";
}

const suggestions = computed(() => {
  if (route.name === "documentation-page") return DOC_SUGGESTIONS;
  if (route.name === "test") return TEST_SUGGESTIONS;
  if (typeof route.params.id === "string" && route.params.id) return EDITOR_SUGGESTIONS;
  return SUGGESTIONS;
});

function page(): AiChatPage {
  const id = route.params.id;
  const out: AiChatPage = { route: String(route.name ?? route.path) };
  if (typeof id === "string" && id) out.id = id;
  const doc = route.params.page;
  if (route.name === "documentation-page" && typeof doc === "string" && doc) out.doc = doc;
  if (route.name === "settings" && typeof route.params.section === "string") {
    out.note = `Settings › ${route.params.section || "general"}`;
  }
  const note = currentPageNote();
  if (note) out.note = note;
  const ed = openEditor();
  if (ed && ed.id === out.id) out.editor = ed.read();
  return out;
}

function send(): void {
  showList.value = false;
  void chat.send(page());
}

chat.attach({
  page,
  hasRoute: (name) => router.hasRoute(name),
  navigate: async (to) => {
    const failure = await router.push(to);
    return !isNavigationFailure(failure);
  },
});
onBeforeUnmount(() => chat.attach(null));
watch(() => route.fullPath, () => clearPointer());

type SearchCall = Extract<AiPendingCall, { tool: "web_search" }>;

function searches(entry: ChatAssistantEntry): SearchCall[] {
  return (entry.result.pending ?? []).filter((c): c is SearchCall => c.tool === "web_search");
}

const ANSWERED: Record<SearchApproval, string> = {
  once: "Allowed",
  chat: "Allowed for this chat",
  deny: "Declined",
};

// A page asked a question (`chat.ask`): send it once the drawer is here.
watch(chat.queued, (text) => {
  if (!text) return;
  chat.queued.value = "";
  if (chat.input.value.trim() === text.trim()) send();
}, { immediate: true });

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

/** Where a proposal's Open button goes: the item's editor (once there is
 *  an item), a docs page or a manager page. */
function target(entry: ChatAssistantEntry, p: AiChatProposal): RouteLocationRaw | null {
  const op = p.op;
  if (op.op === "create") {
    const id = entry.created[p.pid];
    const name = EDIT_ROUTES[op.kind === "module" ? op.body.type : op.kind];
    return id && name ? { name, params: { id } } : null;
  }
  if (op.op === "open" && op.kind === "doc") {
    return { name: "documentation-page", params: { page: op.id } };
  }
  if (op.op === "open" && op.kind === "pack") return { name: "pack-builder" };
  if (op.op === "open" && op.kind === "page") {
    return op.id === "settings"
      ? { name: "settings", params: { section: op.section ?? "" } }
      : { name: op.id };
  }
  const name = EDIT_ROUTES[op.type];
  return name ? { name, params: { id: op.id } } : null;
}

function openItem(entry: ChatAssistantEntry, p: AiChatProposal): void {
  const op = p.op;
  if (op.op === "open" && op.kind === "pack") {
    planPack(op.description);
    return;
  }
  const t = target(entry, p);
  if (t) void router.push(t);
}

/** Put the description in the Pack builder and plan it. A plan already
 *  there is kept: the text goes into its box for the user to send. */
function planPack(description: string): void {
  const pb = usePackBuilder();
  const fresh = pb.phase.value === "plan" && !pb.plan.value && !pb.convo.loading.value;
  pb.convo.instruction.value = description;
  void router.push({ name: "pack-builder" });
  if (fresh) void pb.askPlan();
}

function openLabel(p: AiChatProposal): string {
  const op = p.op;
  if (op.op !== "open") return "Open";
  return op.kind === "doc" ? "Open the docs" : op.kind === "page" ? "Go there"
    : op.kind === "pack" ? "Plan it" : "Open";
}

function toEditor(p: AiChatProposal): boolean {
  return p.op.op === "update" && p.op.basis === "editor";
}

function scrollDown(): void {
  void nextTick(() => {
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

watch(() => [chat.entries.value.length, chat.loading.value, chat.live.value], scrollDown);

function onGlobalKey(ev: KeyboardEvent): void {
  if (ev.key === "Escape" && chat.open.value && !chat.loading.value) chat.open.value = false;
}
onMounted(() => {
  void loadModels();
  scrollDown();
  void nextTick(() => box.value?.focus());
  window.addEventListener("keydown", onGlobalKey);
});
onBeforeUnmount(() => window.removeEventListener("keydown", onGlobalKey));
</script>

<template>
  <aside class="wp-ai-chat" role="dialog" aria-label="AI assistant" data-test="ai-chat" :data-resizing="size.dragging.value || undefined">
    <AiPointer />
    <div
      class="wp-ai-chat__grip"
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      aria-label="Resize the assistant"
      aria-controls="wp-ai-chat-body"
      :aria-valuenow="size.width.value"
      :aria-valuemin="size.min"
      :aria-valuemax="size.max.value"
      title="Drag to resize, double-click to reset"
      data-test="ai-chat-grip"
      @pointerdown="size.startDrag"
      @keydown="size.onKey"
      @dblclick="size.reset"
    />
    <header class="wp-ai-chat__head">
      <span class="wp-ai-chat__title"><i class="pi pi-microchip-ai" aria-hidden="true" /> Assistant</span>
      <span
        class="wp-ai-chat__model"
        :data-local="isLocal ? 'true' : 'false'"
        :title="`${modelLabel} · ${isLocal ? 'runs on your machine' : 'sent to a cloud provider'}`"
        data-test="ai-chat-model"
      >
        <Select
          :model-value="modelLabel"
          :options="modelOptions"
          size="sm"
          :disabled="chat.loading.value"
          :aria-label="`Model: ${modelLabel}`"
          @update:model-value="pickModel"
        />
      </span>
      <span class="wp-ai-chat__spacer" />
      <Button
        variant="ghost"
        size="sm"
        icon="pi-comments"
        :aria-pressed="showList"
        :disabled="chat.loading.value"
        data-test="ai-chat-list"
        title="Your saved chats"
        @click="showList = !showList"
      >Chats</Button>
      <Button
        variant="ghost"
        size="sm"
        icon="pi-plus"
        :disabled="!chat.started.value && !chat.loading.value && !showList"
        data-test="ai-chat-new"
        title="Start a new chat"
        @click="newChat"
      >New chat</Button>
      <button
        type="button"
        class="wp-ai-chat__close"
        aria-label="Close the assistant"
        data-test="ai-chat-close"
        @click="chat.open.value = false"
      ><i class="pi pi-times" aria-hidden="true" /></button>
    </header>
    <p v-if="modelNote" class="wp-ai-chat__model-note" role="status" data-test="ai-chat-model-note">{{ modelNote }}</p>

    <div v-if="showList" class="wp-ai-chat__body" data-test="ai-chat-list-view">
      <AiChatList :current="chat.chatId.value" @pick="pickChat" @deleted="onDeleted" />
    </div>
    <div v-show="!showList" id="wp-ai-chat-body" ref="scroller" class="wp-ai-chat__body" data-test="ai-chat-body">
      <div v-if="!chat.started.value" class="wp-ai-chat__empty" data-test="ai-chat-empty">
        <p>Ask about your library, or ask for a change. The assistant reads what you have and proposes changes as cards; nothing is saved until you press Apply.</p>
        <button
          v-for="s in suggestions"
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
          <AiMessage :text="entry.result.message" :refs="entry.result.refs" />

          <article
            v-for="c in searches(entry)"
            :key="c.id"
            class="wp-ai-chat__card wp-ai-chat__search"
            data-test="ai-chat-search"
          >
            <div class="wp-ai-chat__card-head">
              <span class="wp-ai-chat__card-title"><i class="pi pi-globe" aria-hidden="true" /> Search the web?</span>
              <span class="wp-ai-chat__card-summary">Only this text goes to your search engine. Results come back as short snippets.</span>
            </div>
            <p class="wp-ai-chat__query" data-test="ai-chat-search-query">{{ c.args.query }}</p>
            <div class="wp-ai-chat__actions">
              <template v-if="chat.asking.value.has(c.id)">
                <Button variant="ghost" size="sm" data-test="ai-chat-search-deny" @click="chat.answerSearch(c.id, 'deny')">Deny</Button>
                <Button variant="secondary" size="sm" data-test="ai-chat-search-chat" @click="chat.answerSearch(c.id, 'chat')">Allow for this chat</Button>
                <Button variant="primary" size="sm" icon="pi-check" data-test="ai-chat-search-once" @click="chat.answerSearch(c.id, 'once')">Allow once</Button>
              </template>
              <span v-else-if="entry.approved?.[c.id]" :class="entry.approved[c.id] === 'deny' ? 'wp-ai-chat__dismissed' : 'wp-ai-chat__done'">{{ ANSWERED[entry.approved[c.id]] }}</span>
              <span v-else class="wp-ai-chat__dismissed">Not answered</span>
            </div>
          </article>

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
                <Button size="sm" icon="pi-arrow-up-right" data-test="ai-chat-open" @click="openItem(entry, p)">{{ openLabel(p) }}</Button>
              </template>
              <template v-else-if="entry.status[p.pid] === 'applied'">
                <span class="wp-ai-chat__done"><i class="pi pi-check" aria-hidden="true" /> Applied</span>
                <Button variant="ghost" size="sm" data-test="ai-chat-undo" @click="chat.undo(entry, p)">Undo</Button>
                <Button v-if="target(entry, p)" variant="ghost" size="sm" icon="pi-arrow-up-right" data-test="ai-chat-open" @click="openItem(entry, p)">Open</Button>
              </template>
              <template v-else-if="entry.status[p.pid] === 'editor'">
                <span class="wp-ai-chat__done" data-test="ai-chat-in-editor"><i class="pi pi-check" aria-hidden="true" /> In the editor. Save there to keep it.</span>
                <Button variant="ghost" size="sm" data-test="ai-chat-undo" @click="chat.undo(entry, p)">Undo</Button>
              </template>
              <template v-else-if="entry.status[p.pid] === 'dismissed'">
                <span class="wp-ai-chat__dismissed">Dismissed</span>
              </template>
              <template v-else>
                <span v-if="chat.blockedReason(entry, p)" class="wp-ai-chat__blocked">{{ chat.blockedReason(entry, p) }}</span>
                <span v-else-if="toEditor(p)" class="wp-ai-chat__blocked">Goes into the open editor</span>
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

      <div v-if="canRetry" class="wp-ai-chat__again">
        <Button
          variant="ghost"
          size="sm"
          icon="pi-refresh"
          :disabled="!!chat.retryBlocked()"
          :title="chat.retryBlocked() || 'Ask the same message again for a new answer'"
          data-test="ai-chat-retry"
          @click="retry"
        >Try again</Button>
      </div>

      <div v-if="chat.loading.value && !chat.asking.value.size" class="wp-ai-chat__reply wp-ai-chat__live" data-test="ai-chat-live">
        <ul v-if="chat.live.value.steps.length" class="wp-ai-chat__steps">
          <li v-for="(s, j) in chat.live.value.steps" :key="j" :data-ok="s.ok ? 'true' : 'false'">
            <i :class="['pi', s.ok ? 'pi-check' : 'pi-exclamation-circle']" aria-hidden="true" />
            {{ s.note }}
          </li>
        </ul>
        <AiMessage v-if="chat.live.value.text" :text="chat.live.value.text" />
        <p class="wp-ai-chat__status" role="status" data-test="ai-chat-loading">
          <i class="pi pi-spin pi-spinner" aria-hidden="true" />
          {{ liveStatus }}
        </p>
      </div>
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
        <span v-if="meter && chat.started.value" class="wp-ai-chat__meter" :data-high="meter.high || undefined" :title="meter.why" data-test="ai-chat-meter">
          <span
            class="wp-ai-chat__meter-bar"
            role="meter"
            aria-label="Context used"
            :aria-valuenow="Math.round(meter.ratio * 100)"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuetext="meter.label"
          ><span :style="{ width: `${Math.max(2, meter.ratio * 100)}%` }" /></span>
          <span class="wp-ai-chat__meter-label">{{ meter.label }}</span>
          <button
            v-if="meter.offer && !chat.loading.value"
            type="button"
            class="wp-ai-chat__compact"
            :disabled="chat.compacting.value"
            data-test="ai-chat-compact"
            title="Summarise the older messages now to make room"
            @click="compact"
          >{{ chat.compacting.value ? "Summarising…" : "Compact" }}</button>
        </span>
        <span v-else class="wp-ai-chat__hint">Enter sends, Shift+Enter starts a new line. Changes wait for your Apply.</span>
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
  width: min(var(--wp-ai-chat-w, 440px), 100vw);
  display: flex;
  flex-direction: column;
  background: var(--wp-bg-1);
  border-left: 1px solid var(--wp-border);
  box-shadow: -8px 0 24px rgb(0 0 0 / 0.25);
}
/* The left edge: a splitter the user drags or moves with the arrow keys. */
.wp-ai-chat__grip {
  position: absolute; top: 0; bottom: 0; left: -4px; width: 8px; z-index: 1;
  cursor: col-resize; touch-action: none;
}
.wp-ai-chat__grip::after {
  content: ""; position: absolute; top: 0; bottom: 0; left: 3px; width: 2px;
  background: transparent; transition: background 120ms;
}
.wp-ai-chat__grip:hover::after, .wp-ai-chat[data-resizing] .wp-ai-chat__grip::after { background: var(--wp-accent-500); }
.wp-ai-chat__grip:focus-visible { outline: none; }
.wp-ai-chat__grip:focus-visible::after { background: var(--wp-accent-500); width: 3px; }
.wp-ai-chat[data-resizing] { user-select: none; }
@media (max-width: 639px) {
  .wp-ai-chat { width: 100vw; }
  .wp-ai-chat__grip { display: none; }
}
.wp-ai-chat__head {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-bottom: 1px solid var(--wp-border);
}
.wp-ai-chat__title { font-weight: 600; color: var(--wp-accent-text); display: inline-flex; gap: 6px; align-items: center; }
.wp-ai-chat__model { min-width: 0; flex: 0 1 220px; }
.wp-ai-chat__model :deep(.wp-select) { width: 100%; }
.wp-ai-chat__model :deep(button) { font-family: var(--wp-font-mono, monospace); font-size: 11px; }
.wp-ai-chat__model-note {
  margin: 0; padding: 6px 12px; font-size: 12px; color: var(--wp-text-muted);
  border-bottom: 1px solid var(--wp-border); background: var(--wp-bg-2);
}
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
.wp-ai-chat__card {
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 35%, var(--wp-border));
  border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 6px;
  background: color-mix(in oklab, var(--wp-accent-500) 4%, var(--wp-bg-2));
}
.wp-ai-chat__card[data-status="applied"], .wp-ai-chat__card[data-status="editor"] { border-color: color-mix(in oklab, var(--wp-success) 50%, var(--wp-border)); }
.wp-ai-chat__card[data-status="dismissed"] { opacity: 0.6; }
.wp-ai-chat__card[data-status="failed"] { border-color: color-mix(in oklab, var(--wp-danger) 50%, var(--wp-border)); }
.wp-ai-chat__card-head { display: flex; flex-direction: column; gap: 1px; }
.wp-ai-chat__card-title { font-weight: 600; font-size: 13px; }
.wp-ai-chat__card-summary { font-size: 12px; color: var(--wp-text-muted); }
.wp-ai-chat__preview {
  margin: 0; padding: 6px 8px 6px 22px; font-size: 12px; border-radius: 6px;
  background: var(--wp-bg-1); display: flex; flex-direction: column; gap: 2px; overflow-wrap: anywhere;
}
.wp-ai-chat__query {
  margin: 0; padding: 6px 8px; border-radius: 6px; background: var(--wp-bg-1);
  font-family: var(--wp-font-mono, monospace); font-size: 12px; overflow-wrap: anywhere;
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
.wp-ai-chat__again { display: flex; justify-content: flex-start; margin-top: -6px; }
.wp-ai-chat__live :deep(.wp-ai-msg) { opacity: 0.92; }
.wp-ai-chat__meter {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px;
  font-size: 11px; color: var(--wp-text-dim);
}
.wp-ai-chat__meter-bar {
  flex: 0 0 72px; height: 5px; border-radius: 3px; overflow: hidden; background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
}
.wp-ai-chat__meter-bar > span { display: block; height: 100%; background: var(--wp-accent-500); transition: width 200ms; }
.wp-ai-chat__meter[data-high] .wp-ai-chat__meter-bar > span { background: var(--wp-warn); }
.wp-ai-chat__meter[data-high] .wp-ai-chat__meter-label { color: var(--wp-warn); }
.wp-ai-chat__meter-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wp-ai-chat__compact {
  border: 0; background: none; padding: 0; font-size: 11px; color: var(--wp-accent-text); cursor: pointer;
}
.wp-ai-chat__compact:disabled { color: var(--wp-text-dim); cursor: default; }
</style>
