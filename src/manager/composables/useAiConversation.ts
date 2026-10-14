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
 *
 * When web search is set up, an answer may list searches the model would
 * like (`research`). They show as a card under the answer: Search runs them
 * (`api.ai.packSearch`) and refines with the results, Skip hides them. Both
 * go in `searched`, sent with every later request, so the model isn't
 * offered the same searches again. Allowed results go with every later
 * request too (`web`), so the facts outlive the follow-up that used them; a
 * skip is said once, on the next request (`skipped`).
 */
import { computed, ref, shallowRef } from "vue";
import { api, ApiError } from "../api/client";
import type { AiTurn, AiWebResult } from "../api/types";

/** Turns the server takes; older middle turns are dropped past this. */
const MAX_TURNS = 8;

export interface AiExchange<Res, Ctx> {
  instruction: string;
  history: AiTurn[];
  ctx: Ctx;
  result: Res;
  /** The exchange this one follows up (its index), or -1 for the first.
   *  Going back to an earlier answer and refining it starts a branch: the
   *  new answer is added at the end, and nothing is overwritten. */
  parent: number;
}

export interface AiConversationOptions<Res, Ctx> {
  capture: () => Ctx;
  /** `history` is undefined for a fresh request, so it stays out of the body. */
  send: (
    req: {
      instruction: string; history?: AiTurn[]; ctx: Ctx;
      web?: AiWebResult[]; searched?: string[]; skipped?: boolean;
    },
    signal: AbortSignal,
  ) => Promise<Res>;
  /** What the user did with an answer (which items they kept), sent along
   *  with the next follow-up. */
  note?: (result: Res) => string;
  /** The error line for an answer with nothing usable in it, else "". */
  emptyMessage?: (result: Res) => string;
}

/** Follow-up sent after the user allowed the model's searches. */
export const USE_SEARCHES = "Use what the searches found.";

export function useAiConversation<Res extends { answer: Record<string, unknown>; research?: string[] }, Ctx>(
  opts: AiConversationOptions<Res, Ctx>,
) {
  const instruction = ref("");
  const loading = ref(false);
  const error = ref("");
  const exchanges = shallowRef<AiExchange<Res, Ctx>[]>([]);
  const index = ref(-1);
  let controller: AbortController | null = null;
  /** Searches run or skipped in this conversation. */
  const searched = ref<string[]>([]);
  const searching = ref(false);
  /** Results of every search the user allowed in this conversation. */
  let webResults: AiWebResult[] = [];
  /** The user skipped searches since the last request. */
  let skipped = false;

  const current = computed(() => exchanges.value[index.value] ?? null);
  const result = computed<Res | null>(() => current.value?.result ?? null);
  /** The requests that led to the shown answer, first to last. */
  const asked = computed(() =>
    current.value ? [...current.value.history.map((t) => t.instruction), current.value.instruction] : [],
  );
  const count = computed(() => exchanges.value.length);
  /** The answers that led to the shown one, oldest first, it included. */
  const chain = computed<Res[]>(() => {
    const out: Res[] = [];
    const all = exchanges.value;
    for (let i = index.value; i >= 0 && i < all.length && out.length <= all.length; i = all[i].parent) {
      out.unshift(all[i].result);
    }
    return out;
  });
  /** The plan number (1-based) the shown answer follows up, when it isn't
   *  the one just before it (a branch), else null. */
  const branchedFrom = computed<number | null>(() => {
    const cur = current.value;
    return cur && cur.parent >= 0 && cur.parent !== index.value - 1 ? cur.parent + 1 : null;
  });
  /** Searches asked for along the way that weren't run or skipped yet: an
   *  answer that doesn't repeat them (the user answered questions instead)
   *  doesn't drop them. */
  const research = computed(() => pendingResearch(chain.value.map((r) => r.research ?? []), searched.value));

  async function request(
    text: string, history: AiTurn[], ctx: Ctx, fresh: boolean, parent = -1,
  ): Promise<boolean> {
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    loading.value = true;
    error.value = "";
    const skip = skipped;
    try {
      const res = await opts.send({
        instruction: text, history: history.length ? history : undefined, ctx,
        ...(webResults.length ? { web: [...webResults] } : {}),
        ...(searched.value.length ? { searched: [...searched.value] } : {}),
        ...(skip ? { skipped: true } : {}),
      }, mine.signal);
      skipped = false;
      const entry = { instruction: text, history, ctx, result: res, parent: fresh ? -1 : parent };
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
    forgetSearches();
    if (await request(text, [], opts.capture(), true)) instruction.value = "";
  }

  /** The request box as a follow-up to the shown answer. */
  async function refine(): Promise<void> {
    const text = instruction.value.trim();
    if (text && await followUp(text)) instruction.value = "";
  }

  async function followUp(text: string): Promise<boolean> {
    const cur = current.value;
    if (!cur) return false;
    const note = opts.note?.(cur.result) ?? "";
    let history: AiTurn[] = [
      ...cur.history,
      { instruction: cur.instruction, answer: cur.result.answer, ...(note ? { note } : {}) },
    ];
    if (history.length > MAX_TURNS) history = [history[0], ...history.slice(1 - MAX_TURNS)];
    return request(text, history, cur.ctx, false, index.value);
  }

  /** Run the searches the shown answer asks for, then refine with them. */
  async function allowResearch(): Promise<void> {
    const queries = research.value;
    if (!queries.length || searching.value) return;
    searching.value = true;
    error.value = "";
    try {
      const { results } = await api.ai.packSearch({ queries });
      searched.value = [...searched.value, ...queries];
      webResults = [...webResults, ...results];
      await followUp(USE_SEARCHES);
    } catch (err) {
      error.value = err instanceof ApiError || err instanceof Error ? err.message : "The search failed";
    } finally {
      searching.value = false;
    }
  }

  /** Hide the searches; the model isn't offered them again. */
  function skipResearch(): void {
    if (!research.value.length) return;
    searched.value = [...searched.value, ...research.value];
    skipped = true;
  }

  function forgetSearches(): void {
    searched.value = [];
    webResults = [];
    skipped = false;
  }

  /** The shown answer's request again, same context. */
  async function retry(): Promise<void> {
    const cur = current.value;
    if (cur) await request(cur.instruction, cur.history, cur.ctx, false, cur.parent);
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
    forgetSearches();
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

  /** The chat's `use_panel`: ask as if the user typed it (a follow-up when
   *  an answer is showing), leave the answer in the panel for the user to
   *  review, and tell the chat what came back. */
  async function chat(text: string, summary?: (res: Res) => string): Promise<string> {
    instruction.value = text;
    await (current.value ? refine() : ask());
    const res = result.value;
    if (error.value || !res) return `couldn't: ${error.value || "the model didn't answer"}`;
    const what = summary ? summary(res) : JSON.stringify(res.answer);
    const short = what.length > 900 ? `${what.slice(0, 899)}…` : what;
    return `the panel shows its answer: ${short}. Nothing changed yet: the user reviews it in `
      + "the panel, applies what they want, then saves the item.";
  }

  return {
    instruction, loading, error, result, asked, index, count, chain, branchedFrom, research, searching,
    ask, refine, retry, go, clear, restart, stop, chat, allowResearch, skipResearch,
  };
}

/** Searches asked for in any of `rounds`, newest first, minus `searched`
 *  (case-insensitive, each once). */
export function pendingResearch(rounds: string[][], searched: string[]): string[] {
  const done = new Set(searched.map((q) => q.toLowerCase()));
  const out: string[] = [];
  for (const round of [...rounds].reverse()) {
    for (const q of round) {
      const k = q.toLowerCase();
      if (!done.has(k)) { done.add(k); out.push(q); }
    }
  }
  return out;
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
