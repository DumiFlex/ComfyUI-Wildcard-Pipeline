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
 *
 * Images can be attached (button, paste or drop) when the model sees them;
 * they are shrunk in the browser first (`utils/chat-image.ts`).
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { isNavigationFailure, useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import Button from "../ui/Button.vue";
import Select, { type SelectOption } from "../ui/Select.vue";
import { api } from "../../api/client";
import AiMessage from "./AiMessage.vue";
import AiAsk from "./AiAsk.vue";
import { copyText } from "../../utils/clipboard";
import { plainText } from "../../utils/chat-markdown";
import AiCardView from "./AiCardView.vue";
import AiSyntax from "./AiSyntax.vue";
import AiTestCard from "./AiTestCard.vue";
import AiCardPreview from "./AiCardPreview.vue";
import AiPointer from "./AiPointer.vue";
import AiChatList from "./AiChatList.vue";
import AiWorking from "./AiWorking.vue";
import ChatCompletions from "./ChatCompletions.vue";
import { mentionItems, mentionRefs } from "../../utils/chat-completions";
import { useModuleStore } from "../../stores/moduleStore";
import { useBundleStore } from "../../stores/bundleStore";
import type { AiPhase } from "../../api/ai-progress";
import { useAiChat, type ChatAssistantEntry, type SearchApproval } from "../../composables/useAiChat";
import { clearPointer, EDIT_ROUTES } from "../../composables/useAiActions";
import { useAiConfig } from "../../composables/useAiConfig";
import { useAiChatWidth } from "../../composables/useAiChatWidth";
import type { AiCardFix, AiChatPage, AiChatProposal, AiChatStep, AiTestCard as TestCard } from "../../api/types";
import { currentPageNote, editorForPage } from "../../composables/useOpenEditor";
import { usePackBuilder } from "../../composables/usePackBuilder";
import { useCategoryStore } from "../../stores/categoryStore";
import { useTemplateStore } from "../../stores/templateStore";
import { starterQuestions, type StarterLibrary } from "../../utils/chat-starters";
import { cardMeta, cardOptions, cardView, draftRoute, otherPreview, type CardOption } from "../../composables/aiCards";
import { isWebCall, webCallCard, type WebCall } from "../../utils/web-calls";

const PREVIEW_LINES = 6;
const chat = useAiChat();

/** The run_test steps' cards, in order. */
function testCards(steps: AiChatStep[]): TestCard[] {
  return steps.flatMap((x) => (x.card ? [x.card] : []));
}

const testError = ref("");
async function openTest(card: TestCard): Promise<void> {
  testError.value = "";
  const out = await chat.openTest(card);
  if (out.startsWith("couldn't")) testError.value = `Couldn't open it: ${out.slice(10)}`;
}
const { config, save: saveConfig } = useAiConfig();
const route = useRoute();
const router = useRouter();
const scroller = ref<HTMLElement | null>(null);
const box = ref<HTMLTextAreaElement | null>(null);
const moduleStore = useModuleStore();
const bundleStore = useBundleStore();
/** Items picked with `@` show as chips in the user's own bubble. */
const libraryItems = computed(() => mentionItems(moduleStore.catalog, bundleStore.catalog));
const expanded = ref(new Set<string>());

/* ── The magnifier: a card or test run shown whole in a modal ── */

const zoom = ref<{ i: number; pid: string } | null>(null);
const zoomTest = ref<TestCard | null>(null);
const zoomed = computed(() => {
  const z = zoom.value;
  const entry = z ? chat.entries.value[z.i] : undefined;
  if (!z || entry?.role !== "assistant") return null;
  const p = entry.result.proposals.find((x) => x.pid === z.pid);
  return p ? { entry, p } : null;
});

function zoomCanApply(entry: ChatAssistantEntry, p: AiChatProposal): boolean {
  if (entry.status[p.pid] || p.op.op === "open" || p.op.op === "delete") return false;
  if (cardOptions(p) && keptCount(entry, p) === 0) return false;
  return !chat.blockedReason(entry, p) || chat.chainOf(entry, p).length > 0;
}

function zoomApplyLabel(entry: ChatAssistantEntry, p: AiChatProposal): string {
  return chat.blockedReason(entry, p) && chat.chainOf(entry, p).length
    ? `Apply all ${chat.chainOf(entry, p).length + 1}` : applyLabel(entry, p);
}

function zoomAct(what: "apply" | "dismiss" | "open-editor"): void {
  const z = zoomed.value;
  zoom.value = null;
  if (!z) return;
  if (what === "dismiss") chat.dismiss(z.entry, z.p);
  else if (what === "open-editor") void chat.openInEditor(z.entry, z.p);
  else if (chat.blockedReason(z.entry, z.p)) void chat.applyAll(z.entry, z.p);
  else void chat.apply(z.entry, z.p);
}
/** Delete cards showing their confirm step. */
const confirming = ref(new Set<string>());

function setConfirm(i: number, p: AiChatProposal, on: boolean): void {
  const next = new Set(confirming.value);
  if (on) next.add(key(i, p));
  else next.delete(key(i, p));
  confirming.value = next;
}

async function confirmDelete(i: number, entry: ChatAssistantEntry, p: AiChatProposal): Promise<void> {
  setConfirm(i, p, false);
  await chat.apply(entry, p);
}

/** How many things a delete card removes, for its confirm line. */
function deleteCount(p: AiChatProposal): number {
  const op = p.op;
  return op.op === "delete" ? op.items.length + op.categories.length + op.tags.length : 0;
}
const size = useAiChatWidth();

const modelLabel = computed(() => config.value?.model ?? "");
const isLocal = computed(() => {
  const c = config.value;
  return c ? c.local ?? c.presets[c.provider].local : true;
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
    void chat.checkVision();
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
  chat.startNew();
}

/* ── Images ── */

const IMAGE_SUGGESTIONS = [
  "Make wildcards from this image",
  "Add what's in this image to my wildcards",
];
const picker = ref<HTMLInputElement | null>(null);
const dropping = ref(false);
/** The user-message image shown large, as "entry:index". */
const bigImage = ref("");

const attachTitle = computed(() => chat.vision.value === false
  ? `${chat.visionModel.value || "This model"} can't see images. Pick a vision model to send one.`
  : "Attach images (or paste or drop them here)");

async function attach(files: Iterable<File> | null | undefined): Promise<void> {
  if (!files) return;
  const problem = await chat.addFiles(files);
  chat.error.value = problem;
  if (!problem) box.value?.focus();
}

function onPick(ev: Event): void {
  const input = ev.target as HTMLInputElement;
  void attach(input.files ? [...input.files] : null);
  input.value = "";
}

function onPaste(ev: ClipboardEvent): void {
  const files = [...(ev.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  ev.preventDefault();
  void attach(files);
}

function hasFiles(ev: DragEvent): boolean {
  return [...(ev.dataTransfer?.types ?? [])].includes("Files");
}

function onDragOver(ev: DragEvent): void {
  if (!hasFiles(ev) || chat.loading.value) return;
  ev.preventDefault();
  dropping.value = true;
}

function onDragLeave(ev: DragEvent): void {
  const to = ev.relatedTarget as Node | null;
  if (!to || !(ev.currentTarget as HTMLElement).contains(to)) dropping.value = false;
}

function onDrop(ev: DragEvent): void {
  dropping.value = false;
  if (!hasFiles(ev) || chat.loading.value) return;
  ev.preventDefault();
  void attach(ev.dataTransfer ? [...ev.dataTransfer.files] : null);
}

function toggleImage(i: number, j: number): void {
  const k = `${i}:${j}`;
  bigImage.value = bigImage.value === k ? "" : k;
}

/** The latest user message, the one the pencil can edit. */
const lastUserAt = computed(() => {
  const list = chat.entries.value;
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (e.role === "user" && !e.aside) return i;
  }
  return -1;
});

/** An answer that was only a reaction: nothing to show but the emoji. */
function quiet(entry: ChatAssistantEntry): boolean {
  const r = entry.result;
  return !!r.reaction && !r.message.trim() && !r.proposals.length && !r.steps.length
    && !r.pending?.length;
}
/** The last answer still waits on questions (the box answers them too). */
const waitingOnAsk = computed(() => {
  const last = chat.entries.value[chat.entries.value.length - 1];
  return last?.role === "assistant" && chat.askCalls(last).some((c) => !last.answered?.[c.id]);
});
const placeholder = computed(() => chat.editing.value ? "Edit your message…"
  : waitingOnAsk.value ? "Or answer in your own words…" : "Ask or ask for a change…");

/* ── Copy an answer ── */
const copied = ref<number | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
async function copyAnswer(i: number, text: string, refs?: Record<string, { name: string }>): Promise<void> {
  if (!(await copyText(plainText(text, refs)))) return;
  copied.value = i;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { copied.value = null; }, 1500);
}

/* ── Retry, the live answer, the meter ── */

const canRetry = computed(() => {
  const last = chat.entries.value[chat.entries.value.length - 1];
  return !chat.loading.value && last?.role === "assistant" && !!chat.chatId.value;
});

function retry(): void {
  void chat.retry(page());
}

const livePhase = computed<AiPhase>(() => {
  const l = chat.live.value;
  return l.text ? "writing" : l.thinking ? "thinking" : "reading";
});

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

const templateStore = useTemplateStore();

/** What the library holds, for starters that fit it. */
const starterLibrary = computed<StarterLibrary>(() => {
  const modules: Record<string, number> = {};
  const perCategory = new Map<string, number>();
  for (const m of moduleStore.catalog) {
    modules[m.type] = (modules[m.type] ?? 0) + 1;
    if (m.category_id) perCategory.set(m.category_id, (perCategory.get(m.category_id) ?? 0) + 1);
  }
  let top = "";
  let most = 0;
  for (const [id, n] of perCategory) if (n > most) { most = n; top = id; }
  const topCategory = categories.items.find((c) => c.id === top)?.name;
  return {
    modules,
    bundles: bundleStore.catalog.length,
    templates: templateStore.catalog.length,
    categories: categories.items.length,
    ...(topCategory ? { topCategory } : {}),
  };
});

const suggestions = computed(() => starterQuestions(
  { name: String(route.name ?? ""), hasId: typeof route.params.id === "string" && !!route.params.id },
  starterLibrary.value,
));

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
  const ed = editorForPage(out.id);
  if (ed) out.editor = ed;
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

function searches(entry: ChatAssistantEntry): WebCall[] {
  return (entry.result.pending ?? []).filter(isWebCall);
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
  } else if (ev.key === "Escape" && chat.editing.value) {
    chat.cancelEdit();
  } else if (ev.key === "Escape") {
    chat.open.value = false;
  }
}

/** The model that wrote reply `i`, shown on the first reply and whenever
 *  the model changed since the reply before. */
const FORMAT_LABEL = { native: "native tool calls", json: "JSON steps" } as const;

/** Who answered and how it calls tools, on the first reply and whenever
 *  either changes. */
function byLine(i: number): string {
  const entries = chat.entries.value;
  const here = entries[i];
  if (here?.role !== "assistant" || !here.result.model) return "";
  const said = (e: typeof here): string =>
    e.result.format ? `${e.result.model} · ${FORMAT_LABEL[e.result.format]}` : e.result.model;
  for (let j = i - 1; j >= 0; j--) {
    const e = entries[j];
    if (e?.role === "assistant" && e.result.model) return said(e) === said(here) ? "" : said(here);
  }
  return said(here);
}

/** Calls the model wrote out as text instead of calling (the server ran
 *  them anyway): a sign it handles native tools poorly. */
function rescued(i: number): number {
  const e = chat.entries.value[i];
  return e?.role === "assistant" ? e.result.tool_use?.salvaged ?? 0 : 0;
}

function key(i: number, p: AiChatProposal): string {
  return `${i}:${p.pid}`;
}

function preview(i: number, p: AiChatProposal): string[] {
  return expanded.value.has(key(i, p)) ? p.preview : p.preview.slice(0, PREVIEW_LINES);
}

/* ── Cards: meta, pickable options, Open in editor ── */

const categories = useCategoryStore();

function categoryLabel(p: AiChatProposal): string {
  const m = cardMeta(p);
  if (!m) return "";
  if (m.newCategory) return `${m.newCategory} (new)`;
  return m.categoryId ? categories.items.find((c) => c.id === m.categoryId)?.name ?? m.categoryId : "";
}

function isSkipped(entry: ChatAssistantEntry, p: AiChatProposal, id: string): boolean {
  return !!entry.skip?.[p.pid]?.includes(id);
}

function keptCount(entry: ChatAssistantEntry, p: AiChatProposal): number {
  const opts = cardOptions(p) ?? [];
  return opts.filter((o) => !isSkipped(entry, p, o.id)).length;
}

function shownOptions(i: number, p: AiChatProposal): CardOption[] {
  const opts = cardOptions(p) ?? [];
  return expanded.value.has(key(i, p)) ? opts : opts.slice(0, PREVIEW_LINES);
}

/** Preview lines the structured parts above don't already show. */
function otherLines(i: number, p: AiChatProposal): string[] {
  const opts = cardOptions(p);
  return opts ? otherPreview(p, opts) : preview(i, p);
}

function canOpenInEditor(p: AiChatProposal): boolean {
  const op = p.op;
  if (op.op === "create") return !!draftRoute(p);
  return op.op === "update" && op.kind === "module" && op.basis !== "editor" && !!cardOptions(p);
}

function applyLabel(entry: ChatAssistantEntry, p: AiChatProposal): string {
  const opts = cardOptions(p);
  if (!opts) return "Apply";
  const kept = keptCount(entry, p);
  return kept === opts.length ? "Apply" : `Apply ${kept}`;
}

/** Warnings a card shows before "N more warnings". */
const WARNINGS_SHOWN = 3;
/** Tags a card shows before "+N" (the magnifier shows them all). */
const TAGS_SHOWN = 10;

function shownWarnings(i: number, p: AiChatProposal): string[] {
  return expanded.value.has(`${key(i, p)}:w`) ? p.warnings : p.warnings.slice(0, WARNINGS_SHOWN);
}

/** The card's own fix for a warning, when it has one (else the model fixes it). */
function fixFor(p: AiChatProposal, w: string): AiCardFix | undefined {
  return p.fixes?.find((f) => f.warning === w);
}

function toggle(i: number, p: AiChatProposal, part = ""): void {
  const k = part ? `${key(i, p)}:${part}` : key(i, p);
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
  if (op.op !== "update" && op.op !== "open") return null;
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
  // Esc with the card preview open closes only the preview.
  if (zoom.value || zoomTest.value) return;
  if (ev.key === "Escape" && chat.open.value && !chat.loading.value) chat.open.value = false;
}
onMounted(() => {
  void loadModels();
  void chat.checkVision();
  scrollDown();
  void nextTick(() => box.value?.focus());
  window.addEventListener("keydown", onGlobalKey);
});
onBeforeUnmount(() => window.removeEventListener("keydown", onGlobalKey));
</script>

<template>
  <aside
    class="wp-ai-chat"
    role="dialog"
    aria-label="AI assistant"
    data-test="ai-chat"
    :data-resizing="size.dragging.value || undefined"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div v-if="dropping" class="wp-ai-chat__drop" data-test="ai-chat-drop">
      <i class="pi pi-image" aria-hidden="true" />
      {{ chat.vision.value === false ? attachTitle : "Drop images to attach them" }}
    </div>
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
      ><span class="wp-ai-chat__btn-label">Chats</span></Button>
      <Button
        variant="ghost"
        size="sm"
        icon="pi-plus"
        :disabled="!chat.started.value && !chat.loading.value && !showList"
        data-test="ai-chat-new"
        title="Start a new chat"
        @click="newChat"
      ><span class="wp-ai-chat__btn-label">New chat</span></Button>
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
        <div v-if="entry.role === 'user'" class="wp-ai-chat__user" data-test="ai-chat-user" :data-reacted="entry.reaction ? 'true' : undefined">
          <span v-if="entry.images?.length" class="wp-ai-chat__pics">
            <button
              v-for="(src, j) in entry.images"
              :key="j"
              type="button"
              class="wp-ai-chat__pic"
              :data-big="bigImage === `${i}:${j}` || undefined"
              :aria-label="bigImage === `${i}:${j}` ? 'Show smaller' : 'Show larger'"
              data-test="ai-chat-user-image"
              @click="toggleImage(i, j)"
            ><img :src="src" alt="" /></button>
          </span>
          <AiMessage
            v-if="entry.text && entry.text.includes('[[')"
            class="wp-ai-chat__user-text"
            :text="entry.text"
            :refs="mentionRefs(entry.text, libraryItems)"
          />
          <template v-else-if="entry.text">{{ entry.text }}</template>
          <button
            v-if="i === lastUserAt && !chat.loading.value && !chat.editBlocked()"
            type="button"
            class="wp-ai-chat__icon-btn wp-ai-chat__edit"
            aria-label="Edit message"
            title="Edit and send again"
            data-test="ai-chat-edit"
            @click="chat.editLast(); box?.focus()"
          ><i class="pi pi-pencil" aria-hidden="true" /></button>
          <span
            v-if="entry.reaction"
            class="wp-ai-chat__reaction"
            role="img"
            :aria-label="`Reacted ${entry.reaction}`"
            :title="entry.aside ? 'Reacted instead of answering' : 'Reacted to your message'"
            data-test="ai-chat-reaction"
          >{{ entry.reaction }}</span>
        </div>
        <div v-else-if="!quiet(entry)" class="wp-ai-chat__reply" data-test="ai-chat-reply">
          <p v-if="byLine(i)" class="wp-ai-chat__by" data-test="ai-chat-by" :title="`Answered by ${byLine(i)}`">
            <i class="pi pi-microchip-ai" aria-hidden="true" /> {{ byLine(i) }}
          </p>
          <p
            v-if="rescued(i)"
            class="wp-ai-chat__by"
            data-tone="warn"
            data-test="ai-chat-rescued"
            title="The model wrote these calls as text instead of calling its tools. They ran anyway; if it keeps happening, set Settings › AI assistant › Tool format to JSON steps."
          >
            <i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ rescued(i) }} tool call{{ rescued(i) === 1 ? "" : "s" }} written as text
          </p>
          <ul v-if="entry.result.steps.length" class="wp-ai-chat__steps" data-test="ai-chat-steps">
            <template v-for="(s, j) in entry.result.steps" :key="j">
              <li v-if="s.think" class="wp-ai-chat__said wp-ai-chat__thought" data-test="ai-chat-thought">
                <details>
                  <summary>Thinking</summary>
                  <p class="wp-ai-chat__thought-text">{{ s.note }}</p>
                </details>
              </li>
              <li v-else-if="s.say" v-show="s.note !== entry.result.message" class="wp-ai-chat__said" data-test="ai-chat-said">
                <details>
                  <summary>Working note</summary>
                  <AiMessage :text="s.note" :refs="entry.result.refs" />
                </details>
              </li>
              <li v-else :data-ok="s.ok ? 'true' : 'false'">
                <i :class="['pi', s.ok ? 'pi-check' : 'pi-exclamation-circle']" aria-hidden="true" />
                {{ s.note }}
              </li>
            </template>
          </ul>
          <AiTestCard
            v-for="(card, j) in testCards(entry.result.steps)"
            :key="`t${j}`"
            :card="card"
            @open="openTest(card)"
            @zoom="zoomTest = card"
          />
          <p v-if="testError" class="wp-ai-chat__warning" role="status">{{ testError }}</p>
          <AiMessage :text="entry.result.message" :refs="entry.result.refs" />
          <AiAsk
            v-for="c in chat.askCalls(entry)"
            :key="c.id"
            :questions="c.args.questions"
            :answered="entry.answered?.[c.id]"
            :disabled="chat.loading.value"
            @answer="(a) => chat.answerAsk(c.id, a)"
          />
          <div
            v-if="entry.result.message.trim() || (canRetry && i === chat.entries.value.length - 1)"
            class="wp-ai-chat__msg-tools"
          >
            <button
              v-if="entry.result.message.trim()"
              type="button"
              class="wp-ai-chat__icon-btn"
              :aria-label="copied === i ? 'Copied' : 'Copy this answer'"
              :title="copied === i ? 'Copied' : 'Copy this answer'"
              data-test="ai-chat-copy"
              @click="copyAnswer(i, entry.result.message, entry.result.refs)"
            ><i :class="['pi', copied === i ? 'pi-check' : 'pi-copy']" aria-hidden="true" /></button>
            <Button
              v-if="canRetry && i === chat.entries.value.length - 1"
              variant="ghost"
              size="sm"
              icon="pi-refresh"
              :disabled="!!chat.retryBlocked()"
              :title="chat.retryBlocked() || 'Ask the same message again for a new answer'"
              data-test="ai-chat-retry"
              @click="retry"
            >Try again</Button>
          </div>

          <article
            v-for="c in searches(entry)"
            :key="c.id"
            class="wp-ai-chat__card wp-ai-chat__search"
            data-test="ai-chat-search"
          >
            <div class="wp-ai-chat__card-head">
              <span class="wp-ai-chat__card-title"><i :class="['pi', webCallCard(c).icon]" aria-hidden="true" /> {{ webCallCard(c).title }}</span>
              <span class="wp-ai-chat__card-summary">{{ webCallCard(c).summary }}</span>
            </div>
            <p class="wp-ai-chat__query" data-test="ai-chat-search-query">{{ webCallCard(c).text }}</p>
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
            :data-kind="p.op.op === 'delete' ? 'delete' : undefined"
            data-test="ai-chat-proposal"
          >
            <div class="wp-ai-chat__card-head">
              <span class="wp-ai-chat__card-title">{{ p.title }}</span>
              <span class="wp-ai-chat__card-summary">{{ p.summary }}</span>
              <button
                type="button"
                class="wp-ai-chat__zoom"
                aria-label="Show the whole card"
                title="Show the whole card"
                data-test="ai-chat-zoom"
                @click="zoom = { i, pid: p.pid }"
              ><i class="pi pi-search-plus" aria-hidden="true" /></button>
            </div>
            <dl v-if="cardMeta(p)" class="wp-ai-chat__meta" data-test="ai-chat-card-meta">
              <template v-if="cardMeta(p)!.variable">
                <dt>Variable</dt><dd><code>${{ cardMeta(p)!.variable }}</code></dd>
              </template>
              <dt>Description</dt>
              <dd :data-empty="!cardMeta(p)!.description || undefined" class="wp-ai-chat__clamp" :title="cardMeta(p)!.description || undefined" data-test="ai-chat-card-description">{{ cardMeta(p)!.description || "None" }}</dd>
              <dt>Tags</dt>
              <dd data-test="ai-chat-card-tags">
                <span v-for="t in cardMeta(p)!.tags.slice(0, TAGS_SHOWN)" :key="t" class="wp-ai-chat__chip">#{{ t }}</span>
                <span v-if="cardMeta(p)!.tags.length > TAGS_SHOWN" class="wp-ai-chat__chip" data-tone="more">+{{ cardMeta(p)!.tags.length - TAGS_SHOWN }}</span>
                <span v-if="!cardMeta(p)!.tags.length" data-empty="true">None</span>
              </dd>
              <dt>Category</dt>
              <dd data-test="ai-chat-card-category" :data-empty="!categoryLabel(p) || undefined">{{ categoryLabel(p) || "None" }}</dd>
            </dl>
            <div v-if="cardOptions(p)" class="wp-ai-chat__opts" data-test="ai-chat-card-options">
              <div class="wp-ai-chat__opts-head">
                <span>{{ keptCount(entry, p) }} of {{ cardOptions(p)!.length }} option{{ cardOptions(p)!.length === 1 ? "" : "s" }}{{ entry.status[p.pid] ? "" : " ticked" }}</span>
                <button
                  v-if="!entry.status[p.pid] && cardOptions(p)!.length > 1"
                  type="button"
                  class="wp-ai-chat__link"
                  data-test="ai-chat-card-all"
                  @click="chat.setAllOptions(entry, p, keptCount(entry, p) < cardOptions(p)!.length)"
                >{{ keptCount(entry, p) < cardOptions(p)!.length ? "Tick all" : "Untick all" }}</button>
              </div>
              <ul>
                <li v-for="o in shownOptions(i, p)" :key="o.id" :data-off="isSkipped(entry, p, o.id) || undefined">
                  <label>
                    <input
                      type="checkbox"
                      :checked="!isSkipped(entry, p, o.id)"
                      :disabled="!!entry.status[p.pid]"
                      :aria-label="`Keep ${o.empty ? 'the empty option' : o.text}`"
                      data-test="ai-chat-card-option"
                      @change="chat.toggleOption(entry, p, o.id)"
                    />
                    <span class="wp-ai-chat__opt-text wp-ai-chat__clamp" :title="o.empty ? undefined : o.text"><template v-if="o.empty">∅ nothing</template><AiSyntax v-else :text="o.text" /></span>
                    <span v-if="o.weight !== 1" class="wp-ai-chat__opt-weight">×{{ o.weight }}</span>
                    <span v-if="o.fallback" class="wp-ai-chat__chip" data-tone="accent">fallback</span>
                    <span v-for="t in o.tags" :key="t" class="wp-ai-chat__chip">#{{ t }}</span>
                    <span v-if="o.negative" class="wp-ai-chat__opt-neg wp-ai-chat__clamp" :title="`Negative: ${o.negative}`">− <AiSyntax :text="o.negative" /></span>
                  </label>
                </li>
              </ul>
              <button
                v-if="cardOptions(p)!.length > PREVIEW_LINES"
                type="button"
                class="wp-ai-chat__more"
                data-test="ai-chat-more"
                @click="toggle(i, p)"
              >{{ expanded.has(key(i, p)) ? "Show less" : `Show all ${cardOptions(p)!.length}` }}</button>
            </div>
            <AiCardView v-if="cardView(p)" :view="cardView(p)!" />
            <ul v-else-if="otherLines(i, p).length" class="wp-ai-chat__preview">
              <li v-for="(line, j) in otherLines(i, p)" :key="j"><AiSyntax :text="line" /></li>
            </ul>
            <button
              v-if="!cardOptions(p) && !cardView(p) && p.preview.length > PREVIEW_LINES"
              type="button"
              class="wp-ai-chat__more"
              data-test="ai-chat-more"
              @click="toggle(i, p)"
            >{{ expanded.has(key(i, p)) ? "Show less" : `Show all ${p.preview.length}` }}</button>
            <p v-if="p.replaces" class="wp-ai-chat__note" data-test="ai-chat-replaces"><i class="pi pi-info-circle" aria-hidden="true" /> Replaces the earlier card, which wasn't applied</p>
            <ul v-if="p.warnings.length || chat.linkWarnings(entry, p).length" class="wp-ai-chat__warnings">
              <li v-for="w in chat.linkWarnings(entry, p)" :key="w" data-test="ai-chat-link-warning"><i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ w }}</li>
              <li v-for="(w, j) in shownWarnings(i, p)" :key="j" data-test="ai-chat-warning" :data-note="p.notes?.includes(w) ? 'true' : undefined">
                <i :class="['pi', p.notes?.includes(w) ? 'pi-info-circle' : 'pi-exclamation-triangle']" aria-hidden="true" />
                <span class="wp-ai-chat__warning-body"><AiMessage v-if="w.includes('[[')" class="wp-ai-chat__warning-text" :text="w" :refs="entry.result.refs" /><template v-else>{{ w }}</template></span>
                <template v-if="!entry.status[p.pid] && p.op.op !== 'delete' && !p.notes?.includes(w)">
                  <button
                    v-if="fixFor(p, w)"
                    type="button"
                    class="wp-ai-chat__fix"
                    :title="`Fix it on the card: ${fixFor(p, w)!.label}`"
                    data-test="ai-chat-fix"
                    @click="chat.fix(entry, p, fixFor(p, w)!.key)"
                  ><i class="pi pi-wrench" aria-hidden="true" /> {{ fixFor(p, w)!.label }}</button>
                  <button
                    v-else
                    type="button"
                    class="wp-ai-chat__fix"
                    :disabled="chat.loading.value"
                    title="Send this warning back to the assistant; its new card replaces this one"
                    data-test="ai-chat-ask-fix"
                    @click="chat.askFix(p, w)"
                  ><i class="pi pi-sparkles" aria-hidden="true" /> Ask to fix</button>
                </template>
              </li>
              <li v-if="p.warnings.length > shownWarnings(i, p).length" class="wp-ai-chat__warn-more">
                <button type="button" class="wp-ai-chat__link" data-test="ai-chat-more-warnings" @click="toggle(i, p, 'w')">{{ p.warnings.length - shownWarnings(i, p).length }} more warning{{ p.warnings.length - shownWarnings(i, p).length === 1 ? "" : "s" }}</button>
              </li>
              <li v-if="!entry.status[p.pid] && (p.fixes?.length ?? 0) > 1" class="wp-ai-chat__warn-more">
                <button type="button" class="wp-ai-chat__fix" data-test="ai-chat-fix-all" @click="chat.fixAll(entry, p)"><i class="pi pi-wrench" aria-hidden="true" /> Fix all {{ p.fixes!.length }}</button>
              </li>
            </ul>
            <p v-if="entry.errors[p.pid]" class="wp-ai-chat__error" role="alert">{{ entry.errors[p.pid] }}</p>
            <div class="wp-ai-chat__actions">
              <template v-if="p.op.op === 'open'">
                <Button size="sm" icon="pi-arrow-up-right" data-test="ai-chat-open" @click="openItem(entry, p)">{{ openLabel(p) }}</Button>
              </template>
              <template v-else-if="entry.status[p.pid] === 'applied'">
                <span class="wp-ai-chat__done" :data-test="entry.auto?.[p.pid] ? 'ai-chat-auto-applied' : undefined"><i class="pi pi-check" aria-hidden="true" /> {{ p.op.op === "delete" ? "Deleted" : entry.auto?.[p.pid] ? "Applied automatically" : "Applied" }}</span>
                <Button variant="ghost" size="sm" data-test="ai-chat-undo" @click="chat.undo(entry, p)">Undo</Button>
                <Button v-if="target(entry, p)" variant="ghost" size="sm" icon="pi-arrow-up-right" data-test="ai-chat-open" @click="openItem(entry, p)">Open</Button>
              </template>
              <template v-else-if="entry.status[p.pid] === 'editor'">
                <span class="wp-ai-chat__done" data-test="ai-chat-in-editor"><i class="pi pi-check" aria-hidden="true" /> {{ entry.auto?.[p.pid] ? "Put in the editor automatically." : "In the editor." }} Save there to keep it.</span>
                <Button variant="ghost" size="sm" data-test="ai-chat-undo" @click="chat.undo(entry, p)">Undo</Button>
              </template>
              <template v-else-if="entry.status[p.pid] === 'dismissed'">
                <span class="wp-ai-chat__dismissed">Dismissed</span>
              </template>
              <template v-else-if="entry.status[p.pid] === 'replaced'">
                <span class="wp-ai-chat__dismissed" data-test="ai-chat-replaced">Replaced by a newer card below</span>
              </template>
              <template v-else-if="entry.status[p.pid] === 'opened'">
                <span class="wp-ai-chat__done" data-test="ai-chat-opened"><i class="pi pi-check" aria-hidden="true" /> Opened in a new editor. Save there to keep it.</span>
              </template>
              <template v-else-if="p.op.op === 'delete' && confirming.has(key(i, p))">
                <span class="wp-ai-chat__confirm" role="alert" data-test="ai-chat-delete-question">Delete {{ deleteCount(p) === 1 ? "it" : `these ${deleteCount(p)}` }}? Undo brings {{ deleteCount(p) === 1 ? "it" : "them" }} back.</span>
                <Button variant="ghost" size="sm" data-test="ai-chat-delete-cancel" @click="setConfirm(i, p, false)">Cancel</Button>
                <Button variant="danger" size="sm" icon="pi-trash" data-test="ai-chat-delete-confirm" @click="confirmDelete(i, entry, p)">Delete</Button>
              </template>
              <template v-else-if="p.op.op === 'delete'">
                <span v-if="chat.blockedReason(entry, p)" class="wp-ai-chat__blocked">{{ chat.blockedReason(entry, p) }}</span>
                <Button variant="ghost" size="sm" data-test="ai-chat-dismiss" @click="chat.dismiss(entry, p)">Dismiss</Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="pi-trash"
                  :disabled="!!chat.blockedReason(entry, p)"
                  data-test="ai-chat-delete"
                  @click="setConfirm(i, p, true)"
                >Delete…</Button>
              </template>
              <template v-else>
                <span v-if="chat.blockedReason(entry, p)" class="wp-ai-chat__blocked">{{ chat.blockedReason(entry, p) }}</span>
                <span v-else-if="toEditor(p)" class="wp-ai-chat__blocked">Goes into the open editor</span>
                <Button variant="ghost" size="sm" data-test="ai-chat-dismiss" @click="chat.dismiss(entry, p)">Dismiss</Button>
                <Button
                  v-if="canOpenInEditor(p)"
                  variant="secondary"
                  size="sm"
                  icon="pi-pencil"
                  :disabled="(p.op.op !== 'create' && !!chat.blockedReason(entry, p)) || (!!cardOptions(p) && keptCount(entry, p) === 0)"
                  :title="p.op.op === 'create' ? 'Open it in a new editor to check and change it before saving (links to cards not applied yet are kept)' : 'Put it into the item\'s editor, unsaved'"
                  data-test="ai-chat-open-editor"
                  @click="chat.openInEditor(entry, p)"
                >Open in editor</Button>
                <Button
                  v-if="chat.blockedReason(entry, p) && chat.chainOf(entry, p).length"
                  variant="primary"
                  size="sm"
                  icon="pi-check"
                  :title="`Applies ${chat.chainOf(entry, p).map((x) => x.p.title).join(', ')} first`"
                  data-test="ai-chat-apply-all"
                  @click="chat.applyAll(entry, p)"
                >Apply all {{ chat.chainOf(entry, p).length + 1 }}</Button>
                <Button
                  v-else
                  variant="primary"
                  size="sm"
                  icon="pi-check"
                  :disabled="!!chat.blockedReason(entry, p) || (!!cardOptions(p) && keptCount(entry, p) === 0)"
                  data-test="ai-chat-apply"
                  @click="chat.apply(entry, p)"
                >{{ applyLabel(entry, p) }}</Button>
              </template>
            </div>
          </article>
        </div>
      </template>

      <div v-if="chat.loading.value && !chat.asking.value.size" class="wp-ai-chat__reply wp-ai-chat__live" data-test="ai-chat-live">
        <ul v-if="chat.live.value.steps.length" class="wp-ai-chat__steps">
          <template v-for="(s, j) in chat.live.value.steps" :key="j">
            <li v-if="s.think" class="wp-ai-chat__said wp-ai-chat__thought"><details><summary>Thinking</summary><p class="wp-ai-chat__thought-text">{{ s.note }}</p></details></li>
            <li v-else-if="s.say" class="wp-ai-chat__said"><details><summary>Working note</summary><AiMessage :text="s.note" /></details></li>
            <li v-else :data-ok="s.ok ? 'true' : 'false'">
              <i :class="['pi', s.ok ? 'pi-check' : 'pi-exclamation-circle']" aria-hidden="true" />
              {{ s.note }}
            </li>
          </template>
        </ul>
        <AiMessage v-if="chat.live.value.text" :text="chat.live.value.text" live />
        <AiWorking class="wp-ai-chat__status" :text="liveStatus" :phase="livePhase" :size="22" data-test="ai-chat-loading" />
      </div>
    </div>

    <footer class="wp-ai-chat__foot">
      <p v-if="chat.error.value" class="wp-ai-chat__error" role="alert" data-test="ai-chat-error">{{ chat.error.value }}</p>
      <div v-if="chat.attachments.value.length" class="wp-ai-chat__attached" data-test="ai-chat-attached">
        <span v-for="(a, j) in chat.attachments.value" :key="j" class="wp-ai-chat__thumb" :title="`${a.name} · ${a.w}×${a.h}`">
          <img :src="a.url" :alt="a.name" />
          <button type="button" :aria-label="`Remove ${a.name}`" data-test="ai-chat-unattach" @click="chat.removeAttachment(j)"><i class="pi pi-times" aria-hidden="true" /></button>
        </span>
        <span v-if="chat.vision.value === null" class="wp-ai-chat__vision-note">Your server didn't say whether this model sees images.</span>
      </div>
      <div v-if="chat.attachments.value.length && !chat.input.value.trim()" class="wp-ai-chat__image-ideas">
        <button
          v-for="s in IMAGE_SUGGESTIONS"
          :key="s"
          type="button"
          class="wp-ai-chat__suggestion wp-ai-chat__suggestion--small"
          data-test="ai-chat-image-idea"
          @click="suggest(s)"
        >{{ s }}</button>
      </div>
      <p v-if="chat.editing.value" class="wp-ai-chat__editing" data-test="ai-chat-editing">
        Editing your last message
        <button type="button" class="wp-ai-chat__link" data-test="ai-chat-edit-cancel" @click="chat.cancelEdit()">Cancel</button>
      </p>
      <textarea
        ref="box"
        v-model="chat.input.value"
        class="wp-textarea wp-ai-chat__input"
        rows="2"
        :placeholder="placeholder"
        aria-label="Message the assistant"
        data-test="ai-chat-input"
        :disabled="chat.loading.value"
        @keydown="onKeydown"
        @paste="onPaste"
      ></textarea>
      <ChatCompletions :target="box" />
      <input ref="picker" type="file" accept="image/*" multiple hidden aria-label="Attach images" data-test="ai-chat-file" @change="onPick" />
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
        <button
          type="button"
          class="wp-ai-chat__close wp-ai-chat__attach"
          :disabled="chat.loading.value || chat.vision.value === false"
          :title="attachTitle"
          :aria-label="attachTitle"
          data-test="ai-chat-attach"
          @click="picker?.click()"
        ><i class="pi pi-image" aria-hidden="true" /></button>
        <Button v-if="chat.loading.value" size="sm" icon="pi-stop" data-test="ai-chat-stop" @click="chat.stop">Stop</Button>
        <Button
          v-else
          variant="primary"
          size="sm"
          icon="pi-send"
          :disabled="!chat.input.value.trim() && !chat.attachments.value.length"
          data-test="ai-chat-send"
          @click="send"
        >Send</Button>
      </div>
    </footer>
    <AiCardPreview
      :proposal="zoomed?.p ?? null"
      :test="zoomTest"
      :skipped="zoomed ? zoomed.entry.skip?.[zoomed.p.pid] ?? [] : []"
      :can-apply="zoomed && !zoomed.entry.status[zoomed.p.pid] && zoomed.p.op.op !== 'open' && zoomed.p.op.op !== 'delete' ? zoomCanApply(zoomed.entry, zoomed.p) : undefined"
      :blocked="zoomed ? chat.blockedReason(zoomed.entry, zoomed.p) : ''"
      :apply-label="zoomed ? zoomApplyLabel(zoomed.entry, zoomed.p) : ''"
      :can-open-in-editor="zoomed ? canOpenInEditor(zoomed.p) : false"
      @close="zoom = null; zoomTest = null"
      @apply="zoomAct('apply')"
      @dismiss="zoomAct('dismiss')"
      @open-editor="zoomAct('open-editor')"
      @open-test="zoomTest && openTest(zoomTest); zoomTest = null"
    />
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
  container: wp-ai-chat / inline-size;
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
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 12px; border-bottom: 1px solid var(--wp-border);
}
.wp-ai-chat__title { font-weight: 600; color: var(--wp-accent-text); display: inline-flex; gap: 6px; align-items: center; }
/* The picker keeps room to read and click; on a narrow drawer the buttons
   drop their words first. */
.wp-ai-chat__model { min-width: 150px; flex: 1 1 160px; max-width: 260px; }
@container wp-ai-chat (max-width: 440px) {
  .wp-ai-chat__btn-label { display: none; }
}
.wp-ai-chat__model :deep(.wp-select) { width: 100%; }
.wp-ai-chat__model :deep(button) { font-family: var(--wp-font-mono, monospace); font-size: 11px; }
.wp-ai-chat__model-note {
  margin: 0; padding: 6px 12px; font-size: 12px; color: var(--wp-text-muted);
  border-bottom: 1px solid var(--wp-border); background: var(--wp-bg-2);
}
.wp-ai-chat__spacer { flex: 1; }
.wp-ai-chat__meta {
  display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 3px 10px;
  margin: 6px 0 8px; font-size: 12px;
}
.wp-ai-chat__meta dt { color: var(--wp-text-dim); }
.wp-ai-chat__meta dd { margin: 0; color: var(--wp-text); overflow-wrap: anywhere; display: flex; flex-wrap: wrap; gap: 4px; }
.wp-ai-chat__meta [data-empty] { color: var(--wp-text-dim); font-style: italic; }
.wp-ai-chat__chip {
  display: inline-block; padding: 0 6px; border-radius: 999px; font-size: 11px; line-height: 18px;
  background: var(--wp-bg-3); color: var(--wp-text-muted);
}
.wp-ai-chat__chip[data-tone="accent"] { background: color-mix(in oklab, var(--wp-accent-500) 22%, transparent); color: var(--wp-accent-text); }
.wp-ai-chat__opts { margin: 4px 0 6px; border: 1px solid var(--wp-border); border-radius: 6px; background: var(--wp-bg-1, var(--wp-bg-2)); }
.wp-ai-chat__opts-head {
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  padding: 5px 8px; font-size: 11px; color: var(--wp-text-dim); border-bottom: 1px solid var(--wp-border);
}
.wp-ai-chat__opts ul { list-style: none; margin: 0; padding: 2px 0; }
.wp-ai-chat__opts li label {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; padding: 3px 8px;
  font-size: 12px; cursor: pointer;
}
.wp-ai-chat__opts li:hover { background: var(--wp-bg-3); }
.wp-ai-chat__opts li[data-off] .wp-ai-chat__opt-text { color: var(--wp-text-dim); text-decoration: line-through; }
.wp-ai-chat__opts input { accent-color: var(--wp-accent-500); margin: 0; }
.wp-ai-chat__opt-text { flex: 1 1 140px; min-width: 0; overflow-wrap: anywhere; }
/* Long text on a card: three lines, the rest in the tooltip and the magnifier. */
.wp-ai-chat__clamp { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; overflow-wrap: anywhere; }
.wp-ai-chat__meta dd.wp-ai-chat__clamp { display: -webkit-box; }
.wp-ai-chat__opt-neg.wp-ai-chat__clamp { -webkit-line-clamp: 1; line-clamp: 1; }
.wp-ai-chat__chip[data-tone="more"] { color: var(--wp-text-muted); }
.wp-ai-chat__opt-weight { font-family: var(--wp-font-mono, monospace); font-size: 11px; color: var(--wp-accent-text); }
.wp-ai-chat__opt-neg { font-size: 11px; color: var(--wp-danger, #f87171); overflow-wrap: anywhere; }
.wp-ai-chat__link {
  border: 0; background: none; padding: 0; font: inherit; font-size: 11px; color: var(--wp-accent-text);
  cursor: pointer; text-decoration: underline;
}
.wp-ai-chat__by[data-tone="warn"] { color: var(--wp-warning, #d9a400); }
.wp-ai-chat__by {
  display: flex; align-items: center; gap: 5px; margin: 0 0 4px;
  font-family: var(--wp-font-mono, monospace); font-size: 11px; color: var(--wp-text-dim);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
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
  white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; position: relative;
}
.wp-ai-chat__user[data-reacted] { margin-bottom: 10px; }
.wp-ai-chat__reaction {
  position: absolute; left: -8px; bottom: -12px; min-width: 24px; height: 22px; padding: 0 5px;
  display: inline-flex; align-items: center; justify-content: center; border-radius: 11px;
  font-size: 13px; line-height: 1; background: var(--wp-bg-1);
  border: 1px solid var(--wp-border); box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
  animation: wp-ai-chat-react 0.32s cubic-bezier(0.3, 1.6, 0.5, 1) both;
}
@keyframes wp-ai-chat-react {
  from { transform: scale(0.3); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) { .wp-ai-chat__reaction { animation: none; } }
.wp-ai-chat__reply { display: flex; flex-direction: column; gap: 8px; }
.wp-ai-chat__steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.wp-ai-chat__steps li { font-size: 11px; color: var(--wp-text-dim); display: flex; gap: 6px; align-items: baseline; overflow-wrap: anywhere; }
.wp-ai-chat__steps li[data-ok="false"] { color: var(--wp-warn); }
.wp-ai-chat__steps .pi { font-size: 10px; }
/* Text the model wrote before acting: a normal-size paragraph between the steps. */
.wp-ai-chat__steps li.wp-ai-chat__said { display: block; font-size: 12px; color: var(--wp-text-muted); margin: 2px 0; }
.wp-ai-chat__said summary { cursor: pointer; font-style: italic; }
.wp-ai-chat__said details[open] { border-left: 2px solid var(--wp-border); padding-left: 8px; }
.wp-ai-chat__thought-text { white-space: pre-wrap; margin: 4px 0 0; max-height: 320px; overflow-y: auto; }
.wp-ai-chat__card {
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 35%, var(--wp-border));
  border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 6px;
  background: color-mix(in oklab, var(--wp-accent-500) 4%, var(--wp-bg-2));
}
.wp-ai-chat__card[data-status="applied"], .wp-ai-chat__card[data-status="editor"] { border-color: color-mix(in oklab, var(--wp-success) 50%, var(--wp-border)); }
.wp-ai-chat__card[data-status="dismissed"], .wp-ai-chat__card[data-status="replaced"] { opacity: 0.6; }
.wp-ai-chat__card[data-kind="delete"][data-status="pending"] { border-color: color-mix(in oklab, var(--wp-danger) 40%, var(--wp-border)); }
.wp-ai-chat__confirm { margin-right: auto; font-size: 12px; color: var(--wp-danger); }
.wp-ai-chat__card[data-status="failed"] { border-color: color-mix(in oklab, var(--wp-danger) 50%, var(--wp-border)); }
.wp-ai-chat__card-head { position: relative; display: flex; flex-direction: column; gap: 1px; padding-right: 26px; }
.wp-ai-chat__card-title { font-weight: 600; font-size: 13px; overflow-wrap: anywhere; }
.wp-ai-chat__zoom {
  position: absolute; top: -2px; right: -4px; background: none; border: 0; padding: 3px 5px;
  color: var(--wp-text-muted); cursor: pointer; border-radius: var(--wp-radius-sm);
}
.wp-ai-chat__edit { position: absolute; left: -28px; bottom: 2px; opacity: 0.5; }
.wp-ai-chat__user:hover .wp-ai-chat__edit, .wp-ai-chat__edit:focus-visible { opacity: 1; }
.wp-ai-chat__editing { margin: 0 0 4px; font-size: 12px; color: var(--wp-text-muted); display: flex; gap: 8px; }
.wp-ai-chat__msg-tools { display: flex; align-items: center; gap: 4px; margin-top: -4px; }
.wp-ai-chat__icon-btn {
  display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px;
  border: 0; border-radius: 4px; background: none; color: var(--wp-text-dim); cursor: pointer; font-size: 12px;
}
.wp-ai-chat__icon-btn:hover, .wp-ai-chat__icon-btn:focus-visible { color: var(--wp-text); background: var(--wp-bg-3); }
.wp-ai-chat__zoom:hover { color: var(--wp-text); background: var(--wp-bg-3); }
.wp-ai-chat__card-summary { font-size: 12px; color: var(--wp-text-muted); }
.wp-ai-chat__preview {
  margin: 0; padding: 6px 8px 6px 22px; font-size: 12px; border-radius: 6px;
  background: var(--wp-bg-1); display: flex; flex-direction: column; gap: 2px; overflow-wrap: anywhere;
}
.wp-ai-chat__query {
  margin: 0; padding: 6px 8px; border-radius: 6px; background: var(--wp-bg-1);
  font-family: var(--wp-font-mono, monospace); font-size: 12px; overflow-wrap: anywhere;
}
.wp-ai-chat__more { align-self: flex-start; border: 0; background: none; padding: 2px 0; margin: 2px 0 0; font-size: 12px; color: var(--wp-accent-text); cursor: pointer; }
.wp-ai-chat__opts .wp-ai-chat__more { margin: 0 8px 4px; }
.wp-ai-chat__warning-text { display: inline; }
.wp-ai-chat__warning-text :deep(p) { display: inline; margin: 0; }
.wp-ai-chat__note { margin: 0; font-size: 12px; color: var(--wp-text-muted); display: flex; align-items: baseline; gap: 6px; }
.wp-ai-chat__warnings { list-style: none; margin: 0; padding: 0; font-size: 12px; color: var(--wp-warn); display: flex; flex-direction: column; gap: 2px; }
.wp-ai-chat__warnings li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 6px; }
.wp-ai-chat__warning-body { flex: 1 1 200px; min-width: 0; overflow-wrap: anywhere; }
.wp-ai-chat__warnings li[data-note="true"] { color: var(--wp-text-muted); }
.wp-ai-chat__warn-more { justify-content: flex-end; }
/* Fix it: a small outlined action in the warning's tone, at the end of its line. */
.wp-ai-chat__fix {
  flex: none; margin-left: auto; display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 8px; border-radius: var(--wp-radius-sm); font-size: 11.5px; cursor: pointer;
  border: 1px solid color-mix(in srgb, var(--wp-warn) 45%, transparent);
  background: color-mix(in srgb, var(--wp-warn) 10%, transparent); color: var(--wp-text);
}
.wp-ai-chat__fix:hover:not(:disabled) { background: color-mix(in srgb, var(--wp-warn) 22%, transparent); }
.wp-ai-chat__fix:disabled { opacity: 0.5; cursor: default; }
.wp-ai-chat__fix .pi { font-size: 10px; color: var(--wp-warn); }
.wp-ai-chat__actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.wp-ai-chat__done { font-size: 12px; color: var(--wp-success); margin-right: auto; display: inline-flex; gap: 5px; align-items: center; }
.wp-ai-chat__dismissed, .wp-ai-chat__blocked { font-size: 12px; color: var(--wp-text-muted); margin-right: auto; }
/* Why a card waits gets a row of its own above the buttons, so Dismiss
 * stays with Open in editor and Apply instead of wrapping beside it. */
.wp-ai-chat__blocked { flex: 1 0 100%; }
.wp-ai-chat__status { margin: 0; font-size: 12px; color: var(--wp-text-muted); display: flex; gap: 6px; align-items: center; }
.wp-ai-chat__foot { border-top: 1px solid var(--wp-border); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.wp-ai-chat__input { width: 100%; resize: vertical; font-size: 13px; max-height: 40vh; }
.wp-ai-chat__controls { display: flex; align-items: center; gap: 10px; }
.wp-ai-chat__hint { flex: 1; font-size: 11px; color: var(--wp-text-dim); }
.wp-ai-chat__error { margin: 0; font-size: 12px; color: var(--wp-danger); }
.wp-ai-chat__drop {
  position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column; gap: 8px;
  align-items: center; justify-content: center; padding: 24px; text-align: center; pointer-events: none;
  font-size: 13px; color: var(--wp-accent-text);
  background: color-mix(in oklab, var(--wp-bg-1) 82%, transparent);
  border: 2px dashed var(--wp-accent-500); border-radius: 8px;
}
.wp-ai-chat__drop .pi { font-size: 26px; }
.wp-ai-chat__pics { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.wp-ai-chat__pic { padding: 0; border: 0; background: none; cursor: zoom-in; border-radius: 6px; overflow: hidden; line-height: 0; }
.wp-ai-chat__pic img { width: 96px; height: 96px; object-fit: cover; display: block; }
.wp-ai-chat__pic[data-big] { cursor: zoom-out; }
.wp-ai-chat__pic[data-big] img { width: auto; height: auto; max-width: 100%; max-height: 60vh; object-fit: contain; }
.wp-ai-chat__attached { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.wp-ai-chat__thumb { position: relative; width: 56px; height: 56px; border-radius: 6px; overflow: hidden; border: 1px solid var(--wp-border); }
.wp-ai-chat__thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.wp-ai-chat__thumb button {
  position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
  background: rgb(0 0 0 / 0.65); color: #fff;
}
.wp-ai-chat__thumb button .pi { font-size: 9px; }
.wp-ai-chat__vision-note { font-size: 11px; color: var(--wp-text-dim); flex: 1; min-width: 120px; }
.wp-ai-chat__image-ideas { display: flex; flex-wrap: wrap; gap: 6px; }
.wp-ai-chat__suggestion--small { padding: 4px 8px; font-size: 12px; }
.wp-ai-chat__attach:disabled { opacity: 0.45; cursor: default; }
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
