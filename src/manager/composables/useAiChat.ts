/**
 * useAiChat — the assistant chat's state, one module-level copy so the top
 * bar button and the drawer agree, and the conversation survives closing
 * the drawer.
 *
 * The server keeps the chat (its tool calls, results and proposal cards), so
 * a send carries only the new message, the chat's id and what the user did
 * with the cards since (`events`), which the model is told. Applying a
 * proposal goes through the same stores
 * the editors use; Undo restores what the proposal replaced. A change built
 * on the open editor's unsaved version goes into that editor instead
 * (`useOpenEditor`), where Save keeps it.
 *
 * A turn can pause on page tools (open a page, point at something, hand
 * work to a page's AI feature) and on web searches: page tools run here
 * (`useAiActions`), a search waits for the user's Allow or Deny, and the
 * answers carry the turn on (`AiChatResume`) until nothing waits.
 *
 * Answers stream in (`api.ai.chatStream`): `live` holds what the model has
 * written so far and what it is doing, until the finished answer replaces
 * it. Stored chats can be reopened (`load`), the last message run again
 * (`retry`), and older turns summarised to make room (`compact`).
 */
import { computed, ref, shallowRef, triggerRef } from "vue";
import { api, ApiError } from "../api/client";
import type {
  AiCallAnswer, AiChatContext, AiChatEvent, AiChatPage, AiChatProposal, AiChatResult,
  AiChatRetry, AiChatRequest, AiChatResume, AiChatStreamEvent, AiPendingCall,
} from "../api/types";
import { useModuleStore } from "../stores/moduleStore";
import { useBundleStore } from "../stores/bundleStore";
import { useTemplateStore } from "../stores/templateStore";
import { useCategoryStore } from "../stores/categoryStore";
import { openEditor, stageDraft } from "./useOpenEditor";
import { useAiConfig } from "./useAiConfig";
import { applyManage, isManageOp, undoManage } from "./aiManageOps";
import { EDIT_ROUTES, runCall, type AiActionHost } from "./useAiActions";
import { cardOptions, draftRoute, withoutOptions } from "./aiCards";
import { MAX_IMAGES, prepareImage, type ChatImage } from "../utils/chat-image";

/** The user's answer to a web search the model asked for. */
export type SearchApproval = "once" | "chat" | "deny";

export type ProposalStatus = "applied" | "editor" | "dismissed" | "failed" | "opened" | "replaced";

export interface ChatUserEntry {
  role: "user";
  text: string;
  /** Attached images as data URLs. */
  images?: string[];
}

export interface ChatAssistantEntry {
  role: "assistant";
  result: AiChatResult;
  status: Record<string, ProposalStatus>;
  /** Id of the row a create proposal made, for Open and Undo. */
  created: Record<string, string>;
  errors: Record<string, string>;
  /** The open editor's item when this answer was asked for, to spot edits
   *  made in the editor since (then a proposal built on it is stale). */
  editorSnap?: { id: string; json: string };
  /** The user's answers to the web searches this answer asked for. */
  approved?: Record<string, SearchApproval>;
  /** Cards auto-apply applied (Settings › AI assistant › Permissions). */
  auto?: Record<string, true>;
  /** Options the user unticked on a card, by proposal: left out when it is
   *  applied or opened in an editor. */
  skip?: Record<string, string[]>;
}

export type ChatEntry = ChatUserEntry | ChatAssistantEntry;

const open = ref(false);
const input = ref("");
/** A question a page asked for (`ask`); the drawer sends it with its page
 *  context as soon as it is open. */
const queued = ref("");
const entries = shallowRef<ChatEntry[]>([]);
/** Most cards auto-apply applies from one answer. */
const MAX_AUTO = 20;
const loading = ref(false);
const error = ref("");
let controller: AbortController | null = null;

/** The server's id for this chat; null until the first answer. */
const chatId = ref<string | null>(null);
/** Card actions not yet sent, newest per proposal. */
let pending: AiChatEvent[] = [];
/** Runs page tools; set by the drawer, which knows the router. */
let host: AiActionHost | null = null;
/** Web searches waiting for the user's Allow or Deny, by call id. */
const asking = shallowRef<ReadonlySet<string>>(new Set());
const approvals = new Map<string, (choice: SearchApproval | null) => void>();
/** Page tools running now (their labels), for the status line. */
const running = ref("");
/** The answer being written: its text so far, what the model is doing,
 *  and the steps it has taken. Cleared when the answer arrives. */
export interface LiveAnswer {
  text: string;
  status: string;
  thinking: boolean;
  steps: Array<{ tool: string; note: string; ok: boolean }>;
}
const EMPTY_LIVE: LiveAnswer = { text: "", status: "", thinking: false, steps: [] };
const live = shallowRef<LiveAnswer>(EMPTY_LIVE);
/** How full the model's window is (from the last answer). */
const context = ref<AiChatContext | null>(null);
const compacting = ref(false);
/** Images waiting to go with the next message. */
const attachments = shallowRef<ChatImage[]>([]);
/** Whether the chosen model sees images (null: the server didn't say). */
const vision = ref<boolean | null>(null);
const visionModel = ref("");

function record(pid: string, status: AiChatEvent["status"], created?: string, leftOut = 0): void {
  const ev: AiChatEvent = created ? { pid, status, created } : { pid, status };
  if (leftOut > 0) ev.left_out = leftOut;
  pending = [...pending.filter((e) => e.pid !== pid), ev];
  // Saved now too, so the chat reopens with its cards as they are.
  const id = chatId.value;
  if (id) void api.ai.patchChat(id, { events: [ev] }).catch(() => undefined);
}

function onEvent(ev: AiChatStreamEvent): void {
  const cur = live.value;
  if (ev.type === "step") live.value = { ...cur, text: "", thinking: false, status: "" };
  else if (ev.type === "text") live.value = { ...cur, text: ev.v, thinking: false };
  else if (ev.type === "thinking") live.value = { ...cur, thinking: true };
  else if (ev.type === "status") live.value = { ...cur, status: ev.v };
  else if (ev.type === "tool") live.value = { ...cur, steps: [...cur.steps, ev.step] };
}

/** One request of a turn, streamed. */
async function turn(
  body: AiChatRequest | AiChatResume | AiChatRetry, signal: AbortSignal,
): Promise<AiChatResult> {
  live.value = EMPTY_LIVE;
  try {
    const result = await api.ai.chatStream(body, onEvent, signal);
    if (result.context) context.value = result.context;
    return result;
  } finally {
    live.value = EMPTY_LIVE;
  }
}

function touch(): void {
  triggerRef(entries);
}

/** Show an answer, then apply its small changes when auto-apply is on. */
async function pushAnswer(result: AiChatResult, snap?: { id: string; json: string }): Promise<void> {
  const entry: ChatAssistantEntry = {
    role: "assistant", result, status: {}, created: {}, errors: {},
    ...(snap ? { editorSnap: snap } : {}),
  };
  entries.value = [...entries.value, entry];
  markReplaced(result);
  await autoApply(entry);
}

/** Cards a newer card replaces (the model revised an item they would
 *  create) can't be applied any more. */
function markReplaced(result: AiChatResult): void {
  for (const p of result.proposals) {
    if (!p.replaces) continue;
    for (const e of entries.value) {
      if (e.role !== "assistant" || e.status[p.replaces]) continue;
      if (!e.result.proposals.some((x) => x.pid === p.replaces)) continue;
      e.status[p.replaces] = "replaced";
      record(p.replaces, "replaced");
    }
  }
  touch();
}

/** Apply the cards the server marked low risk, in order, when the user
 *  turned auto-apply on. A blocked card (it waits on another, or the
 *  editor changed) stays a card. At most MAX_AUTO per answer. */
async function autoApply(entry: ChatAssistantEntry): Promise<void> {
  if (!useAiConfig().config.value?.auto_apply) return;
  let n = 0;
  for (const p of entry.result.proposals) {
    if (n >= MAX_AUTO) break;
    if (p.risk !== "low" || entry.status[p.pid] || blockedReason(entry, p)) continue;
    await apply(entry, p);
    const st = entry.status[p.pid];
    if (st === "applied" || st === "editor") {
      entry.auto = { ...entry.auto, [p.pid]: true };
      n += 1;
    }
  }
  if (n) touch();
}

function editorJson(): { id: string; json: string } | undefined {
  const ed = openEditor();
  if (!ed) return undefined;
  const state: Partial<ReturnType<typeof ed.read>> = ed.read();
  delete state.dirty;
  return { id: ed.id, json: JSON.stringify(state) };
}

async function send(page?: AiChatPage): Promise<void> {
  const text = input.value.trim();
  const pics = attachments.value;
  if ((!text && !pics.length) || loading.value) return;
  const user: ChatUserEntry = pics.length
    ? { role: "user", text, images: pics.map((p) => p.url) }
    : { role: "user", text };
  const next: ChatEntry[] = [...entries.value, user];
  entries.value = next;
  input.value = "";
  attachments.value = [];
  error.value = "";
  const mine = new AbortController();
  controller = mine;
  loading.value = true;
  const snap = page?.editor ? editorJson() : undefined;
  const events = pending;
  const id = chatId.value;
  try {
    const result = await turn({
      message: text,
      ...(id ? { chat_id: id } : {}),
      ...(page ? { page } : {}),
      ...(events.length ? { events } : {}),
      ...(pics.length ? { images: pics.map((p) => ({ data: p.url })) } : {}),
    }, mine.signal);
    if (chatId.value === id) {
      chatId.value = result.chat_id;
      pending = pending.filter((e) => !events.includes(e));
    }
    await pushAnswer(result, snap);
    await carryOn(result, mine.signal);
  } catch (err) {
    unsent(next, text, pics);
    if (err instanceof DOMException && err.name === "AbortError") return;
    error.value = err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong";
  } finally {
    if (controller === mine) {
      controller = null;
      loading.value = false;
      running.value = "";
    }
  }
}

/** Index of the last user message, or -1. */
function lastUserIndex(): number {
  for (let i = entries.value.length - 1; i >= 0; i--) {
    if (entries.value[i].role === "user") return i;
  }
  return -1;
}

/** Why the last answer can't be run again, else "". */
function retryBlocked(): string {
  const start = lastUserIndex();
  if (start < 0 || !chatId.value) return "Nothing to try again";
  const applied = entries.value.slice(start + 1).some((e) => e.role === "assistant"
    && Object.values(e.status).some((st) => st === "applied" || st === "editor"));
  return applied ? "Undo the changes you applied from this answer first" : "";
}

/** Run the last message again: its answer goes, a new one comes. */
async function retry(page?: AiChatPage): Promise<void> {
  if (loading.value || retryBlocked()) return;
  const id = chatId.value;
  if (!id) return;
  const before = entries.value;
  entries.value = before.slice(0, lastUserIndex() + 1);
  error.value = "";
  const mine = new AbortController();
  controller = mine;
  loading.value = true;
  const snap = page?.editor ? editorJson() : undefined;
  const events = pending;
  try {
    const result = await turn({
      chat_id: id, retry: true, message: "",
      ...(page ? { page } : {}),
      ...(events.length ? { events } : {}),
    }, mine.signal);
    pending = pending.filter((e) => !events.includes(e));
    await pushAnswer(result, snap);
    await carryOn(result, mine.signal);
  } catch (err) {
    // The old answer is still the stored one: show it again.
    if (entries.value.length === lastUserIndex() + 1) entries.value = before;
    if (err instanceof DOMException && err.name === "AbortError") return;
    error.value = err instanceof Error ? err.message : "Something went wrong";
  } finally {
    if (controller === mine) {
      controller = null;
      loading.value = false;
      running.value = "";
    }
  }
}

/** Reopen a stored chat. */
async function load(id: string): Promise<void> {
  if (loading.value) return;
  const chat = await api.ai.getChat(id);
  reset();
  chatId.value = chat.id;
  context.value = chat.context;
  entries.value = chat.turns.map((t): ChatEntry => t.role === "user"
    ? (t.images?.length ? { role: "user", text: t.text, images: t.images } : { role: "user", text: t.text })
    : {
        role: "assistant",
        result: {
          chat_id: chat.id, message: t.view.message ?? "", proposals: t.view.proposals ?? [],
          steps: t.view.steps ?? [], model: t.view.model ?? "", refs: t.view.refs ?? {},
          pending: t.view.pending ?? [],
        },
        status: { ...t.status }, created: { ...t.created }, errors: {},
      });
}

/** Summarise this chat's older turns now. Returns an error message, or "". */
async function compact(): Promise<string> {
  const id = chatId.value;
  if (!id || loading.value || compacting.value) return "";
  compacting.value = true;
  try {
    context.value = (await api.ai.compactChat(id)).context;
    return "";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  } finally {
    compacting.value = false;
  }
}

/** Put a message that got no answer back in the box, to send again. */
function unsent(next: ChatEntry[], text: string, pics: ChatImage[] = []): void {
  if (entries.value[entries.value.length - 1] === next[next.length - 1]) {
    entries.value = entries.value.slice(0, -1);
    input.value = text;
    attachments.value = pics;
  }
}

/** Shrink and attach image files (dropped, pasted or picked). Returns
 *  what went wrong, or "". */
async function addFiles(files: Iterable<File>): Promise<string> {
  const list = [...files].filter((f) => f.type.startsWith("image/"));
  if (!list.length) return "Only images can be attached";
  if (vision.value === false) {
    return `${visionModel.value || "This model"} can't see images. Pick a vision model (Gemma 3, Qwen2.5-VL, Llama 3.2 Vision, …) to send one.`;
  }
  const room = MAX_IMAGES - attachments.value.length;
  if (room <= 0) return `At most ${MAX_IMAGES} images per message`;
  const problems: string[] = [];
  const added: ChatImage[] = [];
  for (const f of list.slice(0, room)) {
    try {
      added.push(await prepareImage(f, f.name || "image"));
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
  }
  attachments.value = [...attachments.value, ...added];
  if (list.length > room) problems.push(`At most ${MAX_IMAGES} images per message`);
  return problems.join(". ");
}

function removeAttachment(i: number): void {
  attachments.value = attachments.value.filter((_, j) => j !== i);
}

/** Ask the server whether the chosen model sees images. */
async function checkVision(): Promise<void> {
  try {
    const got = await api.ai.vision();
    vision.value = got.vision;
    visionModel.value = got.model;
  } catch {
    vision.value = null;
  }
}

/** While the turn waits on calls: answer them and send the answers, each
 *  continuation showing as its own reply. Stop leaves the calls waiting;
 *  the next message tells the model they didn't run. */
async function carryOn(first: AiChatResult, signal: AbortSignal): Promise<void> {
  let result = first;
  while (result.pending?.length) {
    const entry = entries.value[entries.value.length - 1];
    if (entry?.role !== "assistant") return;
    const answers = await answerCalls(entry, result.pending, signal);
    if (!answers) return;
    const page = host?.page();
    const snap = page?.editor ? editorJson() : undefined;
    result = await turn({
      chat_id: result.chat_id, results: answers, ...(page ? { page } : {}),
    }, signal);
    await pushAnswer(result, snap);
  }
}

async function answerCalls(
  entry: ChatAssistantEntry, calls: AiPendingCall[], signal: AbortSignal,
): Promise<AiCallAnswer[] | null> {
  const out: AiCallAnswer[] = [];
  for (const call of calls) {
    if (signal.aborted) return null;
    if (call.tool === "web_search") {
      const choice = await approval(call.id, signal);
      if (!choice) return null;
      entry.approved = { ...entry.approved, [call.id]: choice };
      touch();
      out.push(choice === "deny" ? { id: call.id, denied: true } : { id: call.id, approve: choice });
      continue;
    }
    running.value = call.label;
    const text = !host ? "couldn't: the page isn't ready"
      : call.tool === "open" && "proposal" in call.args ? await openProposal(entry, call.args.proposal)
        : await runCall(call, host);
    running.value = "";
    out.push({ id: call.id, text });
  }
  return signal.aborted ? null : out;
}

function approval(id: string, signal: AbortSignal): Promise<SearchApproval | null> {
  return new Promise((resolve) => {
    const done = (choice: SearchApproval | null): void => {
      approvals.delete(id);
      const next = new Set(asking.value);
      next.delete(id);
      asking.value = next;
      resolve(choice);
    };
    approvals.set(id, done);
    asking.value = new Set([...asking.value, id]);
    signal.addEventListener("abort", () => done(null), { once: true });
  });
}

/** The user's Allow once / Allow for this chat / Deny on a web search. */
function answerSearch(id: string, choice: SearchApproval): void {
  approvals.get(id)?.(choice);
}

/** The drawer hands over how to navigate and read the page. */
function attach(next: AiActionHost | null): void {
  host = next;
}

function stop(): void {
  controller?.abort();
  controller = null;
  loading.value = false;
  running.value = "";
}

function reset(): void {
  stop();
  entries.value = [];
  error.value = "";
  chatId.value = null;
  pending = [];
  context.value = null;
  live.value = EMPTY_LIVE;
  attachments.value = [];
}

/** Why a proposal can't be applied yet, else "". */
function blockedReason(entry: ChatAssistantEntry, p: AiChatProposal): string {
  const op = p.op;
  if (op.op === "delete" && !entry.status[p.pid] && !useAiConfig().config.value?.allow_delete) {
    return "Deleting is turned off in Settings › AI assistant";
  }
  if (op.op === "update" && op.basis === "editor" && !entry.status[p.pid]) {
    const ed = openEditor();
    if (!ed || ed.id !== op.id) return `Open ${op.name} in its editor to apply`;
    const now = editorJson();
    if (entry.editorSnap && now && entry.editorSnap.json !== now.json) {
      return "The editor changed since; ask again";
    }
  }
  if (!p.after || entry.status[p.after] === "applied" || entry.status[p.after] === "editor") {
    return "";
  }
  const first = entry.result.proposals.find((x) => x.pid === p.after);
  return `Apply "${first?.title ?? "the earlier change"}" first`;
}

async function categoryId(name: string | undefined): Promise<string | null | undefined> {
  if (!name) return undefined;
  const cats = useCategoryStore();
  const found = cats.items.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  return (await cats.create({ name })).id;
}

/** Tick or untick one of a card's new options. */
function toggleOption(entry: ChatAssistantEntry, p: AiChatProposal, id: string): void {
  const now = new Set(entry.skip?.[p.pid] ?? []);
  if (now.has(id)) now.delete(id);
  else now.add(id);
  entry.skip = { ...entry.skip, [p.pid]: [...now] };
  touch();
}

/** Tick all of a card's new options, or none. */
function setAllOptions(entry: ChatAssistantEntry, p: AiChatProposal, on: boolean): void {
  const ids = on ? [] : (cardOptions(p) ?? []).map((o) => o.id);
  entry.skip = { ...entry.skip, [p.pid]: ids };
  touch();
}

function skipped(entry: ChatAssistantEntry, p: AiChatProposal): Set<string> {
  return new Set(entry.skip?.[p.pid] ?? []);
}

/** "Open in editor": a proposed new wildcard or derivation opens in a new
 *  editor, filled and unsaved; added options go into the item's editor.
 *  Saving there is up to the user. */
async function openInEditor(entry: ChatAssistantEntry, p: AiChatProposal): Promise<void> {
  if (!host || entry.status[p.pid]) return;
  const skip = skipped(entry, p);
  const op = withoutOptions(p.op, skip);
  delete entry.errors[p.pid];
  try {
    if (op.op === "create" && op.kind === "module") {
      const route = draftRoute(p);
      if (!route) return;
      stageDraft({ type: op.body.type, body: { ...op.body }, newCategory: op.new_category || undefined });
      if (!(await host.navigate({ name: route }))) {
        stageDraft({ type: "", body: {} });
        entry.errors[p.pid] = "Couldn't open the editor: the page you're on has unsaved changes.";
        touch();
        return;
      }
      entry.status[p.pid] = "opened";
      record(p.pid, "opened", undefined, skip.size);
    } else if (op.op === "update" && op.kind === "module") {
      const route = EDIT_ROUTES[op.type];
      const ed0 = openEditor();
      if (!(ed0 && ed0.id === op.id)) {
        if (!route || !(await host.navigate({ name: route, params: { id: op.id } }))) {
          entry.errors[p.pid] = "Couldn't open the editor.";
          touch();
          return;
        }
      }
      const ed = await waitForEditor(op.id);
      if (!ed) {
        entry.errors[p.pid] = "The editor didn't open in time; try again.";
        touch();
        return;
      }
      const body = { ...op.body };
      if (op.new_category) body.category_id = (await categoryId(op.new_category)) ?? null;
      ed.write(body);
      entry.editorSnap = editorJson();
      entry.status[p.pid] = "editor";
      record(p.pid, "editor", undefined, skip.size);
    }
  } catch (err) {
    entry.errors[p.pid] = err instanceof Error ? err.message : String(err);
  }
  touch();
}

/** The chat's `open {"proposal"}`: open a card in its editor, as its
 *  "Open in editor" button does. */
async function openProposal(current: ChatAssistantEntry, pid: string): Promise<string> {
  const all = [current, ...entries.value.filter((e): e is ChatAssistantEntry => e.role === "assistant")];
  for (const entry of all) {
    const p = entry.result.proposals.find((x) => x.pid === pid);
    if (!p) continue;
    const status = entry.status[pid];
    if (status && status !== "opened") return `couldn't: that card is already ${status}`;
    if (p.op.op === "create" && !draftRoute(p)) {
      return "couldn't: only new wildcards and derivations open unsaved; the user has to apply this card";
    }
    if (p.op.op !== "create" && !(p.op.op === "update" && p.op.kind === "module")) {
      return "couldn't: this card doesn't open in an editor; the user has to apply it";
    }
    delete entry.status[pid];
    await openInEditor(entry, p);
    const err = entry.errors[pid];
    return err ? `couldn't: ${err}` : `opened ${p.title} in its editor, unsaved; the user saves it there`;
  }
  return `couldn't: no card ${pid} in this chat`;
}

async function waitForEditor(id: string): Promise<ReturnType<typeof openEditor>> {
  for (let waited = 0; waited < 5000; waited += 100) {
    const ed = openEditor();
    if (ed && ed.id === id) {
      // Let the editor finish loading its row before writing into it.
      await new Promise((r) => setTimeout(r, 300));
      return openEditor()?.id === id ? openEditor() : null;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

async function apply(entry: ChatAssistantEntry, p0: AiChatProposal): Promise<void> {
  const skip = skipped(entry, p0);
  const p = skip.size ? { ...p0, op: withoutOptions(p0.op, skip) } : p0;
  const op = p.op;
  if (op.op === "open" || blockedReason(entry, p0)) return;
  const modules = useModuleStore();
  const bundles = useBundleStore();
  const templates = useTemplateStore();
  delete entry.errors[p.pid];
  try {
    if (isManageOp(op)) {
      await applyManage(op);
    } else if (op.op === "create") {
      const cid = await categoryId(op.new_category);
      const extra = cid === undefined ? {} : { category_id: cid };
      const row = op.kind === "bundle" ? await bundles.create({ ...op.body, ...extra })
        : op.kind === "template" ? await templates.create({ ...op.body, ...extra })
          : await modules.create({ ...op.body, ...extra });
      entry.created[p.pid] = row.id;
      entry.status[p.pid] = "applied";
      record(p.pid, "applied", row.id, skip.size);
      touch();
      return;
    } else if (op.op === "update") {
      const body = { ...op.body };
      if (op.new_category) body.category_id = (await categoryId(op.new_category)) ?? null;
      const ed = op.basis === "editor" ? openEditor() : null;
      if (ed && ed.id === op.id) {
        ed.write(body);
        entry.editorSnap = editorJson();
        entry.status[p.pid] = "editor";
        record(p.pid, "editor", undefined, skip.size);
        touch();
        return;
      }
      if (op.kind === "module") await modules.update(op.id, body);
      else if (op.kind === "template") await templates.update(op.id, body);
      else await bundles.update(op.id, body);
    }
    entry.status[p.pid] = "applied";
    record(p.pid, "applied", undefined, skip.size);
  } catch (err) {
    entry.status[p.pid] = "failed";
    entry.errors[p.pid] = err instanceof Error ? err.message : String(err);
    record(p.pid, "failed");
  }
  touch();
}

async function undo(entry: ChatAssistantEntry, p: AiChatProposal): Promise<void> {
  const op = p.op;
  if (op.op === "update" && entry.status[p.pid] === "editor") {
    const ed = openEditor();
    if (!ed || ed.id !== op.id) {
      entry.errors[p.pid] = `Open ${op.name} in its editor to undo`;
    } else {
      ed.write(op.before);
      entry.editorSnap = editorJson();
      delete entry.status[p.pid];
      delete entry.errors[p.pid];
      record(p.pid, "undone");
    }
    touch();
    return;
  }
  if (entry.status[p.pid] !== "applied" || op.op === "open") return;
  try {
    if (isManageOp(op)) {
      await undoManage(op);
    } else if (op.op === "create") {
      const id = entry.created[p.pid];
      if (id && op.kind === "bundle") await useBundleStore().remove(id);
      else if (id && op.kind === "template") await useTemplateStore().remove(id);
      else if (id) await useModuleStore().remove(id);
      delete entry.created[p.pid];
    } else if (op.kind === "module") {
      await useModuleStore().update(op.id, op.before);
    } else if (op.kind === "template") {
      await useTemplateStore().update(op.id, op.before);
    } else {
      await useBundleStore().update(op.id, op.before);
    }
    delete entry.status[p.pid];
    if (entry.auto) delete entry.auto[p.pid];
    record(p.pid, "undone");
  } catch (err) {
    entry.errors[p.pid] = err instanceof Error ? err.message : String(err);
  }
  touch();
}

/** Open the chat and send `text` (from a page button, like the Test
 *  Runner's "Explain this run"). */
function ask(text: string): void {
  if (loading.value) return;
  input.value = text;
  open.value = true;
  queued.value = text;
}

function dismiss(entry: ChatAssistantEntry, p: AiChatProposal): void {
  entry.status[p.pid] = "dismissed";
  record(p.pid, "dismissed");
  touch();
}

const started = computed(() => entries.value.length > 0);

export function useAiChat() {
  return {
    open, input, entries, loading, error, started, queued, chatId, asking, running, live,
    context, compacting,
    send, stop, reset, apply, undo, dismiss, blockedReason, ask, answerSearch, attach,
    toggleOption, setAllOptions, openInEditor,
    retry, retryBlocked, load, compact,
    attachments, vision, visionModel, addFiles, removeAttachment, checkVision,
  };
}

/** Test seam. */
export function _resetAiChatForTests(): void {
  reset();
  open.value = false;
  input.value = "";
  queued.value = "";
  vision.value = null;
  visionModel.value = "";
}
