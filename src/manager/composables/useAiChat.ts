/**
 * useAiChat — the assistant chat's state, one module-level copy so the top
 * bar button and the drawer agree, and the conversation survives closing
 * the drawer.
 *
 * The server keeps nothing between turns: every send carries the whole
 * conversation. An assistant message goes back as its reply plus one line
 * per proposal saying whether the user applied it, so the model knows what
 * the library now holds. Applying a proposal goes through the same stores
 * the editors use; Undo restores what the proposal replaced.
 */
import { computed, ref, shallowRef, triggerRef } from "vue";
import { api, ApiError } from "../api/client";
import type { AiChatMessage, AiChatProposal, AiChatResult } from "../api/types";
import { useModuleStore } from "../stores/moduleStore";
import { useBundleStore } from "../stores/bundleStore";
import { useCategoryStore } from "../stores/categoryStore";

/** Server cap on messages per request (20 turns each way). */
const MAX_MESSAGES = 40;

export type ProposalStatus = "applied" | "dismissed" | "failed";

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
}

export type ChatEntry = ChatUserEntry | ChatAssistantEntry;

const open = ref(false);
const input = ref("");
const entries = shallowRef<ChatEntry[]>([]);
const loading = ref(false);
const error = ref("");
let controller: AbortController | null = null;

function statusLine(entry: ChatAssistantEntry, p: AiChatProposal): string {
  const s = entry.status[p.pid];
  const what = s === "applied" ? "applied" : s === "dismissed" ? "dismissed" : "not applied yet";
  return `[Proposal ${p.pid} "${p.title}": ${what}]`;
}

/** The conversation as the server takes it. */
export function chatMessages(list: ChatEntry[]): AiChatMessage[] {
  return list.map((e) => {
    if (e.role === "user") return { role: "user", content: e.text };
    const lines = [e.result.message, ...e.result.proposals.map((p) => statusLine(e, p))];
    return { role: "assistant", content: lines.filter(Boolean).join("\n") };
  });
}

function touch(): void {
  triggerRef(entries);
}

async function send(page?: { route: string; id?: string }): Promise<void> {
  const text = input.value.trim();
  if (!text || loading.value) return;
  const next: ChatEntry[] = [...entries.value, { role: "user", text }];
  if (next.length > MAX_MESSAGES) {
    error.value = "This chat is long. Start a new one to keep it focused.";
    return;
  }
  entries.value = next;
  input.value = "";
  error.value = "";
  const mine = new AbortController();
  controller = mine;
  loading.value = true;
  try {
    const result = await api.ai.chat({ messages: chatMessages(next), page }, mine.signal);
    entries.value = [
      ...entries.value,
      { role: "assistant", result, status: {}, created: {}, errors: {} },
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
}

/** Why a proposal can't be applied yet, else "". */
function blockedReason(entry: ChatAssistantEntry, p: AiChatProposal): string {
  if (!p.after || entry.status[p.after] === "applied") return "";
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
  delete entry.errors[p.pid];
  try {
    if (op.op === "create") {
      const cid = await categoryId(op.new_category);
      const body = cid === undefined ? op.body : { ...op.body, category_id: cid };
      const row = await modules.create(body);
      entry.created[p.pid] = row.id;
    } else {
      const body = { ...op.body };
      if (op.new_category) body.category_id = (await categoryId(op.new_category)) ?? null;
      if (op.kind === "module") await modules.update(op.id, body);
      else await bundles.update(op.id, body);
    }
    entry.status[p.pid] = "applied";
  } catch (err) {
    entry.status[p.pid] = "failed";
    entry.errors[p.pid] = err instanceof Error ? err.message : String(err);
  }
  touch();
}

async function undo(entry: ChatAssistantEntry, p: AiChatProposal): Promise<void> {
  const op = p.op;
  if (entry.status[p.pid] !== "applied" || op.op === "open") return;
  try {
    if (op.op === "create") {
      const id = entry.created[p.pid];
      if (id) await useModuleStore().remove(id);
      delete entry.created[p.pid];
    } else if (op.kind === "module") {
      await useModuleStore().update(op.id, op.before);
    } else {
      await useBundleStore().update(op.id, op.before);
    }
    delete entry.status[p.pid];
  } catch (err) {
    entry.errors[p.pid] = err instanceof Error ? err.message : String(err);
  }
  touch();
}

function dismiss(entry: ChatAssistantEntry, p: AiChatProposal): void {
  entry.status[p.pid] = "dismissed";
  touch();
}

const started = computed(() => entries.value.length > 0);

export function useAiChat() {
  return {
    open, input, entries, loading, error, started,
    send, stop, reset, apply, undo, dismiss, blockedReason,
  };
}

/** Test seam. */
export function _resetAiChatForTests(): void {
  reset();
  open.value = false;
  input.value = "";
}
