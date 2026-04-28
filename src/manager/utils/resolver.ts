/**
 * Client-side resolver helpers used by the Test Runner to simulate the
 * engine's behavior in the browser. These are pure functions that operate
 * on the cached module catalog returned by `/wp/api/modules?type=...`.
 *
 * Faithfully ported from the React reference at
 * `docs/design-handoff/wildcardpipeline/project/screens/utilities.jsx`
 * (`TR_ENGINE`) and `docs/design-handoff/wildcardpipeline/project/data.jsx`
 * (`expandInline`, `resolveWildcard`, `resolveByVar`).
 *
 * `expandInlineChoices` delegates to `resolveTokens` (surface="wildcard") so
 * brace-block picking shares the same code path as the Python engine.
 * `expandRefs` / `fillTemplate` / `resolveWildcard` retain their name-based
 * resolution logic because legacy option values still use `@name` / `$name`
 * syntax rather than UUID refs.
 */
import type {
  CombinePayload,
  ConstraintCell,
  ConstraintMatrix,
  ConstraintPayload,
  DerivationPayload,
  DerivationRule,
  ModuleRow,
  PipelineStep,
  WildcardOption,
  WildcardPayload,
} from "../api/types";
import { resolveTokens } from "./resolveTokens";
import type { ResolveContext } from "./resolveTokens";
import { toIdentifier } from "./slug";

/* -------------------------------------------------------------------------- */
/* Wildcards                                                                  */
/* -------------------------------------------------------------------------- */

/** Pick a weighted-random option. Returns null only when `options` is empty. */
export function pickWeightedOption(
  options: WildcardOption[],
): WildcardOption | null {
  if (!options.length) return null;
  const total = options.reduce(
    (a, b) => a + (Number(b.weight) || 0),
    0,
  );
  if (total <= 0) return options[0];
  let r = Math.random() * total;
  for (const opt of options) {
    r -= Number(opt.weight) || 0;
    if (r <= 0) return opt;
  }
  return options[options.length - 1];
}

/**
 * Expand inline `{a|b|c}` choices in a value string. Each occurrence is
 * resolved to one of its `|`-separated branches at random. Nested braces are
 * supported recursively via `resolveTokens` (surface="wildcard").
 */
export function expandInlineChoices(text: string): string {
  if (!text) return text;
  const ctx: ResolveContext = {
    rng: {
      random: () => Math.random(),
      randrange: (n: number) => Math.floor(Math.random() * n),
    },
    maxRefDepth: 16,
    strict: false,
    surface: "wildcard",
    developerMode: false,
    warnings: [],
    vars: {},
    modules: {},
  };
  return resolveTokens(String(text), ctx);
}

/* -------------------------------------------------------------------------- */
/* Refs                                                                        */
/* -------------------------------------------------------------------------- */

/** Stable variable name for a wildcard module — `payload.var_binding` if
 *  present, else slug of the module name. Mirrors `WildcardForm.vue`. */
function wildcardVar(mod: ModuleRow): string {
  const payload = mod.payload as Partial<WildcardPayload>;
  const explicit = (payload?.var_binding ?? "").toString().trim();
  return explicit || toIdentifier(mod.name);
}

/**
 * Resolve `@var` and `@{var}` references in `text`. Looks up the value in
 * `ctx` first; if absent, walks the wildcard catalog by `var_binding` and
 * recursively resolves a sample. Unknown refs collapse to empty string
 * (matching the prototype's `resolveByVar`).
 */
export function expandRefs(
  text: string,
  ctx: Record<string, string>,
  allWildcards: ModuleRow[],
): string {
  if (!text) return text;
  const byVar = new Map<string, ModuleRow>();
  for (const w of allWildcards) {
    if (w.type === "wildcard") byVar.set(wildcardVar(w), w);
  }
  const lookup = (name: string): string => {
    if (ctx[name] !== undefined) return ctx[name];
    const w = byVar.get(name);
    if (!w) return "";
    return resolveWildcard(w, ctx, allWildcards);
  };
  return String(text)
    .replace(
      /@\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g,
      (_, n: string) => lookup(n),
    )
    .replace(
      /(^|[^@])@([a-zA-Z_][a-zA-Z0-9_]*)/g,
      (_, lead: string, n: string) => `${lead}${lookup(n)}`,
    );
}

/**
 * Resolve a wildcard module to a concrete sample string. Picks a weighted
 * option, expands inline `{a|b|c}` choices, then resolves `@ref` references.
 * Returns `""` when the module has no options.
 */
export function resolveWildcard(
  mod: ModuleRow,
  ctx: Record<string, string>,
  allWildcards: ModuleRow[],
): string {
  const payload = mod.payload as Partial<WildcardPayload>;
  const options = payload?.options ?? [];
  if (!options.length) return "";
  const picked = pickWeightedOption(options);
  if (!picked) return "";
  const inlined = expandInlineChoices(picked.value || "");
  return expandRefs(inlined, ctx, allWildcards);
}

/* -------------------------------------------------------------------------- */
/* Combine templates                                                           */
/* -------------------------------------------------------------------------- */

/** Fill `$var` and `@{var}` placeholders inside a combine template against
 *  the provided context, falling back to the wildcard catalog. */
export function fillTemplate(
  template: string,
  ctx: Record<string, string>,
  allWildcards: ModuleRow[],
): string {
  if (!template) return "";
  const byVar = new Map<string, ModuleRow>();
  for (const w of allWildcards) {
    if (w.type === "wildcard") byVar.set(wildcardVar(w), w);
  }
  const lookup = (name: string, missing: string): string => {
    if (ctx[name] !== undefined) return ctx[name];
    const w = byVar.get(name);
    if (w) return resolveWildcard(w, ctx, allWildcards);
    return missing;
  };
  return String(template)
    .replace(
      /@\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g,
      (_, n: string) => lookup(n, `@{${n}}`),
    )
    .replace(
      /\$([a-zA-Z_][a-zA-Z0-9_]*)/g,
      (_, n: string) => lookup(n, `$${n}`),
    );
}

/* -------------------------------------------------------------------------- */
/* Constraint                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Apply a constraint matrix to the target wildcard's options, conditioned on
 * a single source value. Returns a new option list with reweighted entries +
 * a `_mode` annotation describing how each row was modulated.
 */
export interface AdjustedOption extends WildcardOption {
  _mode: "allow" | "exclude" | "boost" | "reduce";
}

export function applyConstraint(
  cn: ConstraintPayload,
  sourceValue: string,
  allWildcards: ModuleRow[],
): AdjustedOption[] {
  const target = allWildcards.find((w) => w.id === cn.target_wildcard_id);
  const source = allWildcards.find((w) => w.id === cn.source_wildcard_id);
  if (!target || !source) return [];
  const targetPayload = target.payload as Partial<WildcardPayload>;
  const sourcePayload = source.payload as Partial<WildcardPayload>;
  const targetOptions = targetPayload.options ?? [];
  const sourceOptions = sourcePayload.options ?? [];
  const sSubs = sourcePayload.sub_categories ?? [];
  const tSubs = targetPayload.sub_categories ?? [];
  const sourceOpt = sourceOptions.find((o) => o.value === sourceValue);
  const sSub = sourceOpt?.sub_category ?? "";
  const sCol = sSubs.indexOf(sSub);
  const matrix: ConstraintMatrix = cn.matrix ?? {};

  const lookupCell = (sourceSub: string, targetSub: string): ConstraintCell | null => {
    const row = matrix[sourceSub];
    if (!row) return null;
    return row[targetSub] ?? null;
  };

  return targetOptions.map((opt): AdjustedOption => {
    const tSub = opt.sub_category ?? "";
    const tRow = tSubs.indexOf(tSub);
    let mode: AdjustedOption["_mode"] = "allow";
    let factor = 1;
    if (sCol >= 0 && tRow >= 0 && sSub) {
      const cell = lookupCell(sSub, tSub);
      if (cell) { mode = cell.mode; factor = cell.factor; }
    }
    const ex = (cn.exceptions ?? []).find(
      (e) => e.source === sourceValue && e.target === opt.value,
    );
    if (ex) { mode = ex.mode; factor = ex.factor; }
    let w = Number(opt.weight) || 0;
    if (mode === "exclude") w = 0;
    else if (mode === "reduce") w = w * (factor || 0.25);
    else if (mode === "boost")  w = w * (factor || 3);
    return { ...opt, weight: w, _mode: mode };
  });
}

/* -------------------------------------------------------------------------- */
/* Derivation                                                                  */
/* -------------------------------------------------------------------------- */

export interface DerivationTraceEntry {
  rule: DerivationRule;
  fired: "branch" | "else" | "skip";
  branchIndex: number | null;
  delta: Record<string, string>;
}

function applyAction(
  action: { target_var: string; mode: "replace" | "append" | "prepend"; value: string },
  ctx: Record<string, string>,
): Record<string, string> {
  const target = action.target_var;
  if (!target) return {};
  const value = action.value ?? "";
  const before = ctx[target] ?? "";
  let next: string;
  if (action.mode === "replace") next = value;
  else if (action.mode === "prepend") next = value ? (before ? `${value}, ${before}` : value) : before;
  else next = value ? (before ? `${before}, ${value}` : value) : before; // append
  ctx[target] = next;
  return { [target]: next };
}

function evalCondition(
  cond: { var: string; op: string; value: string },
  ctx: Record<string, string>,
): boolean {
  const lhs = (ctx[cond.var] ?? "").toString().toLowerCase();
  const rhs = (cond.value ?? "").toString().toLowerCase();
  if (cond.op === "equals") return lhs === rhs;
  if (cond.op === "not_equals") return lhs !== rhs;
  if (cond.op === "contains") return lhs.includes(rhs);
  if (cond.op === "matches") {
    try { return new RegExp(cond.value, "i").test(lhs); } catch { return false; }
  }
  return false;
}

export function evalDerivation(
  payload: DerivationPayload,
  ctx: Record<string, string>,
): DerivationTraceEntry[] {
  const trace: DerivationTraceEntry[] = [];
  for (const rule of payload.rules ?? []) {
    let firedBranch = -1;
    let delta: Record<string, string> = {};
    for (let i = 0; i < (rule.branches ?? []).length; i++) {
      const br = rule.branches[i];
      if (evalCondition(br.condition, ctx)) {
        delta = applyAction(br.action, ctx);
        firedBranch = i;
        break;
      }
    }
    if (firedBranch < 0 && rule.else) {
      delta = applyAction(rule.else.action, ctx);
      trace.push({ rule, fired: "else", branchIndex: null, delta });
    } else if (firedBranch >= 0) {
      trace.push({ rule, fired: "branch", branchIndex: firedBranch, delta });
    } else {
      trace.push({ rule, fired: "skip", branchIndex: null, delta: {} });
    }
  }
  return trace;
}

/* -------------------------------------------------------------------------- */
/* Pipeline step runner                                                        */
/* -------------------------------------------------------------------------- */

export interface StepTraceEntry {
  kind: ModuleRow["type"] | "missing";
  name: string;
  note: string;
  delta: Record<string, string>;
}

/** Run a single pipeline step against `ctx` and return the variables it
 *  produced/mutated. The step can reference a module of any kind. */
export function runStep(
  step: PipelineStep,
  allModules: ModuleRow[],
  ctx: Record<string, string>,
): StepTraceEntry {
  const mod = allModules.find((m) => m.id === step.module_id);
  if (!mod) {
    return { kind: "missing", name: "(missing module)", note: "", delta: {} };
  }
  if (step.enabled === false) {
    return { kind: mod.type, name: mod.name, note: "skipped (disabled)", delta: {} };
  }
  const wildcards = allModules.filter((m) => m.type === "wildcard");
  if (mod.type === "wildcard") {
    const v = resolveWildcard(mod, ctx, wildcards);
    const inst = (step.instance ?? {}) as { variable_binding?: string };
    const varName = (inst.variable_binding?.replace(/^\$/, "").trim()) || wildcardVar(mod);
    ctx[varName] = v;
    return {
      kind: "wildcard",
      name: mod.name,
      note: `$${varName} = ${v}`,
      delta: { [varName]: v },
    };
  }
  if (mod.type === "fixed_values") {
    const payload = mod.payload as { values?: { var?: string; name?: string; value?: string }[] };
    const delta: Record<string, string> = {};
    for (const row of payload.values ?? []) {
      const name = (row.var || row.name || "").replace(/^\$/, "");
      if (!name) continue;
      const value = (row.value ?? "").toString();
      ctx[name] = value;
      delta[name] = value;
    }
    return {
      kind: "fixed_values",
      name: mod.name,
      note: Object.keys(delta).map((k) => `$${k}`).join(", ") || "(no bindings)",
      delta,
    };
  }
  if (mod.type === "combine") {
    const payload = mod.payload as Partial<CombinePayload>;
    const out = (payload.output_var ?? "").replace(/^\$/, "") || "output";
    const filled = fillTemplate(payload.template ?? "", ctx, wildcards);
    ctx[out] = filled;
    const trim = filled.length > 60 ? `${filled.slice(0, 60)}…` : filled;
    return {
      kind: "combine",
      name: mod.name,
      note: `$${out} = "${trim}"`,
      delta: { [out]: filled },
    };
  }
  if (mod.type === "constraint") {
    const payload = mod.payload as unknown as ConstraintPayload;
    const target = allModules.find((m) => m.id === payload.target_wildcard_id);
    const source = allModules.find((m) => m.id === payload.source_wildcard_id);
    if (!target || !source) {
      return { kind: "constraint", name: mod.name, note: "missing target/source", delta: {} };
    }
    const sourceVar = wildcardVar(source);
    const targetVar = wildcardVar(target);
    const sv = ctx[sourceVar] ?? resolveWildcard(source, ctx, wildcards);
    if (ctx[sourceVar] === undefined) ctx[sourceVar] = sv;
    const adjusted = applyConstraint(payload, sv, wildcards);
    const picked = pickWeightedOption(adjusted) ?? null;
    const newVal = picked ? expandRefs(expandInlineChoices(picked.value || ""), ctx, wildcards) : "";
    const oldVal = ctx[targetVar] ?? "";
    ctx[targetVar] = newVal;
    return {
      kind: "constraint",
      name: mod.name,
      note: oldVal && oldVal !== newVal
        ? `$${targetVar}: ${oldVal} → ${newVal}`
        : `$${targetVar} = ${newVal}`,
      delta: { [targetVar]: newVal },
    };
  }
  if (mod.type === "derivation") {
    const payload = mod.payload as unknown as DerivationPayload;
    const before = JSON.stringify(ctx);
    const trace = evalDerivation(payload, ctx);
    const fired = trace.filter((t) => t.fired !== "skip").length;
    const delta: Record<string, string> = {};
    for (const t of trace) Object.assign(delta, t.delta);
    return {
      kind: "derivation",
      name: mod.name,
      note: `${fired}/${trace.length} rule(s) fired${before !== JSON.stringify(ctx) ? "" : " (no change)"}`,
      delta,
    };
  }
  return { kind: mod.type, name: mod.name, note: "(unsupported step)", delta: {} };
}

/** Public re-export — the wildcard `$var` name resolver. */
export { wildcardVar };
