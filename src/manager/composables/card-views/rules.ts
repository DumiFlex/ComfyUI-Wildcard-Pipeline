/**
 * Rule kinds old → new: a derivation edit as its IF / ELIF / ELSE blocks
 * with the changed branches marked, a constraint edit as its rule grid
 * with the changed cells marked, and a bundle edit as its ordered list
 * with + / − / moved / on → off markers. Each is drawn from the op's
 * own before and after, so the card shows what Apply does.
 */
import type { AiChatOp, AiChatProposal } from "../../api/types";
import { diffList } from "../../utils/card-diff";
import { constraintRows, derivationRules, reachText } from "./create";
import type { BranchView, BundleRowView, CardView, ConstraintRowView, InfoRowView } from "./types";
import { isObj, objects, str, type Obj } from "./util";

function payloads(op: AiChatOp, type: string): [Obj, Obj] | null {
  if (op.op !== "update" || op.kind !== "module" || op.type !== type) return null;
  const now = op.body.payload;
  if (!isObj(now)) return null;
  const was = isObj(op.before?.payload) ? op.before.payload : {};
  return [was, now];
}

/* ── Derivation ───────────────────────────────────────────────────── */

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** One rule's branches old → new, matched by place (IF, ELIF 1, …, ELSE). */
function branchDiff(was: BranchView[], now: BranchView[]): BranchView[] {
  const slot = (b: BranchView, i: number) => (b.key === "ELSE" ? "ELSE" : String(i));
  return diffList(was.map((b, i) => ({ b, k: slot(b, i) })), now.map((b, i) => ({ b, k: slot(b, i) })), (x) => x.k,
    (a, b) => same(a.b, b.b)).map((r): BranchView => {
    const b = r.now.b;
    if (r.change !== "changed" || !r.was) return { ...b, change: r.change };
    const old = r.was.b;
    const kept = new Set(old.actions);
    const fresh = new Set(b.actions);
    const acts = [
      ...b.actions.map((text) => ({ text, change: kept.has(text) ? "same" as const : "added" as const })),
      ...old.actions.filter((t) => !fresh.has(t)).map((text) => ({ text, change: "removed" as const })),
    ];
    return { ...b, change: "changed", wasTest: old.test !== b.test ? old.test : null, acts };
  });
}

export function derivationDiff(op: AiChatOp): CardView | null {
  const pair = payloads(op, "derivation");
  if (!pair) return null;
  const [was, now] = pair;
  const wasRules = derivationRules(was);
  const nowRules = derivationRules(now);
  // Rules match by id when they have one, else by place.
  const ids = (p: Obj) => objects(p.rules).map((r, i) => str(r.id) || `#${i}`);
  const keyed = (p: Obj, rules: BranchView[][]) => ids(p).map((k, i) => ({ k, rule: rules[i] }));
  const rows = diffList(keyed(was, wasRules), keyed(now, nowRules), (x) => x.k, (a, b) => same(a.rule, b.rule));
  if (rows.every((r) => r.change === "same")) return null;
  return {
    kind: "derivation",
    rules: rows.map((r) => (r.change === "changed" && r.was ? branchDiff(r.was.rule, r.now.rule)
      : r.now.rule.map((b) => ({ ...b, change: r.change })))),
    ruleChanges: rows.map((r) => r.change),
  };
}

/* ── Constraint ───────────────────────────────────────────────────── */

export function constraintDiff(p: AiChatProposal): CardView | null {
  const pair = payloads(p.op, "constraint");
  if (!pair) return null;
  const [was, now] = pair;
  const names = p.names ?? {};
  const name = (id: string) => names[id] || id;
  const key = (r: ConstraintRowView) => `${r.byTag ? "tag" : "opt"}|${r.from}|${r.to}`;
  const rows = diffList(constraintRows(was), constraintRows(now), key,
    (a, b) => a.effect === b.effect && a.factor === b.factor).map((r): ConstraintRowView => ({
    ...r.now,
    change: r.change,
    was: r.change === "changed" && r.was ? { effect: r.was.effect, factor: r.was.factor } : null,
  }));
  const fields: InfoRowView[] = [];
  for (const [label, k] of [["Source", "source_wildcard_id"], ["Target", "target_wildcard_id"]] as const) {
    if (k in now && str(now[k]) !== str(was[k])) {
      fields.push({ field: "text", label, from: name(str(was[k])), to: name(str(now[k])) });
    }
  }
  if ("target_select" in now && !same(now.target_select ?? null, was.target_select ?? null)) {
    fields.push({ field: "text", label: "Reaches", from: reachText(was.target_select) || "every use after it",
      to: reachText(now.target_select) || "every use after it" });
  }
  const unchanged = rows.filter((r) => r.change === "same").length;
  if (unchanged === rows.length && !fields.length) return null;
  const src = str(now.source_wildcard_id);
  const tgt = str(now.target_wildcard_id);
  return { kind: "constraint", source: name(src), target: name(tgt), reach: reachText(now.target_select),
    rows, same: unchanged, fields };
}

/* ── Bundle ───────────────────────────────────────────────────────── */

/** A use's settings in a few words, like the bundle editor's row
 *  (`engine/ai/use.py::describe`, the common clauses). */
export function useText(instance: unknown): string {
  if (!isObj(instance)) return "";
  const bits: string[] = [];
  const lo = instance.pick_min;
  const hi = instance.pick_max;
  if (typeof hi === "number" && (hi !== 1 || (typeof lo === "number" && lo !== 1))) {
    const from = typeof lo === "number" ? lo : hi;
    bits.push(`pick ${from}${hi !== from ? `-${hi}` : ""}${instance.pick_independent ? " repeats" : ""}`);
  }
  if (str(instance.category_filter).trim()) bits.push(`filter ${str(instance.category_filter).trim()}`);
  if (instance.exclude_null) bits.push("no empty");
  if (str(instance.match_variable)) bits.push(`match $${str(instance.match_variable)}`);
  if (instance.seed_scope === "hold") bits.push("hold");
  if (instance.internal) bits.push("internal");
  if (str(instance.variable_binding)) bits.push(`as $${str(instance.variable_binding)}`);
  if (instance.template_override) bits.push("own template");
  return bits.join("; ");
}

/** Indices (into `seq`) of a longest increasing run: the kids that kept
 *  their order. The rest moved. */
function longestRun(seq: number[]): Set<number> {
  const tails: number[] = [];
  const prev: number[] = new Array(seq.length).fill(-1);
  seq.forEach((v, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < v) lo = mid + 1; else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  });
  const keep = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) keep.add(i);
  return keep;
}

export function bundleDiff(p: AiChatProposal): CardView | null {
  const op = p.op;
  if (op.op !== "update" || op.kind !== "bundle" || !Array.isArray(op.body.children)) return null;
  const now = objects(op.body.children);
  const was = objects(op.before?.children);
  const names = p.names ?? {};
  // The same module can sit in a bundle twice: key each use by id + its count.
  const keyed = (kids: Obj[]) => {
    const seen = new Map<string, number>();
    return kids.map((k, i) => {
      const id = str(k.id);
      const n = (seen.get(id) ?? 0) + 1;
      seen.set(id, n);
      return { k, key: `${id}#${n}`, at: i + 1 };
    });
  };
  const rows = diffList(keyed(was), keyed(now), (x) => x.key, (a, b) => same(
    { e: a.k.enabled !== false, u: a.k.instance ?? null }, { e: b.k.enabled !== false, u: b.k.instance ?? null }));
  // Moves: among kids in both, those outside the longest run that kept its order.
  const both = rows.filter((r) => r.change !== "added" && r.change !== "removed");
  const run = longestRun(both.map((r) => r.was?.at ?? 0));
  const moved = new Set(both.filter((_, i) => !run.has(i)).map((r) => r.now.key));
  let at = 0;
  const out = rows.map((r): BundleRowView => {
    const k = r.now.k;
    const meta = isObj(k.meta) ? k.meta : {};
    const nameOf = str(meta.name) || str(k.name) || names[str(k.id)] || str(k.id);
    if (r.change !== "removed") at += 1;
    const old = r.was?.k;
    const enabled = k.enabled !== false;
    const use = useText(k.instance);
    const wasUse = old && r.change !== "removed" ? useText(old.instance) : null;
    const isMoved = moved.has(r.now.key);
    const change: BundleRowView["change"] = r.change === "same" && isMoved ? "moved" : r.change;
    return {
      name: nameOf, type: str(k.type), change,
      at: r.change === "removed" ? r.now.at : at,
      wasAt: isMoved ? r.was?.at ?? null : null,
      enabled,
      wasEnabled: old && r.change === "changed" && (old.enabled !== false) !== enabled ? old.enabled !== false : null,
      use,
      wasUse: wasUse !== null && wasUse !== use ? wasUse : null,
    };
  });
  const unchanged = out.filter((r) => r.change === "same").length;
  if (unchanged === out.length) return null;
  return { kind: "bundle", rows: out, same: unchanged, before: was.length, after: now.length };
}

/** Which rule-kind diff a card gets, if any. */
export function rulesView(p: AiChatProposal): CardView | null {
  return derivationDiff(p.op) ?? constraintDiff(p) ?? bundleDiff(p);
}

