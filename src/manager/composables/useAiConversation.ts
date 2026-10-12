/**
 * useAiConversation — the request side of every AI panel, with follow-ups.
 *
 * A first ask starts a conversation. After an answer the request box becomes
 * a follow-up box: "Refine" sends the follow-up together with the earlier
 * requests and the model's own answers (`history`), so the model revises what
 * it gave instead of starting over. "Try again" re-asks the shown answer's
 * request, "Start over" drops the conversation. Every answer is kept, so the
 * user can flip back to an earlier one and refine from there.
 *
 * What the request is about (the editor's rows, rules, …) is captured once
 * when the conversation starts and reused by every follow-up, so the model's
 * earlier answers keep pointing at the same things.
 */
import { computed, ref, shallowRef } from "vue";
import { ApiError } from "../api/client";
import type { AiTurn } from "../api/types";

/** Turns the server takes; older middle turns are dropped past this. */
const MAX_TURNS = 8;

export interface AiExchange<Res, Ctx> {
  instruction: string;
  history: AiTurn[];
  ctx: Ctx;
  result: Res;
}

export interface AiConversationOptions<Res, Ctx> {
  capture: () => Ctx;
  /** `history` is undefined for a fresh request, so it stays out of the body. */
  send: (req: { instruction: string; history?: AiTurn[]; ctx: Ctx }, signal: AbortSignal) => Promise<Res>;
  /** What the user did with an answer (which items they kept), sent along
   *  with the next follow-up. */
  note?: (result: Res) => string;
  /** The error line for an answer with nothing usable in it, else "". */
  emptyMessage?: (result: Res) => string;
}

export function useAiConversation<Res extends { answer: Record<string, unknown> }, Ctx>(
  opts: AiConversationOptions<Res, Ctx>,
) {
  const instruction = ref("");
  const loading = ref(false);
  const error = ref("");
  const exchanges = shallowRef<AiExchange<Res, Ctx>[]>([]);
  const index = ref(-1);
  let controller: AbortController | null = null;

  const current = computed(() => exchanges.value[index.value] ?? null);
  const result = computed<Res | null>(() => current.value?.result ?? null);
  /** The requests that led to the shown answer, first to last. */
  const asked = computed(() =>
    current.value ? [...current.value.history.map((t) => t.instruction), current.value.instruction] : [],
  );
  const count = computed(() => exchanges.value.length);

  async function request(text: string, history: AiTurn[], ctx: Ctx, fresh: boolean): Promise<boolean> {
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    loading.value = true;
    error.value = "";
    try {
      const res = await opts.send(
        { instruction: text, history: history.length ? history : undefined, ctx }, mine.signal,
      );
      const entry = { instruction: text, history, ctx, result: res };
      exchanges.value = fresh ? [entry] : [...exchanges.value, entry];
      index.value = exchanges.value.length - 1;
      error.value = opts.emptyMessage?.(res) ?? "";
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return false;
      error.value = err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong";
      return false;
    } finally {
      if (controller === mine) {
        loading.value = false;
        controller = null;
      }
    }
  }

  /** A new conversation from the request box. */
  async function ask(): Promise<void> {
    const text = instruction.value.trim();
    if (await request(text, [], opts.capture(), true)) instruction.value = "";
  }

  /** The request box as a follow-up to the shown answer. */
  async function refine(): Promise<void> {
    const cur = current.value;
    const text = instruction.value.trim();
    if (!cur || !text) return;
    const note = opts.note?.(cur.result) ?? "";
    let history: AiTurn[] = [
      ...cur.history,
      { instruction: cur.instruction, answer: cur.result.answer, ...(note ? { note } : {}) },
    ];
    if (history.length > MAX_TURNS) history = [history[0], ...history.slice(1 - MAX_TURNS)];
    if (await request(text, history, cur.ctx, false)) instruction.value = "";
  }

  /** The shown answer's request again, same context. */
  async function retry(): Promise<void> {
    const cur = current.value;
    if (cur) await request(cur.instruction, cur.history, cur.ctx, false);
  }

  function go(delta: number): void {
    const next = index.value + delta;
    if (next >= 0 && next < exchanges.value.length) {
      index.value = next;
      error.value = "";
    }
  }

  /** Forget the answers (after applying them, or Discard). */
  function clear(): void {
    exchanges.value = [];
    index.value = -1;
    error.value = "";
  }

  /** Back to an empty request box holding the first request, to edit. */
  function restart(): void {
    const first = asked.value[0];
    clear();
    if (first !== undefined) instruction.value = first;
  }

  function stop(): void {
    controller?.abort();
    controller = null;
    loading.value = false;
  }

  return {
    instruction, loading, error, result, asked, index, count,
    ask, refine, retry, go, clear, restart, stop,
  };
}

/** What the user kept from a ticked list, by label, or "" when they kept
 *  everything. Clipped well under the server's note limit. */
export function keptNote(labels: string[], unticked: Set<number>): string {
  if (!unticked.size || !labels.length) return "";
  const clip = (xs: string[]) => {
    const s = xs.map((x) => x.replace(/\s+/g, " ").trim()).join("; ");
    return s.length > 700 ? `${s.slice(0, 700)}…` : s;
  };
  const kept = labels.filter((_, i) => !unticked.has(i));
  const dropped = labels.filter((_, i) => unticked.has(i));
  if (!kept.length) return `they unticked everything: ${clip(dropped)}`;
  return `they kept ${clip(kept)}. They unticked ${clip(dropped)}`;
}
