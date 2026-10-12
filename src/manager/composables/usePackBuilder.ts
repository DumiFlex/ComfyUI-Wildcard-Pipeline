/**
 * usePackBuilder — the pack builder's state and steps, one module-level copy
 * so leaving the page doesn't lose a plan or a half-built pack.
 *
 * Plan: a conversation (`useAiConversation`), so answering the model's
 * questions or asking for changes refines the plan instead of starting over.
 * Build: one request per item, in the order the server's plan implies
 * (wildcards first, so rules can see their tags). Check: the pack runs on
 * the engine; an item with a problem is rebuilt once with the problem as a
 * note (twice at most), then checked again. Install: one import with one
 * undo. The server keeps nothing between requests: every call carries the
 * plan and what's built so far.
 */
import { computed, ref, shallowRef } from "vue";
import { api, ApiError } from "../api/client";
import type {
  AiPackBuilt, AiPackCheck, AiPackInstallResult, AiPackItem, AiPackItemResult, AiPackPlan,
  AiPackPlanResult,
} from "../api/types";
import { useAiConversation } from "./useAiConversation";

export type ItemStatus = "waiting" | "building" | "built" | "fixing" | "failed";

export interface ItemState {
  status: ItemStatus;
  result?: AiPackItemResult;
  error?: string;
  /** Problems the last repair was asked to fix. */
  fixed?: string[];
}

/** Repair rounds after the first check. */
const MAX_REPAIRS = 2;
const BUILD_RANK: Record<AiPackItem["kind"], number> = {
  wildcard: 0, derivation: 1, combine: 2, constraint: 3, template: 4,
};

function message(err: unknown): string {
  return err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong";
}

const answers = ref<Record<number, string>>({});
const removed = ref(new Set<string>());
const states = shallowRef<Record<string, ItemState>>({});
const phase = ref<"plan" | "build" | "installed">("plan");
const working = ref(false);
const stage = ref("");
const check = shallowRef<AiPackCheck | null>(null);
const installed = shallowRef<AiPackInstallResult | null>(null);
const error = ref("");
let controller: AbortController | null = null;

const convo = useAiConversation<AiPackPlanResult, null>({
  capture: () => null,
  send: ({ instruction, history }, signal) =>
    api.ai.packPlan({ instruction, ...(history ? { history } : {}) }, signal),
  note: (res) => {
    const bits: string[] = [];
    const gone = res.plan.items.filter((i) => removed.value.has(i.key)).map((i) => i.name);
    if (gone.length) bits.push(`they removed ${gone.join(", ")}`);
    if (res.plan.warnings.length) bits.push(`the checker said: ${res.plan.warnings.join("; ")}`);
    return bits.join(". ").slice(0, 900);
  },
});

/** The shown plan minus what the user removed. */
const plan = computed<AiPackPlan | null>(() => {
  const p = convo.result.value?.plan;
  if (!p) return null;
  return { ...p, items: p.items.filter((i) => !removed.value.has(i.key)) };
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

function answersText(): string {
  const p = convo.result.value?.plan;
  if (!p) return "";
  return p.questions
    .map((q, i) => (answers.value[i] ? `${q.question} ${answers.value[i]}` : ""))
    .filter(Boolean)
    .join("\n");
}

async function askPlan(): Promise<void> {
  error.value = "";
  answers.value = {};
  removed.value = new Set();
  await convo.ask();
}

/** Send the picked answers plus the edit box as a follow-up. */
async function refinePlan(): Promise<void> {
  const typed = convo.instruction.value.trim();
  const picked = answersText();
  const text = [picked && `Answers: ${picked}`, typed].filter(Boolean).join("\n");
  if (!text) return;
  convo.instruction.value = text;
  await convo.refine();
  if (!convo.error.value) {
    answers.value = {};
    removed.value = new Set();
  }
}

function removeItem(key: string): void {
  const next = new Set(removed.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  removed.value = next;
}

async function buildOne(p: AiPackPlan, key: string, note: string, signal: AbortSignal): Promise<boolean> {
  try {
    const res = await api.ai.packItem({ plan: p, built: built(), key, ...(note ? { note } : {}) }, signal);
    setState(key, { status: "built", result: res, error: undefined });
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    setState(key, { status: states.value[key]?.result ? "built" : "failed", error: message(err) });
    return false;
  }
}

/** Constraints built on a wildcard: its option ids change when it is
 *  rebuilt, so they are rebuilt after it. */
function dependents(p: AiPackPlan, key: string): string[] {
  const w = p.items.find((i) => i.key === key);
  if (!w || w.kind !== "wildcard") return [];
  return p.items
    .filter((i) => i.kind === "constraint" && (i.source === w.var || i.target === w.var))
    .map((i) => i.key);
}

async function runCheck(p: AiPackPlan, signal: AbortSignal): Promise<AiPackCheck | null> {
  if (!Object.keys(built()).length) return null;
  stage.value = "Testing the pack on the engine…";
  const res = await api.ai.packCheck({ plan: p, built: built() }, signal);
  check.value = res;
  return res;
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
  const order = p.items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => BUILD_RANK[a.item.kind] - BUILD_RANK[b.item.kind] || a.i - b.i)
    .map(({ item }) => item);
  states.value = Object.fromEntries(order.map((i) => [i.key, { status: "waiting" } as ItemState]));
  try {
    for (const item of order) {
      stage.value = `Building ${item.name}…`;
      setState(item.key, { status: "building" });
      // One retry: a local model's first answer is sometimes unusable.
      if (!(await buildOne(p, item.key, "", mine.signal))) {
        await buildOne(p, item.key, "", mine.signal);
      }
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
    if (!(err instanceof DOMException && err.name === "AbortError")) error.value = message(err);
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
      setState(k, { status: "building", fixed: undefined });
      await buildOne(p, k, k === key ? note : "", mine.signal);
    }
    await runCheck(p, mine.signal);
  } catch (err) {
    if (!(err instanceof DOMException && err.name === "AbortError")) error.value = message(err);
  } finally {
    if (controller === mine) {
      controller = null;
      working.value = false;
      stage.value = "";
    }
  }
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
    const res = await api.ai.packInstall({ plan: p, built: built() });
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

/** Forget everything and start a new pack. */
function reset(): void {
  backToPlan();
  convo.clear();
  convo.instruction.value = "";
  answers.value = {};
  removed.value = new Set();
  error.value = "";
}

const builtCount = computed(
  () => Object.values(states.value).filter((s) => s.result).length,
);

export function usePackBuilder() {
  return {
    convo, plan, answers, removed, states, phase, working, stage, check, installed, error,
    builtCount, askPlan, refinePlan, removeItem, build, rebuild, stop, install, undoInstall,
    backToPlan, reset,
  };
}

/** Test seam. */
export function _resetPackBuilderForTests(): void {
  reset();
}
