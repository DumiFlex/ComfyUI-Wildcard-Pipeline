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
 */
import { computed, ref, shallowRef, triggerRef } from "vue";
import { api, ApiError } from "../api/client";
import type { AiChatEvent, AiChatPage, AiChatProposal, AiChatResult } from "../api/types";
import { useModuleStore } from "../stores/moduleStore";
import { useBundleStore } from "../stores/bundleStore";
import { useTemplateStore } from "../stores/templateStore";
import { useCategoryStore } from "../stores/categoryStore";
import { openEditor } from "./useOpenEditor";

export type ProposalStatus = "applied" | "editor" | "dismissed" | "failed";

export interface ChatUserEntry {
  role: "user";
  text: string;
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
}

export type ChatEntry = ChatUserEntry | ChatAssistantEntry;

const open = ref(false);
const input = ref("");
/** A question a page asked for (`ask`); the drawer sends it with its page
 *  context as soon as it is open. */
const queued = ref("");
const entries = shallowRef<ChatEntry[]>([]);
const loading = ref(false);
const error = ref("");
let controller: AbortController | null = null;

/** The server's id for this chat; null until the first answer. */
const chatId = ref<string | null>(null);
/** Card actions not yet sent, newest per proposal. */
let pending: AiChatEvent[] = [];

function record(pid: string, status: AiChatEvent["status"]): void {
  pending = [...pending.filter((e) => e.pid !== pid), { pid, status }];
}

function touch(): void {
  triggerRef(entries);
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
  if (!text || loading.value) return;
  const next: ChatEntry[] = [...entries.value, { role: "user", text }];
  entries.value = next;
  input.value = "";
  error.value = "";
  const mine = new AbortController();
  controller = mine;
  loading.value = true;
  const snap = page?.editor ? editorJson() : undefined;
  const events = pending;
  const id = chatId.value;
  try {
    const result = await api.ai.chat({
      message: text,
      ...(id ? { chat_id: id } : {}),
      ...(page ? { page } : {}),
      ...(events.length ? { events } : {}),
    }, mine.signal);
    if (chatId.value === id) {
      chatId.value = result.chat_id;
      pending = pending.filter((e) => !events.includes(e));
    }
    entries.value = [
      ...entries.value,
      {
        role: "assistant", result, status: {}, created: {}, errors: {},
        ...(snap ? { editorSnap: snap } : {}),
      },
    ];
  } catch (err) {
    // Put the message back so it can be sent again.
    if (entries.value[entries.value.length - 1] === next[next.length - 1]) {
      entries.value = entries.value.slice(0, -1);
    }
    input.value = text;
    if (err instanceof DOMException && err.name === "AbortError") return;
    error.value = err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong";
  } finally {
    if (controller === mine) {
      controller = null;
      loading.value = false;
    }
  }
}

function stop(): void {
  controller?.abort();
  controller = null;
  loading.value = false;
}

function reset(): void {
  stop();
  entries.value = [];
  error.value = "";
  chatId.value = null;
  pending = [];
}

/** Why a proposal can't be applied yet, else "". */
function blockedReason(entry: ChatAssistantEntry, p: AiChatProposal): string {
  const op = p.op;
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

async function apply(entry: ChatAssistantEntry, p: AiChatProposal): Promise<void> {
  const op = p.op;
  if (op.op === "open" || blockedReason(entry, p)) return;
  const modules = useModuleStore();
  const bundles = useBundleStore();
  const templates = useTemplateStore();
  delete entry.errors[p.pid];
  try {
    if (op.op === "create") {
      const cid = await categoryId(op.new_category);
      const extra = cid === undefined ? {} : { category_id: cid };
      const row = op.kind === "bundle" ? await bundles.create({ ...op.body, ...extra })
        : op.kind === "template" ? await templates.create({ ...op.body, ...extra })
          : await modules.create({ ...op.body, ...extra });
      entry.created[p.pid] = row.id;
    } else if (op.op === "update") {
      const body = { ...op.body };
      if (op.new_category) body.category_id = (await categoryId(op.new_category)) ?? null;
      const ed = op.basis === "editor" ? openEditor() : null;
      if (ed && ed.id === op.id) {
        ed.write(body);
        entry.editorSnap = editorJson();
        entry.status[p.pid] = "editor";
        record(p.pid, "editor");
        touch();
        return;
      }
      if (op.kind === "module") await modules.update(op.id, body);
      else if (op.kind === "template") await templates.update(op.id, body);
      else await bundles.update(op.id, body);
    }
    entry.status[p.pid] = "applied";
    record(p.pid, "applied");
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
    if (op.op === "create") {
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
    open, input, entries, loading, error, started, queued, chatId,
    send, stop, reset, apply, undo, dismiss, blockedReason, ask,
  };
}

/** Test seam. */
export function _resetAiChatForTests(): void {
  reset();
  open.value = false;
  input.value = "";
  queued.value = "";
}
