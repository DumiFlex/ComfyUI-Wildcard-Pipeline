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
 * The answers form a tree. A step is one request: the first ask or a
 * refine. Try again adds a try to the shown step (same request, asked
 * fresh), so tries never mix with refinements; a refine from any try starts
 * a step under it, and two different refines of one answer are sibling
 * steps. `steps` is the path to the end of the shown branch, each with its
 * try and refine switchers (`flip`); `show` looks back at a step's answer.
 *
 * What the request is about (the editor's rows, rules, …) is captured once
 * when the conversation starts and reused by every follow-up, so the model's
 * earlier answers keep pointing at the same things.
 *
 * When web search is set up, an answer may list searches the model would
 * like (`research`). They show as a card under the answer: Search runs them
 * (`api.ai.packSearch`) and shows what they found (`web`, `AiSearchFound`);
 * nothing goes to the model until the user picks "Use what fits" (all of
 * it, the model keeps what fits), ticks results, or "None of these". Search
 * and Skip both
 * go in `searched`, sent with every later request, so the model isn't
 * offered the same searches again. Allowed results go with every later
 * request too (`web`), so the facts outlive the follow-up that used them; a
 * skip is said once, on the next request (`skipped`).
 */
import { computed, ref, shallowRef } from "vue";
import { api, ApiError } from "../api/client";
import type { AiTurn, AiWebResult } from "../api/types";
import { PANEL_FITS, PANEL_PICKED, useSearchFound } from "./searchFound";

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
  /** For Try again, the first try of this request (its index), else -1. */
  tryOf: number;
}

/** One request on the shown path, with its switchers. */
export interface AiStep {
  /** Index of this step's exchange (the try on the path). */
  at: number;
  text: string;
  /** Its answer is the one showing. */
  shown: boolean;
  /** After the shown step (looked back past it). */
  after: boolean;
  /** 0-based try on the path, of `tries`; one try has no switcher. */
  try: number;
  tries: number;
  /** 0-based refine among the different follow-ups to the same answer. */
  refine: number;
  refines: number;
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


export function useAiConversation<Res extends { answer: Record<string, unknown>; research?: string[] }, Ctx>(
  opts: AiConversationOptions<Res, Ctx>,
) {
  const instruction = ref("");
  const loading = ref(false);
  const error = ref("");
  const exchanges = shallowRef<AiExchange<Res, Ctx>[]>([]);
  const index = ref(-1);
  /** The end of the shown branch; `index` is on its path. */
  const tip = ref(-1);
  /** The child last on a shown path, per exchange, so flipping back to a
   *  branch returns to where the user was in it. */
  const lastChild = new Map<number, number>();
  let controller: AbortController | null = null;
  /** Searches run or skipped in this conversation. */
  const searched = ref<string[]>([]);
  const searching = ref(false);
  /** Results the user sent in this conversation. */
  let webResults: AiWebResult[] = [];
  /** What the last searches found, waiting for the user's pick. */
  const web = useSearchFound();
  /** The user skipped searches since the last request. */
  let skipped = false;

  const current = computed(() => exchanges.value[index.value] ?? null);
  const result = computed<Res | null>(() => current.value?.result ?? null);
  /** The requests that led to the shown answer, first to last. */
  const asked = computed(() =>
    current.value ? [...current.value.history.map((t) => t.instruction), current.value.instruction] : [],
  );
  const count = computed(() => exchanges.value.length);
  /** The requests from the first ask to the end of the shown branch. */
  const steps = computed<AiStep[]>(() => {
    const all = exchanges.value;
    const path: number[] = [];
    for (let i = tip.value; i >= 0 && i < all.length && path.length <= all.length; i = all[i].parent) path.unshift(i);
    const shownAt = path.indexOf(index.value);
    return path.map((at, k) => {
      const tries = triesOf(at);
      const refines = refinesOf(at);
      return {
        at, text: all[at].instruction, shown: k === shownAt, after: shownAt >= 0 && k > shownAt,
        try: tries.indexOf(at), tries: tries.length,
        refine: refines.indexOf(firstTry(at)), refines: refines.length,
      };
    });
  });
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
    text: string, history: AiTurn[], ctx: Ctx, fresh: boolean, parent = -1, tryOf = -1,
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
      const entry = { instruction: text, history, ctx, result: res, parent: fresh ? -1 : parent, tryOf: fresh ? -1 : tryOf };
      if (fresh) lastChild.clear();
      exchanges.value = fresh ? [entry] : [...exchanges.value, entry];
      index.value = exchanges.value.length - 1;
      tip.value = index.value;
      remember(tip.value);
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

  /** Run the searches the shown answer asks for and show what they found. */
  async function allowResearch(): Promise<void> {
    const queries = research.value;
    if (!queries.length || searching.value) return;
    searching.value = true;
    error.value = "";
    try {
      const { results } = await api.ai.packSearch({ queries });
      searched.value = [...searched.value, ...queries];
      web.show(results);
    } catch (err) {
      error.value = err instanceof ApiError || err instanceof Error ? err.message : "The search failed";
    } finally {
      searching.value = false;
    }
  }

  /** Refine with what the searches found: all of it for the model to keep
   *  what fits, or the ticked results. */
  async function useFound(fits = false): Promise<void> {
    if (loading.value || (!fits && !web.picks.value.size)) return;
    const sent = web.take(fits);
    if (!sent.length) return;
    webResults = [...webResults, ...sent];
    await followUp(fits ? PANEL_FITS : PANEL_PICKED);
  }

  /** None of the results: nothing is sent. */
  function skipFound(): void {
    web.none();
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
    web.reset();
    skipped = false;
  }

  /** The shown answer's request again, same context. */
  async function retry(): Promise<void> {
    const cur = current.value;
    if (cur) await request(cur.instruction, cur.history, cur.ctx, false, cur.parent, firstTry(index.value));
  }

  function go(delta: number): void {
    const next = index.value + delta;
    if (next >= 0 && next < exchanges.value.length) {
      index.value = next;
      tip.value = next;
      remember(next);
      error.value = "";
    }
  }

  function firstTry(i: number): number {
    const e = exchanges.value[i];
    return e && e.tryOf >= 0 ? e.tryOf : i;
  }

  /** The tries of `i`'s request, oldest first. */
  function triesOf(i: number): number[] {
    const first = firstTry(i);
    return exchanges.value.flatMap((e, j) => (j === first || e.tryOf === first ? [j] : []));
  }

  /** The different requests that follow up `i`'s parent (their first
   *  tries), oldest first; one for the first ask. */
  function refinesOf(i: number): number[] {
    const parent = exchanges.value[i]?.parent ?? -1;
    if (parent < 0) return [firstTry(i)];
    return exchanges.value.flatMap((e, j) => (e.parent === parent && e.tryOf < 0 ? [j] : []));
  }

  /** Note the path to `i` so a later flip comes back along it. */
  function remember(i: number): void {
    const all = exchanges.value;
    for (let c = i; c >= 0 && all[c].parent >= 0; c = all[c].parent) lastChild.set(all[c].parent, c);
  }

  /** The end of the branch under `i`: where the user last was, else the
   *  newest answer at each level. */
  function branchEnd(i: number): number {
    const all = exchanges.value;
    for (let guard = 0; guard < all.length; guard++) {
      let next = lastChild.get(i) ?? -1;
      if (next < 0) for (let j = all.length - 1; j > i && next < 0; j--) if (all[j].parent === i) next = j;
      if (next < 0 || all[next]?.parent !== i) break;
      i = next;
    }
    return i;
  }

  /** Look at a step's answer; the steps after it stay listed. */
  function show(at: number): void {
    if (loading.value || !steps.value.some((s) => s.at === at)) return;
    index.value = at;
    error.value = "";
  }

  /** Switch a step to its previous / next try, or to a sibling refine, and
   *  show that answer; the steps under it follow its own branch. */
  function flip(at: number, kind: "try" | "refine", delta: number): void {
    if (loading.value) return;
    const list = kind === "try" ? triesOf(at) : refinesOf(at);
    const here = list.indexOf(kind === "try" ? at : firstTry(at));
    let next = list[here + delta];
    if (next === undefined || here < 0) return;
    // A sibling refine opens on the try the user last had there.
    if (kind === "refine") {
      const parent = exchanges.value[at].parent;
      const last = lastChild.get(parent);
      if (last !== undefined && firstTry(last) === next) next = last;
      else next = triesOf(next).pop() ?? next;
    }
    const parent = exchanges.value[next].parent;
    if (parent >= 0) lastChild.set(parent, next);
    tip.value = branchEnd(next);
    remember(tip.value);
    index.value = next;
    error.value = "";
  }

  /** Forget the answers (after applying them, or Discard). */
  function clear(): void {
    exchanges.value = [];
    index.value = -1;
    tip.value = -1;
    lastChild.clear();
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
    instruction, loading, error, result, asked, index, count, steps, chain, branchedFrom, research, searching,
    ask, refine, retry, go, show, flip, clear, restart, stop, chat, allowResearch, skipResearch, web, useFound, skipFound,
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
