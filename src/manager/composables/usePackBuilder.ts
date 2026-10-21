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
  AiPackGraph, AiPackLocks, AiPackRelation, AiPackSlot,
  AiPackBuilt, AiPackCheck, AiPackDecision, AiPackFinding, AiPackInstallResult, AiPackItem,
  AiPackItemResult, AiPackKind, AiPackPatch, AiPackPlan, AiPackPlanResult, AiPackQuestion,
  AiPackSettings,
} from "../api/types";
import { pendingResearch, useAiConversation } from "./useAiConversation";
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
  // New items by default (Dumi, 2026-10-18): a pack reuses your own only
  // when you pick "Reuse what fits".
  library: "inspire", negatives: "auto", structure: "sections", style: "auto", rating: "auto",
  count: 0, model: "any", youth_negative: "on", planner: "graph", drafts: "one",
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
  if (patch.op === "plan") return { ...plan, ...patch.set };
  if (patch.op === "slot") {
    if (!plan.graph) return plan;
    const slots = plan.graph.slots.map((s) => (s.var === patch.var ? { ...s, ...patch.set } : s));
    return { ...plan, graph: { ...plan.graph, slots } };
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

/** An update that talks about the reference images, so they go along
 *  again ("a skirt like the one in image 2"). */
export function mentionsImages(text: string): boolean {
  return /\b(images?|pictures?|photos?|pics?|screenshots?|references?|reference images?)\b/i.test(text);
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

/** The pack settings are kept in this browser, so the Settings step
 *  starts from what was chosen last time. */
const SETTINGS_KEY = "wp-pack-settings";
const SETTINGS_VERSION = 2;

export function savedSettings(): AiPackSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<AiPackSettings> | null;
    if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
    const out = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS) as Array<keyof AiPackSettings>) {
      if (typeof raw[k] === typeof DEFAULT_SETTINGS[k]) (out as Record<string, unknown>)[k] = raw[k];
    }
    // Saved before the default became "inspire": "reuse" was the old
    // default riding along with another change, not a choice.
    if ((raw as { v?: number }).v !== SETTINGS_VERSION && out.library === "reuse") {
      out.library = DEFAULT_SETTINGS.library;
    }
    return out;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

const settings = ref<AiPackSettings>(savedSettings());
watch(settings, (v) => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...v, v: SETTINGS_VERSION }));
  } catch { /* private window */ }
}, { deep: true });
const decisions = ref<AiPackDecision[]>([]);
/** Decisions the user took back to answer again in words (by question):
 *  still listed, not sent as settled, dropped once the next plan comes. */
const reopened = ref(new Set<string>());
const settled = computed(() => decisions.value.filter((d) => !reopened.value.has(d.question)));
const picks = ref<Record<string, QuestionPick>>({});
/** Search results the user allowed, waiting to go with the next request. */
const webResults = shallowRef<Array<{ query: string; text: string }>>([]);
/** Searches run or skipped; the planner isn't asked for them again. */
const searched = ref<string[]>([]);
const searching = ref(false);
const images = useAiImages();
/** Send the reference images with the next update even if they didn't
 *  change. Off: they go with the first plan and again only when the user
 *  adds or removes one, since each costs about 1,000 tokens a request. */
const resendImages = ref(false);
/** The images last sent (their URLs joined), and how many went with the
 *  conversation's first request (its prompt says so on every replay). */
let sentImages = "";
let firstImages = 0;
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
    const urls = images.urls() ?? [];
    const key = urls.join("|");
    const withImages = !followUp || key !== sentImages || resendImages.value
      || mentionsImages(instruction);
    if (withImages) sentImages = key;
    if (!followUp) firstImages = urls.length;
    resendImages.value = false;
    return api.ai.packPlan({
      instruction, ...(history ? { history } : {}),
      ...(sample.value.trim() ? { sample: sample.value.trim() } : {}),
      settings: settings.value,
      ...(settled.value.length ? { decisions: settled.value } : {}),
      ...(followUp && sendPrevious ? { previous: sendPrevious } : {}),
      ...(withImages && urls.length ? { images: urls } : {}),
      ...(followUp && firstImages ? { image_count: firstImages } : {}),
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

/** What the model thought while it planned, when its server sends that. */
const planThinking = computed(() => convo.result.value?.thinking ?? "");

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
const research = computed<string[]>(() => pendingResearch(
  convo.chain.value.map((r) => r.plan.research), searched.value));

/** How an item differs from the plan before this round: new, or changed
 *  (which parts), so a refine shows what it touched. */
export interface PlanChange {
  kind: "new" | "changed";
  what: string[];
}

const CHANGE_FIELDS: Array<[keyof AiPackItem, string]> = [
  ["name", "name"], ["var", "variable"], ["kind", "kind"], ["about", "description"],
  ["count", "options"], ["section", "section"], ["tags", "tags"], ["source", "source"],
  ["target", "target"], ["use", "use"],
];

/** The plan the user saw before this round, or null on the first one. */
const before = computed<AiPackItem[] | null>(() => {
  const chain = convo.chain.value;
  const prev = chain.length > 1 ? chain[chain.length - 2] : null;
  if (!prev) return null;
  const v = viewFor(prev);
  return v.draft.items.filter((i) => !v.removed.has(i.key));
});

const changes = computed<Record<string, PlanChange>>(() => {
  const old = before.value;
  const res = convo.result.value;
  if (!old || !res) return {};
  const byKey = new Map(old.map((i) => [i.key, i]));
  const out: Record<string, PlanChange> = {};
  for (const i of res.plan.items) {
    const was = byKey.get(i.key);
    if (!was) {
      out[i.key] = { kind: "new", what: [] };
      continue;
    }
    const what = CHANGE_FIELDS.filter(([f]) => JSON.stringify(i[f] ?? "") !== JSON.stringify(was[f] ?? ""))
      .map(([, label]) => label);
    if (what.length) out[i.key] = { kind: "changed", what };
  }
  return out;
});

/** Items the last round took out of the plan, by name. */
const dropped = computed<string[]>(() => {
  const old = before.value;
  const res = convo.result.value;
  if (!old || !res) return [];
  const now = new Set(res.plan.items.map((i) => i.key));
  return old.filter((i) => !now.has(i.key) && !i.existing).map((i) => (i.var ? `$${i.var}` : i.name));
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

/** Pick (or unpick) a choice; a single-answer question keeps one. A
 *  question the code asked is settled by the code as soon as it has its
 *  answer (two picks for a sweep). */
function choose(q: AiPackQuestion, choice: string): void {
  const cur = pickFor(q.question);
  const has = cur.chosen.includes(choice);
  const chosen = q.multi
    ? (has ? cur.chosen.filter((c) => c !== choice) : [...cur.chosen, choice])
    : (has ? [] : [choice]);
  setPick(q.question, { chosen, other: q.multi ? cur.other : "", decide: false });
  if (q.binds) settle(q, chosen);
}

/** Apply a code question's answer to the plan (no AI call) and keep it as
 *  a decision, so it is not asked again. A sweep needs two slots before
 *  it is settled; the slots picked so far are marked meanwhile. */
function settle(q: AiPackQuestion, chosen: string[]): void {
  const p = draft.value;
  const b = q.binds;
  if (!p || !b) return;
  let done = false;
  if (b.set === "run" && chosen.length) {
    const story = chosen[0] !== "Single images";
    editPlan({ run: story ? { mode: "story", frames: b.frames } : { mode: "single", frames: 0 } });
    done = true;
  } else if (b.set === "sweep") {
    const on = new Set(chosen);
    editGraph((g) => ({ ...g, slots: g.slots.map((s) => ({ ...s, sweep: on.has(s.name) })) }));
    done = chosen.length >= 2;
  }
  if (!done) return;
  const d = { question: q.question, answer: chosen.join(", ") };
  mergeDecisions([d]);
  const now = draft.value;
  if (!now) return;
  // A sweep takes two or three slots: the question stays open for a third
  // (the decision is recorded either way), and goes once three are picked.
  const open = b.set === "sweep" && chosen.length < 3 && q.choices.length > 2;
  editDraft({
    ...now,
    questions: open ? now.questions : now.questions.filter((x) => x.question !== q.question),
    decisions: [...now.decisions.filter((x) => x.question !== d.question), d],
  });
}

/** Type your own answer ("Other…"). A single-answer question drops its
 *  picked choice. */
function setOther(q: AiPackQuestion, text: string): void {
  const cur = pickFor(q.question);
  setPick(q.question, { chosen: q.multi || !text.trim() ? cur.chosen : [], other: text, decide: false });
}

function decideFor(q: AiPackQuestion): void {
  if (q.binds) {
    // The code's own question: "decide for me" takes the first choice
    // (the first two for a sweep).
    const chosen = q.choices.slice(0, q.multi ? 2 : 1);
    setPick(q.question, { chosen, other: "", decide: false });
    settle(q, chosen);
    return;
  }
  const cur = pickFor(q.question);
  setPick(q.question, { chosen: [], other: "", decide: !cur.decide });
}

/** "Decide for me" on every question not answered yet. */
function decideAll(): void {
  const next = { ...picks.value };
  for (const q of questions.value) {
    if (!q.binds && !pickAnswer(next[q.question])) next[q.question] = { chosen: [], other: "", decide: true };
  }
  picks.value = next;
  // The code's own questions are settled on the spot.
  for (const q of [...questions.value]) {
    if (q.binds) decideFor(q);
  }
}

/** The answers given this round, as decisions. */
function pendingDecisions(): AiPackDecision[] {
  return questions.value
    .map((q) => ({ question: q.question, answer: pickAnswer(picks.value[q.question]) }))
    .filter((d) => d.answer);
}

const answeredCount = computed(() => pendingDecisions().length);

/** Take a decision back: its question goes into the edit box, to answer
 *  again in words; it stays listed, marked, until the next plan. Clicking
 *  it again puts it back as it was. */
function reopenDecision(i: number): boolean {
  const d = decisions.value[i];
  if (!d) return false;
  const line = `About "${d.question}": `;
  const next = new Set(reopened.value);
  if (next.has(d.question)) {
    next.delete(d.question);
    reopened.value = next;
    convo.instruction.value = convo.instruction.value.split("\n")
      .filter((l) => !l.startsWith(line.trim())).join("\n");
    return false;
  }
  next.add(d.question);
  reopened.value = next;
  convo.instruction.value = [convo.instruction.value.trim(), line].filter(Boolean).join("\n");
  return true;
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
  reopened.value = new Set();
  picks.value = {};
  webResults.value = [];
  searched.value = [];
  dismissedNotes.value = new Set();
  unfixed.value = new Set();
  stuck.value = new Set();
  sendPrevious = undefined;
  await convo.ask();
}

/** Send this round's answers, the edit box, any allowed search results
 *  and the plan as edited, as a follow-up. */
async function refinePlan(): Promise<void> {
  if (!convo.result.value || convo.loading.value || awaitingSearch.value) return;
  const answers = pendingDecisions();
  const typed = convo.instruction.value.trim();
  const text = typed
    || (answers.length ? "I answered your questions."
      : webResults.value.length ? "Use what the searches found."
        : edited.value ? "I edited the plan; keep my changes and fill any gaps they leave." : "");
  if (!text) return;
  const before = decisions.value;
  const was = reopened.value;
  if (was.size) {
    decisions.value = decisions.value.filter((d) => !was.has(d.question));
    reopened.value = new Set();
  }
  mergeDecisions(answers);
  sendPrevious = plan.value ?? undefined;
  convo.instruction.value = text;
  await convo.refine();
  if (convo.error.value) {
    decisions.value = before;
    reopened.value = was;
    convo.instruction.value = typed;
    return;
  }
  webResults.value = [];
}

/** The planner asked to search the web and the user hasn't said yes or
 *  no: what it finds may change the questions and the plan, so answers,
 *  updates and Build wait for it. */
const awaitingSearch = computed(() => research.value.length > 0);

/** Ask the model for the next round of questions with no other change. */
const canRefine = computed(() => !convo.loading.value && !!convo.result.value && !awaitingSearch.value && (
  !!convo.instruction.value.trim() || answeredCount.value > 0 || webResults.value.length > 0
  || edited.value));

function editDraft(next: AiPackPlan, extra: Partial<PlanView> = {}): void {
  setView({ draft: next, edited: true, ...extra });
  scheduleRecheck();
}

/** Change fields of one item by hand. On a graph plan the fields a slot
 *  carries go to its slot; the server compiles the item from it again. */
function editItem(key: string, set: Partial<Omit<AiPackItem, "key" | "id">>): void {
  const p = draft.value;
  if (!p) return;
  const slot = slotOf(key);
  if (p.graph && slot) {
    const next: Partial<AiPackSlot> = {};
    if (set.name !== undefined) next.name = set.name;
    if (set.var !== undefined) next.var = set.var;
    if (set.about !== undefined) next.what = set.about;
    if (set.section !== undefined) next.section = set.section;
    if (set.count !== undefined) next.count = set.count;
    editSlot(slot.var, next);
    return;
  }
  editDraft(applyPatch(p, { op: "edit", key, set }));
}

/** The graph slot behind a plan item (a wildcard of a graph plan). */
function slotOf(key: string): AiPackSlot | null {
  const p = draft.value;
  const i = p?.items.find((x) => x.key === key);
  if (!p?.graph || !i || i.kind !== "wildcard") return null;
  return p.graph.slots.find((s) => s.var === i.var) ?? null;
}

/** The graph relations behind a plan item: a constraint's pair, a
 *  derivation's written variable, or the lists a wildcard draws from. */
function relationsOf(key: string): number[] {
  const p = draft.value;
  const i = p?.items.find((x) => x.key === key);
  if (!p?.graph || !i) return [];
  const byVar = new Map(p.graph.slots.map((s) => [s.var, s.name]));
  return p.graph.relations.flatMap((r, n) => {
    if (i.kind === "constraint" && r.kind !== "draw" && r.to && r.from.slot === byVar.get(i.source) && r.to.slot === byVar.get(i.target)) return [n];
    if (i.kind === "derivation" && r.var === i.var && !r.to) return [n];
    if (i.kind === "wildcard" && r.kind === "draw" && r.to?.slot === byVar.get(i.var)) return [n];
    return [];
  });
}

/** A relation's signature, equal to the server's `raw_rel_sig`: what the
 *  locks name a relation by. */
export function relSig(r: AiPackRelation): string {
  return [r.kind, r.from.slot, r.from.axis, r.from.value, r.to?.slot ?? "", r.to?.axis ?? "",
    r.to?.value ?? "", r.var ?? "", r.text ?? ""].join("|");
}

const NO_LOCKS: AiPackLocks = { slots: [], relations: [], removed_relations: [], template: [] };

function locksOf(p: AiPackPlan): AiPackLocks {
  return { ...NO_LOCKS, ...(p.locks ?? {}) };
}

function withLock<T>(list: T[], add: T[] = [], drop: T[] = []): T[] {
  const gone = new Set(drop);
  return [...new Set([...list, ...add])].filter((x) => !gone.has(x));
}

/** Change the graph by hand; the server compiles the items from it again.
 *  `lock` records what the edit set, so the model's next answer keeps it. */
function editGraph(change: (g: AiPackGraph) => AiPackGraph,
  lock?: (l: AiPackLocks, g: AiPackGraph) => AiPackLocks): void {
  const p = draft.value;
  if (!p?.graph) return;
  const locks = lock ? lock(locksOf(p), p.graph) : p.locks;
  editDraft({ ...p, graph: change(p.graph), ...(locks ? { locks } : {}) });
}

function editSlot(v: string, set: Partial<AiPackSlot>): void {
  const renamed = set.var !== undefined && set.var !== v ? set.var : "";
  const g0 = draft.value?.graph;
  const was = g0?.slots.find((s) => s.var === v)?.name ?? "";
  const named = set.name !== undefined && set.name !== was ? set.name : "";
  // Relations name a slot by its name: a renamed slot takes them along
  // (and the signatures its locks hold), or the server drops them all.
  const follow = (r: AiPackRelation): AiPackRelation => (named
    ? { ...r, from: r.from.slot === was ? { ...r.from, slot: named } : r.from,
      ...(r.to ? { to: r.to.slot === was ? { ...r.to, slot: named } : r.to } : {}) }
    : r);
  const resign = (sigs: string[], rels: AiPackRelation[]): string[] =>
    sigs.map((sig) => { const r = rels.find((x) => relSig(x) === sig); return r ? relSig(follow(r)) : sig; });
  editGraph((g) => {
    const slots = g.slots.map((s) => (s.var === v ? { ...s, ...set } : s));
    const relations = named ? g.relations.map(follow) : g.relations;
    if (!renamed) return { ...g, slots, relations };
    // The template follows the slot by variable.
    return { ...g, slots, relations, template: { ...g.template, order: g.template.order.map((o) => (o === v ? renamed : o)) } };
  }, (l, g) => ({
    ...l,
    slots: withLock(l.slots, [renamed || v], renamed ? [v] : []),
    relations: resign(l.relations, g.relations),
  }));
}

function editRelation(n: number, set: Partial<AiPackRelation>): void {
  editGraph((g) => ({ ...g, relations: g.relations.map((r, i) => (i === n ? { ...r, ...set } : r)) }),
    (l, g) => {
      const was = g.relations[n];
      if (!was) return l;
      const now = relSig({ ...was, ...set });
      return { ...l, relations: withLock(l.relations, [now], [relSig(was)]),
        removed_relations: withLock(l.removed_relations, [], [now]) };
    });
}

function removeRelation(n: number): void {
  editGraph((g) => ({ ...g, relations: g.relations.filter((_, i) => i !== n) }), (l, g) => {
    const was = g.relations[n];
    if (!was) return l;
    return { ...l, relations: withLock(l.relations, [], [relSig(was)]),
      removed_relations: withLock(l.removed_relations, [relSig(was)]) };
  });
}

/** A relation the user hasn't finished: no axis value where the kind
 *  needs one, or a rule with no variable or text yet. */
export function unfinished(r: AiPackRelation): boolean {
  if (r.kind === "derive" || r.kind === "append") return !r.from.value || !r.var || !r.text;
  if (r.kind === "agree" || r.kind === "accepts" || r.kind === "draw") return false;
  return !r.from.value || !r.to?.value;
}

function addRelation(r: AiPackRelation): void {
  editGraph((g) => ({ ...g, relations: [...g.relations, r] }), (l) => ({
    ...l, relations: withLock(l.relations, [relSig(r)]),
    removed_relations: withLock(l.removed_relations, [], [relSig(r)]),
  }));
}

/** A blank slot added by hand (the server compiles its wildcard). */
function addSlot(section = ""): void {
  const p = draft.value;
  const taken = new Set(p?.graph?.slots.map((s) => s.var) ?? []);
  let n = taken.size + 1;
  while (taken.has(`slot_${n}`)) n += 1;
  const slot: AiPackSlot = {
    name: `Slot ${n}`, var: `slot_${n}`, what: "", section, count: 12, show: "prompt",
    pick: "", hold: false, sometimes_none: 0, axes: [],
  };
  editGraph((g) => ({ ...g, slots: [...g.slots, slot], template: { ...g.template, order: [...g.template.order, slot.var] } }),
    (l) => ({ ...l, slots: withLock(l.slots, [slot.var]) }));
}

/** Whether the user set the slot behind this item by hand (the AI's next
 *  answer keeps it). */
function locked(key: string): boolean {
  const slot = slotOf(key);
  return !!slot && (draft.value?.locks?.slots ?? []).includes(slot.var);
}

/** Set template fields by hand (lead, order, tail, negative); each stays
 *  as set through the model's next answer. */
function editTemplate(set: Partial<AiPackGraph["template"]>): void {
  const fields = (Object.keys(set) as Array<keyof AiPackGraph["template"]>);
  editGraph((g) => ({ ...g, template: { ...g.template, ...set } }),
    (l) => ({ ...l, template: withLock(l.template, fields) }));
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

/** Edit plan-wide fields (title, summary, anchor, rating, style, how it runs). */
function editPlan(set: Partial<Pick<AiPackPlan, "title" | "summary" | "anchor" | "rating" | "style" | "run">>): void {
  const p = draft.value;
  if (!p) return;
  // A graph plan's run lives on the graph too: what the model is shown on
  // the next update is the run the user set, never the one it last wrote.
  const graph = p.graph && set.run ? { ...p.graph, run: set.run } : p.graph;
  editDraft({ ...p, ...set, ...(graph ? { graph } : {}) });
}

function removeItem(key: string): void {
  const v = view.value;
  if (!v) return;
  if (v.draft.graph) {
    // A graph plan's items come from the graph: leaving one out means
    // taking its slot, fixed values or relations out of the graph.
    const i = v.draft.items.find((x) => x.key === key);
    const slot = slotOf(key);
    const rels = new Set(relationsOf(key));
    if (!i || i.kind === "template") return;
    const gone = (g: AiPackGraph): AiPackRelation[] => g.relations.filter((r, n) => rels.has(n)
      || (!!slot && (r.from.slot === slot.name || r.to?.slot === slot.name)));
    editGraph((g) => {
      const out = new Set(gone(g));
      return {
        ...g,
        slots: slot ? g.slots.filter((s) => s.var !== slot.var) : g.slots,
        fixed: i.kind === "fixed_values" ? g.fixed.filter((f) => f.var !== i.var) : g.fixed,
        relations: g.relations.filter((r) => !out.has(r)),
        template: { ...g.template, order: g.template.order.filter((o) => o !== i.var) },
      };
    }, (l, g) => {
      const sigs = gone(g).map(relSig);
      return { ...l, slots: slot ? withLock(l.slots, [], [slot.var]) : l.slots,
        relations: withLock(l.relations, [], sigs), removed_relations: withLock(l.removed_relations, sigs) };
    });
    return;
  }
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

// A settings change lands on a graph plan through the code (counts,
// style, rating, sections), with no model call.
watch(settings, () => {
  if (draft.value?.graph && !convo.loading.value) scheduleRecheck();
}, { deep: true });

/** Check the edited plan again (the checker, no model) after a pause. */
function scheduleRecheck(): void {
  if (recheckTimer) clearTimeout(recheckTimer);
  recheckTimer = setTimeout(() => {
    recheckTimer = null;
    void recheck();
  }, RECHECK_MS);
}

/** The server reads the edited plan: findings for it, and its cleaned
 *  copy of each item. An item it leaves out (one still being filled in by
 *  hand) stays in the draft as the user has it; its warning says why. */
async function recheck(): Promise<void> {
  const res = convo.result.value;
  const p = plan.value;
  const v = view.value;
  if (!res || !p || !v) return;
  try {
    const got = await api.ai.packReview(withTarget({
      plan: { ...p, settings: settings.value }, request: convo.asked.value[0] ?? "",
    }));
    if (convo.result.value !== res || view.value?.draft !== v.draft) return;
    const server = new Map(got.plan.items.map((i) => [i.key, i]));
    // A graph plan's items are whatever the graph compiles to now; an
    // item-list plan keeps items the server left out (still being typed).
    const items = v.draft.graph
      ? got.plan.items
      : v.draft.items.map((i) => (v.removed.has(i.key) ? i : server.get(i.key) ?? i));
    // A rule added by hand and not filled in yet names no axis or value:
    // the server leaves it out, so it is kept here (without the warning
    // that says so) until the user finishes it.
    const blank = v.draft.graph ? v.draft.graph.relations.filter(unfinished) : [];
    const kept = got.plan.graph
      ? blank.filter((r) => !got.plan.graph?.relations.some((x) => relSig(x) === relSig(r)))
      : [];
    const graph = got.plan.graph && kept.length
      ? { ...got.plan.graph, relations: [...got.plan.graph.relations, ...kept] }
      : got.plan.graph;
    const warnings = v.draft.graph
      ? got.plan.warnings.filter((w) => !(kept.length && /^Left out a relation: .*(no axis|no value|no variable or text)/.test(w)))
      : [...new Set([...v.draft.warnings, ...got.plan.warnings])];
    setView({
      draft: {
        ...v.draft, items, warnings, sections: got.plan.sections, settings: got.plan.settings,
        ...(graph ? { graph, locks: got.plan.locks, applied: got.plan.applied } : {}),
      },
      review: got.findings.filter((f) => f.by !== "model"),
    });
  } catch (err) {
    error.value = message(err);
  }
}

/** Ask the model to review the plan too. */
/** Have the model review the plan. ``recheck`` is the texts of its own
 *  findings Fix all just sent: it then repeats the ones still there (same
 *  text, so they show as unfixed) and adds at most two new ones. */
async function reviewPlan(recheck?: string[]): Promise<void> {
  const p = plan.value;
  if (!p || reviewing.value) return;
  reviewing.value = true;
  error.value = "";
  try {
    const res = await api.ai.packReview(withTarget({
      plan: p, ai: true, request: convo.asked.value[0] ?? "",
      ...(recheck?.length ? { recheck } : {}),
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

/** What a refine's instruction may hold: the server takes 2000 characters
 *  (`MAX_INSTRUCTION_LEN`); the rest is room for its own wrapping. */
const NOTE_MAX = 1800;

/** Split numbered note lines into runs that fit ``room`` characters each
 *  (a line that can't fit alone is cut). */
export function noteChunks(lines: string[], room: number): string[][] {
  const fit = Math.max(200, room);
  const out: string[][] = [];
  let cur: string[] = [];
  let used = 0;
  for (const raw of lines) {
    const line = raw.length > fit - 6 ? raw.slice(0, fit - 7) + "…" : raw;
    const cost = line.length + 5; // "NN. " + newline
    if (cur.length && used + cost > fit) {
      out.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(line);
    used += cost;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Findings Fix all sent to the model that came back unchanged, by id
 *  (ids come from what a finding says, so the same one keeps its id). */
const unfixed = ref(new Set<string>());
/** Findings the AI left unchanged twice: Fix all stops sending them (do it
 *  by hand, dismiss it, or tick it to send it once more on purpose). */
const stuck = ref(new Set<string>());

/** Fix the ticked findings (or every open one): the ones with a built-in
 *  fix are applied here with no model, the rest go to the planner. Ones
 *  the planner hands back unchanged are marked, and the next Fix all
 *  leaves them out instead of sending the same notes round again. */
async function fixFindings(): Promise<void> {
  const open = findings.value;
  const ticked = open.filter((f) => selected.value.has(f.id));
  const fresh = open.filter((f) => !unfixed.value.has(f.id));
  const again = open.filter((f) => !stuck.value.has(f.id));
  const list = ticked.length ? ticked : fresh.length ? fresh : again;
  if (!list.length) return;
  selected.value = new Set();
  const v = view.value;
  const patched = list.filter((f) => f.patch);
  if (v && patched.length) {
    let next = v.draft;
    for (const f of patched) next = applyPatch(next, f.patch!);
    const dismissed = new Set(v.dismissed);
    for (const f of patched) dismissed.add(f.id);
    editDraft(next, { dismissed });
  }
  let rest = list.filter((f) => !f.patch);
  if (!rest.length) return;
  if (v?.draft.graph) {
    // A finding about one item of a graph plan is one narrow change call
    // on that part (its slot, rule or template); only the whole-pack ones
    // go to the planner. One the change call can't take joins them.
    const wide: AiPackFinding[] = [];
    for (const f of rest) {
      if (!f.key || !(await changeItem(f.key, f.text))) wide.push(f);
    }
    rest = wide;
    if (!rest.length) {
      const narrow = list.filter((f) => !f.patch);
      await settleRound(narrow.map((f) => f.id), narrow.filter((f) => f.by === "model").map((f) => f.text));
      return;
    }
  }
  // Numbered, each with its item, so a small model works through all of
  // them instead of fixing the first and calling it done.
  const items = new Map((plan.value?.items ?? []).map((i) => [i.key, i]));
  const left = rest.some((f) => unfixed.value.has(f.id));
  const lines = rest.map((f) => {
    const item = f.key ? items.get(f.key) : undefined;
    const what = item ? `${item.name} (${item.kind}${item.var ? `, $${item.var}` : ""}): ` : "";
    return `${what}${f.text.replace(/\.\s*$/, "")}.`;
  });
  const head = "Revise the plan to fix ALL of these, one by one:\n";
  const tail = "\nWhere one asks for a new item (a constraint, a derivation, a wildcard), "
    + "add it to the plan; where one asks to change an item, change that item's fields."
    + (left ? "\nThe last revision left these exactly as they were: change the plan this time, "
      + "or remove the item they are about if it can't be fixed." : "");
  const own = convo.instruction.value.trim();
  const sent = new Set(rest.map((f) => f.id));
  // The request takes NOTE_MAX characters, so a long list goes over in
  // rounds; the user's own text rides with the first.
  // A long typed text goes on its own first, so the notes keep their room.
  const alone = own.length > NOTE_MAX / 2;
  const chunks = noteChunks(lines, NOTE_MAX - head.length - tail.length
    - (alone ? 0 : own.length + 1));
  const rounds = alone ? [null, ...chunks] : chunks;
  for (const [n, chunk] of rounds.entries()) {
    const note = chunk ? head + chunk.map((l, k) => `${k + 1}. ${l}`).join("\n") + tail : "";
    convo.instruction.value = [n === 0 ? own : "", note].filter(Boolean).join("\n");
    await refinePlan();
    if (convo.error.value) {
      // Put back what the user typed (if it wasn't sent yet), not the note.
      convo.instruction.value = n === 0 ? own : "";
      return;
    }
  }
  await settleRound([...sent], rest.filter((f) => f.by === "model").map((f) => f.text));
}

/** After a Fix all round: the model's own findings sent (`recheck`, their
 *  texts) are checked again on the new plan, so one it didn't fix shows up
 *  again instead of quietly disappearing, and one left as it was twice is
 *  marked as something the AI can't change. */
async function settleRound(sentIds: string[], recheck: string[]): Promise<void> {
  const sent = new Set(sentIds);
  if (recheck.length) await reviewPlan(recheck);
  const back = findings.value.filter((f) => sent.has(f.id)).map((f) => f.id);
  stuck.value = new Set([...stuck.value, ...back.filter((id) => unfixed.value.has(id))]);
  unfixed.value = new Set(back);
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
    const res = await api.ai.packChange(withTarget({
      plan: p, ...(key ? { key } : {}), instruction: text, request: convo.asked.value[0] ?? "",
    }));
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

/** Reference images added after a graph plan was made: one narrow call
 *  says what they add (slots, fixed values, "from your images" lines) and
 *  the code merges it, instead of a whole re-plan with the images. */
async function readImages(urls: string[], key: string): Promise<void> {
  const p = plan.value;
  const v = view.value;
  if (!p?.graph || !v || changing.value) return;
  changing.value = "images";
  error.value = "";
  try {
    const res = await api.ai.packImages(withTarget({
      plan: p, images: urls, request: convo.asked.value[0] ?? "",
    }));
    sentImages = key;
    if (view.value !== v) return;
    setView({
      draft: { ...v.draft, ...res.plan, questions: v.draft.questions, research: v.draft.research },
      review: res.review, edited: true,
    });
  } catch (err) {
    error.value = message(err);
  } finally {
    changing.value = "";
  }
}

// An image added to a graph plan is read on the spot; the next update
// then doesn't send the images again.
watch(() => images.urls()?.join("|") ?? "", (key) => {
  if (!draft.value?.graph || convo.loading.value || changing.value || !key) return;
  const seen = new Set(sentImages.split("|").filter(Boolean));
  const fresh = (images.urls() ?? []).filter((u) => !seen.has(u));
  if (fresh.length) void readImages(fresh, key);
});

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
  const first = states.value[item.key]?.result;
  const repair = first?.repair;
  if (repair && states.value[item.key]?.status === "built") {
    stage.value = `Fixing ${item.name}…`;
    setState(item.key, { status: "fixing", fixed: [repair] });
    await buildOne(p, item.key, repair, signal);
    // A rebuilt slot that still misses an axis value gets one fill: the
    // options stay and the missing ones are added (never after a fill).
    const again = states.value[item.key]?.result;
    if (again?.repair && again.fill && !first?.fill && states.value[item.key]?.status === "built") {
      stage.value = `Filling ${item.name}…`;
      setState(item.key, { status: "fixing", fixed: [repair, again.repair] });
      await buildOne(p, item.key, again.repair, signal);
    }
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
  for (const [key, t] of Object.entries(res.tidied ?? {})) {
    const result = states.value[key]?.result;
    if (!result) continue;
    setState(key, {
      result: {
        ...result, payload: t.payload, preview: t.preview,
        warnings: [...result.warnings, ...t.warnings.filter((w) => !result.warnings.includes(w))],
      },
    });
  }
  check.value = res;
  dismissedNotes.value = new Set();
  unfixed.value = new Set();
  stuck.value = new Set();
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
  reopened.value = new Set();
  picks.value = {};
  webResults.value = [];
  searched.value = [];
  selected.value = new Set();
  dismissedNotes.value = new Set();
  unfixed.value = new Set();
  stuck.value = new Set();
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
    installed, error, builtCount, summary, askPlan, refinePlan, canRefine, awaitingSearch, removeItem, build,
    rebuild, stop, install, undoInstall, backToPlan, reset, sample, findings, reviewing,
    reviewPlan, fixFindings, unfixed, stuck, settings, decisions, picks, questions, answeredCount, choose,
    setOther, decideFor, decideAll, pickFor, reopenDecision, changeAssumption, editItem, slotOf, relationsOf, editGraph, editSlot, editRelation, removeRelation, addRelation, addSlot, editTemplate, locked, changes, dropped, reopened, resendImages,
    addItem, editPlan, applyFinding, dismissFinding, selected, toggleSelected, changeItem,
    changing, research, allowResearch, skipResearch, searching, webResults, images, target,
    extendBundle, skipCurrent, skipItem, dismissNote, dismissedNotes, planThinking,
  };
}

/** Test seam. */
export function _resetPackBuilderForTests(): void {
  reset();
  settings.value = { ...DEFAULT_SETTINGS };
  if (recheckTimer) clearTimeout(recheckTimer);
  recheckTimer = null;
}
