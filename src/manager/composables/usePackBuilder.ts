/**
 * usePackBuilder — the pack builder's state and steps, one module-level copy
 * so leaving the page doesn't lose a plan or a half-built pack.
 *
 * Plan: a conversation (`useAiConversation`). Settings (library reuse,
 * negatives, sub-bundles, style, rating, options per wildcard) and the
 * reference images go with every request. The model's questions come in
 * rounds: answers (several choices, typed "Other", or "Decide for me")
 * become decisions that every later request carries, so a question is
 * never asked twice. The plan can be edited by hand (fields, add, remove,
 * a finding's patch) without the model, or one item at a time with it;
 * a refine sends the plan as the user sees it (`previous`), so items keep
 * their keys and reserved ids. Research the planner asks for runs only
 * after the user allows it.
 *
 * Build: one request per item, wildcards first. Each item has a time
 * limit and can be skipped; a failed or skipped item never stops the
 * rest. Check: the pack runs on the engine; an item with a problem is
 * rebuilt with the problem as a note (twice at most). Install: one import
 * with one undo. The server keeps nothing between requests: every call
 * carries the plan and what's built so far.
 */
import { computed, ref, shallowRef, watch } from "vue";
import { api, ApiError } from "../api/client";
import type {
  AiPackBuilt, AiPackCheck, AiPackDecision, AiPackFinding, AiPackInstallResult, AiPackItem,
  AiPackItemResult, AiPackKind, AiPackPatch, AiPackPlan, AiPackPlanResult, AiPackQuestion,
  AiPackSettings,
} from "../api/types";
import { useAiConversation } from "./useAiConversation";
import { useAiImages } from "./useAiImages";

export type ItemStatus =
  | "waiting" | "building" | "retrying" | "built" | "fixing" | "failed" | "skipped";

export interface ItemState {
  status: ItemStatus;
  result?: AiPackItemResult;
  error?: string;
  /** Problems the last repair was asked to fix. */
  fixed?: string[];
}

/** An answer in progress to one of the model's questions. */
export interface QuestionPick {
  chosen: string[];
  other: string;
  /** "Decide for me". */
  decide: boolean;
}

/** The bundle "Extend with AI" plans into, or null for a new pack. */
export interface PackTarget {
  id: string;
  name: string;
}

/** Repair rounds after the first check. */
const MAX_REPAIRS = 2;
/** How long one item may take before it is stopped and marked failed. */
export const ITEM_TIME_LIMIT_MS = 4 * 60 * 1000;
/** Edits wait this long before the plan is checked again. */
const RECHECK_MS = 400;
export const DEFAULT_SETTINGS: AiPackSettings = {
  library: "reuse", negatives: "auto", structure: "sections", style: "auto", rating: "auto",
  count: 0,
};
export const DECIDE_ANSWER = "Your call (decide for me)";
/** Mirrors `engine/ai/pack.py:build_order`: vocabularies (wildcards with
 *  no variable) first, since other items point at them by name. */
const BUILD_RANK: Record<AiPackKind, number> = {
  library: 0, fixed_values: 1, wildcard: 1, derivation: 2, combine: 3, constraint: 4, template: 5,
};
function buildRank(item: AiPackItem): number {
  return item.kind === "wildcard" && !item.var ? 0 : BUILD_RANK[item.kind];
}

function message(err: unknown): string {
  return err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong";
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/** A fresh 8-hex module id not in `taken`. */
export function newId(taken: Set<string>): string {
  for (;;) {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const id = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (!taken.has(id)) return id;
  }
}

/** The next free plan key (`i1`, `i2`, …). */
export function nextKey(items: AiPackItem[]): string {
  const used = new Set(items.map((i) => i.key));
  let n = items.length + 1;
  while (used.has(`i${n}`)) n += 1;
  return `i${n}`;
}

/** A blank item of a kind, for "Add item". */
export function blankItem(kind: AiPackKind, items: AiPackItem[], section = ""): AiPackItem {
  return {
    key: nextKey(items), id: newId(new Set(items.map((i) => i.id))), kind,
    name: "", var: "", section, about: "", count: kind === "wildcard" ? 12 : 0, tags: [],
    source: "", target: "", use: "", library_id: "", library_type: "",
  };
}

/** One finding's patch applied to a plan (a new plan; nothing mutated). */
export function applyPatch(plan: AiPackPlan, patch: AiPackPatch): AiPackPlan {
  if (patch.op === "remove") {
    return { ...plan, items: plan.items.filter((i) => i.key !== patch.key) };
  }
  if (patch.op === "edit") {
    return {
      ...plan,
      items: plan.items.map((i) => (i.key === patch.key ? { ...i, ...patch.set } : i)),
    };
  }
  const item = { ...blankItem(patch.item.kind, plan.items), ...patch.item };
  item.key = nextKey(plan.items);
  item.id = newId(new Set(plan.items.map((i) => i.id)));
  // A template goes last, everything else before the template.
  const at = item.kind === "template"
    ? plan.items.length
    : (() => {
      const t = plan.items.findIndex((i) => i.kind === "template");
      return t < 0 ? plan.items.length : t;
    })();
  return { ...plan, items: [...plan.items.slice(0, at), item, ...plan.items.slice(at)] };
}

/** What one question's pick says, or "" when it isn't answered. */
export function pickAnswer(pick: QuestionPick | undefined): string {
  if (!pick) return "";
  if (pick.decide) return DECIDE_ANSWER;
  return [...pick.chosen, pick.other.trim()].filter(Boolean).join(", ");
}

/** One plan version as the user is shaping it. */
interface PlanView {
  /** The plan with the user's hand edits (removed items still in it). */
  draft: AiPackPlan;
  /** The checker's findings for the draft. */
  review: AiPackFinding[];
  /** The model's review, when asked. */
  ai: AiPackFinding[];
  dismissed: Set<string>;
  removed: Set<string>;
  /** The draft differs from what the model answered. */
  edited: boolean;
}

const views = new WeakMap<AiPackPlanResult, PlanView>();
const view = shallowRef<PlanView | null>(null);

const settings = ref<AiPackSettings>({ ...DEFAULT_SETTINGS });
const decisions = ref<AiPackDecision[]>([]);
const picks = ref<Record<string, QuestionPick>>({});
/** Search results the user allowed, waiting to go with the next request. */
const webResults = shallowRef<Array<{ query: string; text: string }>>([]);
/** Searches run or skipped; the planner isn't asked for them again. */
const searched = ref<string[]>([]);
const searching = ref(false);
const images = useAiImages();
const target = ref<PackTarget | null>(null);

const states = shallowRef<Record<string, ItemState>>({});
const phase = ref<"plan" | "build" | "installed">("plan");
const working = ref(false);
const stage = ref("");
/** The item building now (the one Skip stops), or "". */
const current = ref("");
const check = shallowRef<AiPackCheck | null>(null);
const installed = shallowRef<AiPackInstallResult | null>(null);
const error = ref("");
/** A prompt the user likes, to rebuild as a pack ("" for none). */
const sample = ref("");
const reviewing = ref(false);
/** The item the model is rewriting now ("+" for a new one), or "". */
const changing = ref("");
const selected = ref(new Set<string>());
/** Check problems and variety notes the user dismissed, as "key:text". */
const dismissedNotes = ref(new Set<string>());
let controller: AbortController | null = null;
/** The running item's own controller and why it was stopped. */
let itemCtl: { ctl: AbortController; why: "" | "skip" | "timeout" } | null = null;
/** The plan the next request sends as `previous`. */
let sendPrevious: AiPackPlan | undefined;
let recheckTimer: ReturnType<typeof setTimeout> | null = null;

const convo = useAiConversation<AiPackPlanResult, null>({
  capture: () => null,
  send: ({ instruction, history }, signal) => {
    const followUp = !!history;
    return api.ai.packPlan({
      instruction, ...(history ? { history } : {}),
      ...(sample.value.trim() ? { sample: sample.value.trim() } : {}),
      settings: settings.value,
      ...(decisions.value.length ? { decisions: decisions.value } : {}),
      ...(followUp && sendPrevious ? { previous: sendPrevious } : {}),
      ...(images.urls() ? { images: images.urls() } : {}),
      ...(followUp && webResults.value.length ? { web: webResults.value } : {}),
      ...(searched.value.length ? { searched: searched.value } : {}),
      ...(target.value ? { bundle_id: target.value.id } : {}),
    }, signal);
  },
  note: (res) => {
    const v = views.get(res);
    const bits: string[] = [];
    const gone = res.plan.items.filter((i) => v?.removed.has(i.key)).map((i) => i.name);
    if (gone.length) bits.push(`they removed ${gone.join(", ")}`);
    if (res.plan.warnings.length) bits.push(`the checker said: ${res.plan.warnings.join("; ")}`);
    return bits.join(". ").slice(0, 900);
  },
});

function viewFor(res: AiPackPlanResult): PlanView {
  let v = views.get(res);
  if (!v) {
    v = {
      draft: res.plan, review: res.review, ai: [], dismissed: new Set(), removed: new Set(),
      edited: false,
    };
    views.set(res, v);
  }
  return v;
}

watch(() => convo.result.value, (res) => {
  view.value = res ? viewFor(res) : null;
  picks.value = {};
  selected.value = new Set();
}, { immediate: true });

function setView(patch: Partial<PlanView>): void {
  const res = convo.result.value;
  const v = view.value;
  if (!res || !v) return;
  const next = { ...v, ...patch };
  views.set(res, next);
  view.value = next;
}

/** The plan as shown, removed items included (struck through). */
const draft = computed<AiPackPlan | null>(() => view.value?.draft ?? null);
const removed = computed(() => view.value?.removed ?? new Set<string>());
const edited = computed(() => view.value?.edited ?? false);

/** The plan that builds: the draft minus what the user removed. */
const plan = computed<AiPackPlan | null>(() => {
  const p = draft.value;
  if (!p) return null;
  const gone = removed.value;
  return gone.size ? { ...p, items: p.items.filter((i) => !gone.has(i.key)) } : p;
});

/** Open questions this round. */
const questions = computed<AiPackQuestion[]>(() => draft.value?.questions ?? []);
/** Research the planner asked for that hasn't run or been skipped. */
const research = computed<string[]>(() => {
  const done = new Set(searched.value.map((q) => q.toLowerCase()));
  return (draft.value?.research ?? []).filter((q) => !done.has(q.toLowerCase()));
});

/** What the review found, minus dismissed ones and ones about removed
 *  items. */
const findings = computed<AiPackFinding[]>(() => {
  const v = view.value;
  if (!v) return [];
  return [...v.review, ...v.ai].filter(
    (f) => !v.dismissed.has(f.id) && (!f.key || !v.removed.has(f.key)),
  );
});

function built(): AiPackBuilt {
  const out: AiPackBuilt = {};
  for (const [key, s] of Object.entries(states.value)) {
    if (s.result) out[key] = { id: s.result.id, payload: s.result.payload };
  }
  return out;
}

function setState(key: string, patch: Partial<ItemState>): void {
  states.value = { ...states.value, [key]: { ...(states.value[key] ?? { status: "waiting" }), ...patch } };
}

function withTarget<T extends object>(body: T): T & { bundle_id?: string } {
  return target.value ? { ...body, bundle_id: target.value.id } : body;
}

/* ── questions and decisions ─────────────────────────────────────────── */

function pickFor(q: string): QuestionPick {
  return picks.value[q] ?? { chosen: [], other: "", decide: false };
}

function setPick(q: string, next: QuestionPick): void {
  picks.value = { ...picks.value, [q]: next };
}

/** Pick (or unpick) a choice; a single-answer question keeps one. */
function choose(q: AiPackQuestion, choice: string): void {
  const cur = pickFor(q.question);
  const has = cur.chosen.includes(choice);
  const chosen = q.multi
    ? (has ? cur.chosen.filter((c) => c !== choice) : [...cur.chosen, choice])
    : (has ? [] : [choice]);
  setPick(q.question, { chosen, other: q.multi ? cur.other : "", decide: false });
}

/** Type your own answer ("Other…"). A single-answer question drops its
 *  picked choice. */
function setOther(q: AiPackQuestion, text: string): void {
  const cur = pickFor(q.question);
  setPick(q.question, { chosen: q.multi || !text.trim() ? cur.chosen : [], other: text, decide: false });
}

function decideFor(q: AiPackQuestion): void {
  const cur = pickFor(q.question);
  setPick(q.question, { chosen: [], other: "", decide: !cur.decide });
}

/** "Decide for me" on every question not answered yet. */
function decideAll(): void {
  const next = { ...picks.value };
  for (const q of questions.value) {
    if (!pickAnswer(next[q.question])) next[q.question] = { chosen: [], other: "", decide: true };
  }
  picks.value = next;
}

/** The answers given this round, as decisions. */
function pendingDecisions(): AiPackDecision[] {
  return questions.value
    .map((q) => ({ question: q.question, answer: pickAnswer(picks.value[q.question]) }))
    .filter((d) => d.answer);
}

const answeredCount = computed(() => pendingDecisions().length);

/** Take a decision back: it leaves the list and its question goes into
 *  the edit box, to answer again in words. */
function reopenDecision(i: number): void {
  const d = decisions.value[i];
  if (!d) return;
  decisions.value = decisions.value.filter((_, j) => j !== i);
  convo.instruction.value = [convo.instruction.value.trim(), `About "${d.question}": `]
    .filter(Boolean).join("\n");
}

/** Put a guess the planner made into the edit box, to correct it. */
function changeAssumption(text: string): void {
  convo.instruction.value = [convo.instruction.value.trim(), `Instead of "${text}": `]
    .filter(Boolean).join("\n");
}

function mergeDecisions(add: AiPackDecision[]): void {
  const kept = decisions.value.filter(
    (d) => !add.some((a) => a.question.toLowerCase() === d.question.toLowerCase()),
  );
  decisions.value = [...kept, ...add];
}

/* ── plan ────────────────────────────────────────────────────────────── */

async function askPlan(): Promise<void> {
  error.value = "";
  decisions.value = [];
  picks.value = {};
  webResults.value = [];
  searched.value = [];
  dismissedNotes.value = new Set();
  sendPrevious = undefined;
  await convo.ask();
}

/** Send this round's answers, the edit box, any allowed search results
 *  and the plan as edited, as a follow-up. */
async function refinePlan(): Promise<void> {
  if (!convo.result.value || convo.loading.value) return;
  const answers = pendingDecisions();
  const typed = convo.instruction.value.trim();
  const text = typed
    || (answers.length ? "I answered your questions."
      : webResults.value.length ? "Use what the searches found."
        : edited.value ? "I edited the plan; keep my changes and fill any gaps they leave." : "");
  if (!text) return;
  const before = decisions.value;
  mergeDecisions(answers);
  sendPrevious = plan.value ?? undefined;
  convo.instruction.value = text;
  await convo.refine();
  if (convo.error.value) {
    decisions.value = before;
    convo.instruction.value = typed;
    return;
  }
  webResults.value = [];
}

/** Ask the model for the next round of questions with no other change. */
const canRefine = computed(() => !convo.loading.value && !!convo.result.value && (
  !!convo.instruction.value.trim() || answeredCount.value > 0 || webResults.value.length > 0
  || edited.value));

function editDraft(next: AiPackPlan, extra: Partial<PlanView> = {}): void {
  setView({ draft: next, edited: true, ...extra });
  scheduleRecheck();
}

/** Change fields of one item by hand. */
function editItem(key: string, set: Partial<Omit<AiPackItem, "key" | "id">>): void {
  const p = draft.value;
  if (!p) return;
  editDraft(applyPatch(p, { op: "edit", key, set }));
}

/** Add a blank item by hand; returns its key. */
function addItem(kind: AiPackKind, section = ""): string {
  const p = draft.value;
  if (!p) return "";
  const item = blankItem(kind, p.items, section);
  const t = p.items.findIndex((i) => i.kind === "template");
  const at = kind === "template" || t < 0 ? p.items.length : t;
  editDraft({ ...p, items: [...p.items.slice(0, at), item, ...p.items.slice(at)] });
  return item.key;
}

/** Edit plan-wide fields (title, summary, anchor, rating, style). */
function editPlan(set: Partial<Pick<AiPackPlan, "title" | "summary" | "anchor" | "rating" | "style">>): void {
  const p = draft.value;
  if (p) editDraft({ ...p, ...set });
}

function removeItem(key: string): void {
  const v = view.value;
  if (!v) return;
  const next = new Set(v.removed);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  setView({ removed: next });
  scheduleRecheck();
}

/** Apply one finding's fix to the plan, no model involved. */
function applyFinding(f: AiPackFinding): void {
  const v = view.value;
  if (!v || !f.patch) return;
  const dismissed = new Set(v.dismissed);
  dismissed.add(f.id);
  editDraft(applyPatch(v.draft, f.patch), { dismissed });
  unselect(f.id);
}

function dismissFinding(id: string): void {
  const v = view.value;
  if (!v) return;
  const dismissed = new Set(v.dismissed);
  dismissed.add(id);
  setView({ dismissed });
  unselect(id);
}

function unselect(id: string): void {
  if (!selected.value.has(id)) return;
  const next = new Set(selected.value);
  next.delete(id);
  selected.value = next;
}

function toggleSelected(id: string): void {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

/** Check the edited plan again (the checker, no model) after a pause. */
function scheduleRecheck(): void {
  if (recheckTimer) clearTimeout(recheckTimer);
  recheckTimer = setTimeout(() => {
    recheckTimer = null;
    void recheck();
  }, RECHECK_MS);
}

/** The server reads the edited plan: findings for it, and items it can't
 *  use (left out, with a warning) drop out of the draft. */
async function recheck(): Promise<void> {
  const res = convo.result.value;
  const p = plan.value;
  const v = view.value;
  if (!res || !p || !v) return;
  try {
    const got = await api.ai.packReview(withTarget({ plan: p }));
    if (convo.result.value !== res || view.value?.draft !== v.draft) return;
    const server = new Map(got.plan.items.map((i) => [i.key, i]));
    const items = v.draft.items
      .map((i) => (v.removed.has(i.key) ? i : server.get(i.key)))
      .filter((i): i is AiPackItem => !!i);
    const warnings = [...new Set([...v.draft.warnings, ...got.plan.warnings])];
    setView({
      draft: { ...v.draft, items, warnings, sections: got.plan.sections },
      review: got.findings.filter((f) => f.by !== "model"),
    });
  } catch (err) {
    error.value = message(err);
  }
}

/** Ask the model to review the plan too. */
async function reviewPlan(): Promise<void> {
  const p = plan.value;
  if (!p || reviewing.value) return;
  reviewing.value = true;
  error.value = "";
  try {
    const res = await api.ai.packReview(withTarget({
      plan: p, ai: true, request: convo.asked.value[0] ?? "",
    }));
    setView({
      review: res.findings.filter((f) => f.by !== "model"),
      ai: res.findings.filter((f) => f.by === "model"),
    });
  } catch (err) {
    error.value = message(err);
  } finally {
    reviewing.value = false;
  }
}

/** Send the ticked findings (or every open one) to the planner. */
async function fixFindings(): Promise<void> {
  const open = findings.value;
  const list = selected.value.size ? open.filter((f) => selected.value.has(f.id)) : open;
  if (!list.length) return;
  const note = "Revise the plan to fix these: " + list.map((f) => `- ${f.text}.`).join(" ");
  convo.instruction.value = [convo.instruction.value.trim(), note].filter(Boolean).join("\n");
  const v = view.value;
  if (v) {
    const dismissed = new Set(v.dismissed);
    for (const f of list) dismissed.add(f.id);
    setView({ dismissed });
  }
  selected.value = new Set();
  await refinePlan();
}

/** Have the model rewrite one item (or add items, with no key) as asked;
 *  the rest of the plan stays. */
async function changeItem(key: string, instruction: string): Promise<boolean> {
  const p = plan.value;
  const v = view.value;
  const text = instruction.trim();
  if (!p || !v || !text || changing.value) return false;
  changing.value = key || "+";
  error.value = "";
  try {
    const res = await api.ai.packChange(withTarget({ plan: p, ...(key ? { key } : {}), instruction: text }));
    const fresh = new Map(res.plan.items.map((i) => [i.key, i]));
    // Removed items keep their place; new items go where the server put them.
    const items: AiPackItem[] = [];
    for (const i of res.plan.items) items.push(i);
    for (const i of v.draft.items) {
      if (v.removed.has(i.key) && !fresh.has(i.key)) items.push(i);
    }
    setView({
      draft: { ...v.draft, ...res.plan, items, questions: v.draft.questions, research: v.draft.research },
      review: res.review, edited: true,
    });
    return true;
  } catch (err) {
    error.value = message(err);
    return false;
  } finally {
    changing.value = "";
  }
}

/** Run the searches the planner asked for (the user allowed them), then
 *  refine the plan with what they found. */
async function allowResearch(): Promise<void> {
  const queries = research.value;
  if (!queries.length || searching.value) return;
  searching.value = true;
  error.value = "";
  try {
    const res = await api.ai.packSearch({ queries });
    webResults.value = [...webResults.value, ...res.results];
    searched.value = [...searched.value, ...queries];
  } catch (err) {
    error.value = message(err);
    return;
  } finally {
    searching.value = false;
  }
  await refinePlan();
}

function skipResearch(): void {
  searched.value = [...searched.value, ...research.value];
}

/* ── build ───────────────────────────────────────────────────────────── */

/** One item request with its own time limit; Skip stops it too. Throws
 *  an AbortError only when the whole build was stopped. */
async function callItem(
  p: AiPackPlan, key: string, note: string, signal: AbortSignal,
): Promise<AiPackItemResult> {
  const own = { ctl: new AbortController(), why: "" as "" | "skip" | "timeout" };
  itemCtl = own;
  const stopAll = () => own.ctl.abort();
  signal.addEventListener("abort", stopAll);
  const timer = setTimeout(() => {
    own.why = "timeout";
    own.ctl.abort();
  }, ITEM_TIME_LIMIT_MS);
  try {
    return await api.ai.packItem(
      withTarget({ plan: p, built: built(), key, ...(note ? { note } : {}) }), own.ctl.signal,
    );
  } catch (err) {
    if (signal.aborted) throw new DOMException("stopped", "AbortError");
    if (own.why === "skip") throw new SkipError();
    if (own.why === "timeout") {
      throw new Error(`took longer than ${ITEM_TIME_LIMIT_MS / 60000} minutes; a smaller model or a shorter item may help`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stopAll);
    if (itemCtl === own) itemCtl = null;
  }
}

class SkipError extends Error {}

/** Build one item. Returns false when it failed or was skipped. */
async function buildOne(
  p: AiPackPlan, key: string, note: string, signal: AbortSignal,
): Promise<boolean> {
  current.value = key;
  try {
    const res = await callItem(p, key, note, signal);
    setState(key, { status: "built", result: res, error: undefined });
    return true;
  } catch (err) {
    if (isAbort(err)) throw err;
    if (err instanceof SkipError) {
      setState(key, { status: states.value[key]?.result ? "built" : "skipped", error: undefined });
      return false;
    }
    setState(key, { status: states.value[key]?.result ? "built" : "failed", error: message(err) });
    return false;
  } finally {
    current.value = "";
  }
}

/** Build an item; a failed answer is asked again with the error named,
 *  and an answer that doesn't fit the rest of the pack (a rule testing an
 *  option that isn't there) is rebuilt once with that as the note. */
async function buildItem(p: AiPackPlan, item: AiPackItem, signal: AbortSignal): Promise<void> {
  if (!(await buildOne(p, item.key, "", signal))) {
    const s = states.value[item.key];
    if (s?.status === "skipped" || s?.error?.startsWith("took longer")) return;
    const why = s?.error ?? "";
    stage.value = `Retrying ${item.name}…`;
    setState(item.key, { status: "retrying" });
    await buildOne(p, item.key, why ? `your last answer failed: ${why}` : "", signal);
  }
  const repair = states.value[item.key]?.result?.repair;
  if (repair && states.value[item.key]?.status === "built") {
    stage.value = `Fixing ${item.name}…`;
    setState(item.key, { status: "fixing", fixed: [repair] });
    await buildOne(p, item.key, repair, signal);
  }
}

/** Stop the item building now and move on. */
function skipCurrent(): void {
  if (itemCtl) {
    itemCtl.why = "skip";
    itemCtl.ctl.abort();
  }
}

/** Constraints built on a wildcard: its option ids change when it is
 *  rebuilt, so they are rebuilt after it. */
function dependents(p: AiPackPlan, key: string): string[] {
  const w = p.items.find((i) => i.key === key);
  if (!w || w.kind !== "wildcard" || !w.var) return [];
  return p.items
    .filter((i) => i.kind === "constraint" && (i.source === w.var || i.target === w.var))
    .map((i) => i.key);
}

async function runCheck(p: AiPackPlan, signal: AbortSignal): Promise<AiPackCheck | null> {
  if (!Object.keys(built()).length) return null;
  stage.value = "Testing the pack on the engine…";
  const res = await api.ai.packCheck(withTarget({ plan: p, built: built() }), signal);
  check.value = res;
  dismissedNotes.value = new Set();
  return res;
}

function buildOrder(p: AiPackPlan): AiPackItem[] {
  return p.items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => buildRank(a.item) - buildRank(b.item) || a.i - b.i)
    .map(({ item }) => item);
}

/** Build every item, check, repair what the check flags, check again. */
async function build(): Promise<void> {
  const p = plan.value;
  if (!p || working.value) return;
  controller?.abort();
  const mine = new AbortController();
  controller = mine;
  phase.value = "build";
  working.value = true;
  error.value = "";
  check.value = null;
  installed.value = null;
  const order = buildOrder(p);
  states.value = Object.fromEntries(order.map((i) => [i.key, { status: "waiting" } as ItemState]));
  try {
    for (const item of order) {
      stage.value = `Building ${item.name}…`;
      setState(item.key, { status: "building" });
      await buildItem(p, item, mine.signal);
    }
    let report = await runCheck(p, mine.signal);
    for (let round = 0; report && round < MAX_REPAIRS; round += 1) {
      const broken = Object.entries(report.problems).filter(([k]) => states.value[k]?.result);
      if (!broken.length) break;
      const notes = new Map<string, string[]>(broken);
      for (const [key] of broken) {
        for (const dep of dependents(p, key)) if (!notes.has(dep)) notes.set(dep, []);
      }
      // Wildcards first, so rebuilt constraints see their new options.
      const queue = order.filter((i) => notes.has(i.key));
      for (const item of queue) {
        const problems = notes.get(item.key) ?? [];
        stage.value = `Fixing ${item.name}…`;
        setState(item.key, { status: "fixing", fixed: problems.length ? problems : undefined });
        await buildOne(p, item.key, problems.join("; "), mine.signal);
      }
      report = await runCheck(p, mine.signal);
    }
  } catch (err) {
    if (!isAbort(err)) error.value = message(err);
  } finally {
    if (controller === mine) {
      controller = null;
      working.value = false;
      stage.value = "";
    }
  }
}

/** Rebuild one item by hand (from its row), then check again. */
async function rebuild(key: string, note = ""): Promise<void> {
  const p = plan.value;
  if (!p || working.value) return;
  const mine = new AbortController();
  controller = mine;
  working.value = true;
  error.value = "";
  try {
    for (const k of [key, ...dependents(p, key)]) {
      const item = p.items.find((i) => i.key === k);
      stage.value = `Building ${item?.name ?? k}…`;
      setState(k, { status: "building", fixed: undefined, error: undefined });
      await buildOne(p, k, k === key ? note : "", mine.signal);
    }
    await runCheck(p, mine.signal);
  } catch (err) {
    if (!isAbort(err)) error.value = message(err);
  } finally {
    if (controller === mine) {
      controller = null;
      working.value = false;
      stage.value = "";
    }
  }
}

/** Leave a failed or waiting item out of the pack. */
function skipItem(key: string): void {
  const s = states.value[key];
  if (!s || s.result || working.value) return;
  setState(key, { status: "skipped", error: undefined });
}

/** Hide one check problem or variety note. */
function dismissNote(key: string, text: string): void {
  const next = new Set(dismissedNotes.value);
  next.add(`${key}:${text}`);
  dismissedNotes.value = next;
}

function stop(): void {
  controller?.abort();
  controller = null;
  working.value = false;
  stage.value = "";
  convo.stop();
}

async function install(): Promise<AiPackInstallResult | null> {
  const p = plan.value;
  if (!p || working.value) return null;
  working.value = true;
  error.value = "";
  stage.value = "Installing…";
  try {
    const res = await api.ai.packInstall(withTarget({ plan: p, built: built() }));
    installed.value = res;
    phase.value = "installed";
    return res;
  } catch (err) {
    error.value = message(err);
    return null;
  } finally {
    working.value = false;
    stage.value = "";
  }
}

async function undoInstall(): Promise<boolean> {
  const res = installed.value;
  if (!res) return false;
  try {
    await api.importExport.undo(res.undo_entry_id);
    installed.value = null;
    phase.value = "build";
    return true;
  } catch (err) {
    error.value = message(err);
    return false;
  }
}

function backToPlan(): void {
  stop();
  phase.value = "plan";
  states.value = {};
  check.value = null;
  installed.value = null;
}

/** Forget everything and start a new pack (settings stay). */
function reset(): void {
  backToPlan();
  convo.clear();
  convo.instruction.value = "";
  decisions.value = [];
  picks.value = {};
  webResults.value = [];
  searched.value = [];
  selected.value = new Set();
  dismissedNotes.value = new Set();
  sample.value = "";
  error.value = "";
  images.clear();
  target.value = null;
  sendPrevious = undefined;
}

/** Start "Extend with AI" for a bundle: a fresh plan aimed at it. */
function extendBundle(t: PackTarget, description = ""): void {
  reset();
  target.value = t;
  convo.instruction.value = description;
}

const builtCount = computed(
  () => Object.values(states.value).filter((s) => s.result).length,
);

/** How the build went, for the summary line. */
const summary = computed(() => {
  const all = Object.values(states.value);
  return {
    built: all.filter((s) => s.result).length,
    failed: all.filter((s) => !s.result && s.status === "failed").length,
    skipped: all.filter((s) => !s.result && s.status === "skipped").length,
    waiting: all.filter((s) => !s.result && (s.status === "waiting" || s.status === "building"
      || s.status === "retrying")).length,
  };
});

export function usePackBuilder() {
  return {
    convo, plan, draft, removed, edited, states, phase, working, stage, current, check,
    installed, error, builtCount, summary, askPlan, refinePlan, canRefine, removeItem, build,
    rebuild, stop, install, undoInstall, backToPlan, reset, sample, findings, reviewing,
    reviewPlan, fixFindings, settings, decisions, picks, questions, answeredCount, choose,
    setOther, decideFor, decideAll, pickFor, reopenDecision, changeAssumption, editItem,
    addItem, editPlan, applyFinding, dismissFinding, selected, toggleSelected, changeItem,
    changing, research, allowResearch, skipResearch, searching, webResults, images, target,
    extendBundle, skipCurrent, skipItem, dismissNote, dismissedNotes,
  };
}

/** Test seam. */
export function _resetPackBuilderForTests(): void {
  reset();
  settings.value = { ...DEFAULT_SETTINGS };
  if (recheckTimer) clearTimeout(recheckTimer);
  recheckTimer = null;
}
