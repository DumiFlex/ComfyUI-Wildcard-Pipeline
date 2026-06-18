/**
 * Client-side resolver helpers used by the Test Runner to simulate the
 * engine's behavior in the browser. These are pure functions that operate
 * on the cached module catalog returned by `/wp/api/modules?type=...`.
 *
 * Faithfully ported from the React reference at
 * `docs/design-handoff/wildcard-pipeline/project/screens/utilities.jsx`
 * (`TR_ENGINE`) and `docs/design-handoff/wildcard-pipeline/project/data.jsx`
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
  ConstraintMatrix,
  ConstraintPayload,
  DerivationPayload,
  DerivationRule,
  ModuleRow,
  WildcardOption,
  WildcardPayload,
} from "../api/types";
import { combineConstraintFactor, EXCLUDE } from "./constraint-math";
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

/** Parse the `N::` branch-weight prefix — 1 when absent, 0 when ≤0, 1 on a
 *  non-numeric prefix. Mirrors the engine's `_parse_branch_weight`. */
function parseBranchWeight(branch: string): number {
  const i = branch.indexOf("::");
  if (i < 0) return 1;
  const prefix = branch.slice(0, i);
  if (prefix.trim() === "") return 1;
  const n = Number(prefix);
  if (Number.isNaN(n)) return 1;
  return n <= 0 ? 0 : n;
}

/** Strip a numeric `N::` weight prefix; leave the branch untouched when the
 *  prefix isn't a number (a literal `foo::bar` survives). Mirrors the
 *  engine's `_strip_branch_weight`. */
function stripBranchWeight(branch: string): string {
  const i = branch.indexOf("::");
  if (i < 0) return branch;
  const prefix = branch.slice(0, i);
  if (prefix.trim() === "" || Number.isNaN(Number(prefix))) return branch;
  return branch.slice(i + 2);
}

/**
 * Expand inline `{a|b|c}` choices in a value string. Each occurrence is
 * resolved to one of its `|`-separated branches at random (weighted when a
 * branch carries an `N::` prefix). Nested braces are resolved innermost-first
 * via a fixpoint loop.
 *
 * Important — this function MUST NOT touch `@{...}` refs. The previous
 * implementation delegated to `resolveTokens` which tokenized `@{8hex}`
 * patterns as REF tokens; with the empty modules map passed here those
 * refs got "Unknown ref" warnings and silently collapsed to "" before
 * the downstream `expandRefs` pass had a chance to look them up against
 * the populated catalog. Regex-only inline-choice resolution sidesteps
 * the issue cleanly. The trailing `expandRefs` call in `resolveWildcard`
 * is responsible for ref resolution.
 */
export function expandInlineChoices(text: string): string {
  if (!text) return text;
  let out = String(text);
  // Repeatedly resolve innermost `{a|b|c}` braces — `[^{}]` rules out
  // nested braces, the `\|` in the alternation rules out single-branch
  // `{abc}` (which has no `|` to split on, intentionally preserved).
  // Loop until no replacement happens to handle nested choices.
  for (let iter = 0; iter < 16; iter++) {
    const next = out.replace(
      /\{([^{}]*\|[^{}]*)\}/g,
      (_, content: string) => {
        const raw = content.split("|");
        const values = raw.map(stripBranchWeight);
        const hasWeights = values.some((v, i) => v !== raw[i]);
        if (!hasWeights) {
          return values[Math.floor(Math.random() * values.length)];
        }
        const weights = raw.map(parseBranchWeight);
        const total = weights.reduce((a, w) => a + Math.max(0, w), 0);
        if (total <= 0) return values[0];
        let r = Math.random() * total;
        for (let i = 0; i < values.length; i++) {
          r -= Math.max(0, weights[i]);
          if (r <= 0) return values[i];
        }
        return values[values.length - 1];
      },
    );
    if (next === out) break;
    out = next;
  }
  return out;
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
 * Resolve `@var` / `@{var_binding}` / `@{8hex_uuid}` references in `text`.
 *
 * Lookup order:
 *   1. ctx[name]                — caller-provided variable bindings win
 *   2. byVar[name]              — wildcard matched by `var_binding` (legacy)
 *   3. byId[name]               — wildcard matched by uuid (canonical
 *                                 `@{8hex}` form, spec §2.4); the load-bearing
 *                                 path that previously failed silently when
 *                                 the in-graph WP_Context started embedding
 *                                 uuid-based refs in option values.
 *
 * Regex first-char widened from `[a-zA-Z_]` to `[a-zA-Z0-9_]` so digit-leading
 * uuids (e.g. `@{12345678}`) match. Hex uuids that start with a-f always
 * matched the old regex; the widening only adds the digit-leading slice that
 * was previously dropped silently.
 */
export function expandRefs(
  text: string,
  ctx: Record<string, string>,
  allWildcards: ModuleRow[],
): string {
  if (!text) return text;
  const byVar = new Map<string, ModuleRow>();
  const byId = new Map<string, ModuleRow>();
  for (const w of allWildcards) {
    if (w.type !== "wildcard") continue;
    byVar.set(wildcardVar(w), w);
    byId.set(w.id, w);
  }
  const lookup = (name: string): string => {
    if (ctx[name] !== undefined) return ctx[name];
    const w = byVar.get(name) ?? byId.get(name);
    if (!w) return "";
    return resolveWildcard(w, ctx, allWildcards);
  };
  return String(text)
    .replace(
      /@\{([a-zA-Z0-9_][a-zA-Z0-9_]*)\}/g,
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

/** Fill `$var` and `@{var_binding}` / `@{8hex_uuid}` placeholders inside a
 *  combine template against the provided context, falling back to the
 *  wildcard catalog. Mirrors `expandRefs`'s dual byVar/byId lookup so
 *  uuid-based refs work alongside legacy var-binding refs. Missing
 *  references stay literal so the user sees what didn't resolve. */
export function fillTemplate(
  template: string,
  ctx: Record<string, string>,
  allWildcards: ModuleRow[],
): string {
  if (!template) return "";
  const byVar = new Map<string, ModuleRow>();
  const byId = new Map<string, ModuleRow>();
  for (const w of allWildcards) {
    if (w.type !== "wildcard") continue;
    byVar.set(wildcardVar(w), w);
    byId.set(w.id, w);
  }
  const lookup = (name: string, missing: string): string => {
    if (ctx[name] !== undefined) return ctx[name];
    const w = byVar.get(name) ?? byId.get(name);
    if (w) return resolveWildcard(w, ctx, allWildcards);
    return missing;
  };
  return String(template)
    .replace(
      /@\{([a-zA-Z0-9_][a-zA-Z0-9_]*)\}/g,
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
 * SP3 constraint preview parity.
 *
 * The engine re-weights an option pool through
 * `combine_constraint_factor` (one multiply per matching matrix cell —
 * per source pick × per target-option tag — with `exclude` absorbing and
 * the exception pair overriding the matrix). A REACH SELECTOR
 * (`target_select`) then decides which downstream target ENCOUNTERS a
 * constraint covers. This module mirrors both halves so the SPA preview
 * matches the runtime:
 *
 *   - `applyConstraint` — the single-source-value table the Test Runner
 *     renders (`runConstraintMatrix`). Weight math now flows through the
 *     shared `combineConstraintFactor` mirror (multi-tag aware), replacing
 *     the SP1 primary-tag-only matrix lookup. Single-tag / single-pick
 *     cells collapse to the same numbers as before.
 *   - `applyReachConstraints` — the reach-aware core mirroring engine
 *     `apply_constraints_for_target`: invoked once per downstream target
 *     encounter, threading a per-constraint hit counter, applying EVERY
 *     covering constraint combined (multiply; exclude wins).
 */
export interface AdjustedOption extends WildcardOption {
  _mode: "allow" | "exclude" | "boost" | "reduce";
}

/** Per-pick `{value, tags}` the combine fn reads (mirror of the engine's
 *  `source_pick["picks"]` entries). */
export interface SourcePickEntry {
  value: string;
  tags: string[];
}

/** A source wildcard's recorded pick, as the preview threads it. Mirrors
 *  engine `ctx["__wp_picks__"][source_id]`: a top-level `value` +
 *  `sub_categories`, plus the SP3 per-pick `picks` list. When `picks` is
 *  absent the applier falls back to a single synthetic pick built from
 *  `value` + `sub_categories` — exactly the legacy fallback in
 *  `_apply_constraint_to_options`. */
export interface SourcePick {
  value: string;
  sub_categories?: string[];
  picks?: SourcePickEntry[];
}

/** Reach selector. `mode` defaults to `all` when the whole object is
 *  omitted. `count` applies to `next`; `picks` to `pick`. Mirrors engine
 *  `target_select`. */
export interface ReachPickOccurrence {
  kind: "direct" | "nested";
  uid?: string;
  carrier_uid?: string;
  option_id?: string;
}
export interface ReachSelector {
  mode: "all" | "first" | "next" | "pick";
  count?: number;
  picks?: ReachPickOccurrence[];
}

/** A constraint as the reach applier consumes it — the payload fields it
 *  needs plus an `id` (the engine's `__constraint_module_id__`, used to
 *  key the hit counter) and the optional `target_select`. */
export interface PreviewConstraint {
  id: string;
  source_wildcard_id: string | null;
  target_wildcard_id: string | null;
  matrix: ConstraintMatrix;
  exceptions: ConstraintPayload["exceptions"];
  target_select?: ReachSelector;
}

/** Build the per-pick list the combine fn reads, mirroring engine
 *  `_apply_constraint_to_options`: use the recorded `picks` when present,
 *  else fall back to a single synthetic pick from `value` +
 *  `sub_categories`. */
function buildSourcePicks(pick: SourcePick): SourcePickEntry[] {
  if (Array.isArray(pick.picks)) {
    return pick.picks.map((p) => ({
      value: String(p.value ?? ""),
      tags: Array.isArray(p.tags) ? p.tags : [],
    }));
  }
  return [{
    value: String(pick.value ?? ""),
    tags: Array.isArray(pick.sub_categories) ? pick.sub_categories : [],
  }];
}

/** Collapse a combine factor to the table's `_mode` annotation. The
 *  engine's matrix carries a discrete mode per cell, but after multi-cell
 *  multiplication only the net effect is meaningful for the preview table:
 *  EXCLUDE → "exclude", >1 → "boost", <1 → "reduce", ==1 → "allow". */
function factorToMode(
  f: number | typeof EXCLUDE,
): AdjustedOption["_mode"] {
  if (f === EXCLUDE) return "exclude";
  if (f > 1) return "boost";
  if (f < 1) return "reduce";
  return "allow";
}

/** Apply ONE constraint's matrix+exceptions to an option pool via the
 *  shared combine mirror. EXCLUDE → weight 0, else `max(0, weight × f)`.
 *  Mirrors engine `_apply_constraint_to_options`. */
function applyConstraintFactor(
  options: WildcardOption[],
  matrix: ConstraintMatrix,
  exceptions: ConstraintPayload["exceptions"],
  picks: SourcePickEntry[],
): AdjustedOption[] {
  // The combine fn types `matrix`/`exceptions` against its own structural
  // `Rule` shape; ConstraintCell/ConstraintException are compatible
  // supersets (mode + factor [+ source/target]). Cast at the boundary.
  const m = matrix as unknown as Record<string, Record<string, { mode?: string; factor?: number }>>;
  const exc = (exceptions ?? []) as unknown as Array<Record<string, unknown>>;
  return options.map((opt): AdjustedOption => {
    const f = combineConstraintFactor(
      picks,
      { value: String(opt.value ?? ""), tags: opt.sub_categories ?? [] },
      m,
      exc,
    );
    const w = Number(opt.weight) || 0;
    const weight = f === EXCLUDE ? 0 : Math.max(0, w * Number(f));
    return { ...opt, weight, _mode: factorToMode(f) };
  });
}

/**
 * Apply a constraint matrix to the target wildcard's options, conditioned on
 * a single source value. Returns a new option list with reweighted entries +
 * a `_mode` annotation describing how each row was modulated. Used by the
 * Test Runner's deterministic per-source-value table (`runConstraintMatrix`).
 *
 * Weight math flows through the shared `combineConstraintFactor` mirror so
 * the table reflects true multi-tag multiplication (an option on N source-tag
 * rows multiplies N times) and exception-pair override, exactly as the engine
 * resolves it. The source pick is synthesised from the matched source option
 * (`value` + its `sub_categories`) — the table conditions on one source value
 * at a time, so a single synthetic pick is the right shape.
 */
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
  const sourceOpt = (sourcePayload.options ?? []).find(
    (o) => o.value === sourceValue,
  );
  // Synthetic single pick for this source value — all of the matched
  // option's tags participate (multi-tag), mirroring the engine fallback
  // shape `[{value, tags: sub_categories}]`.
  const picks: SourcePickEntry[] = [{
    value: sourceValue,
    tags: sourceOpt?.sub_categories ?? [],
  }];
  return applyConstraintFactor(
    targetOptions, cn.matrix ?? {}, cn.exceptions ?? [], picks,
  );
}

/**
 * Reach-aware constraint applier — the preview mirror of engine
 * `apply_constraints_for_target`. Call ONCE per downstream target
 * ENCOUNTER (in chain order), threading `hits` across calls.
 *
 * For each constraint targeting `targetId` whose source has been picked:
 *   - increment the per-constraint hit counter `hits[id]`;
 *   - test coverage against `target_select` (default `all`):
 *       all   → every encounter;
 *       first → n === 1;
 *       next  → n <= count;
 *       pick  → the firing occurrence is listed.
 *   - if covered, fold its matrix+exceptions into the pool (multiply;
 *     `exclude` absorbing).
 * Every covering constraint stacks in registration order.
 *
 * `picks` maps a source wildcard id → its recorded pick (see `SourcePick`).
 * A constraint whose source is absent is skipped (mirrors the engine's
 * `unknown_constraint_source` no-op — the preview just omits the warning).
 *
 * Reach for `pick`: a `{kind:"direct", uid}` occurrence matches `firingUid`.
 * The SPA preview does NOT model nested `@{}` carrier occurrences with
 * per-carrier identity (it has no multi-instance chain walker — the Test
 * Runner renders a single deterministic table), so `{kind:"nested", ...}`
 * picks are treated as best-effort and never match here. The runtime engine
 * is authoritative for nested-pick reach; this preview is advisory.
 */
export function applyReachConstraints(
  options: WildcardOption[],
  constraints: PreviewConstraint[],
  targetId: string,
  picks: Record<string, SourcePick>,
  hits: Record<string, number>,
  opts: { firingUid?: string } = {},
): AdjustedOption[] {
  // Seed `_mode: "allow"` so an uncovered pool still returns the annotated
  // shape the table consumes; each covering constraint overwrites it.
  let out: AdjustedOption[] = options.map((o) => ({ ...o, _mode: "allow" }));
  for (const c of constraints ?? []) {
    if (!c || c.target_wildcard_id !== targetId) continue;
    const srcId = c.source_wildcard_id;
    const srcPick = typeof srcId === "string" ? picks[srcId] : undefined;
    if (!srcPick) continue; // source not yet picked → skip (engine no-op)
    hits[c.id] = (hits[c.id] ?? 0) + 1;
    const n = hits[c.id];
    const sel: ReachSelector = c.target_select ?? { mode: "all" };
    let covered: boolean;
    if (sel.mode === "first") {
      covered = n === 1;
    } else if (sel.mode === "next") {
      const cnt = Number.isFinite(Number(sel.count)) ? Number(sel.count) : 1;
      covered = n <= cnt;
    } else if (sel.mode === "pick") {
      covered = (sel.picks ?? []).some(
        (p) => p.kind === "direct" && p.uid === opts.firingUid,
      );
    } else {
      covered = true; // all (and any unknown mode) covers every encounter
    }
    if (!covered) continue;
    out = applyConstraintFactor(
      out, c.matrix ?? {}, c.exceptions ?? [], buildSourcePicks(srcPick),
    );
  }
  return out;
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
  // Presence ops form a three-tier semantic:
  //   exists      — key in ctx (any value, including empty)
  //   is_empty    — key in ctx AND value === "" (null wildcard option)
  //   is_set / is_not_empty
  //               — key in ctx AND value !== ""
  // not_exists / is_unset are the negation tier (key absent).
  // The UI's segmented switch under `exists` composes the right op
  // from a (base, refinement) pair; the engine just evaluates whatever
  // op got saved.
  if (cond.op === "exists")       return cond.var in ctx;
  if (cond.op === "not_exists")   return !(cond.var in ctx);
  if (cond.op === "is_empty")     return (cond.var in ctx) && (ctx[cond.var] ?? "") === "";
  if (cond.op === "is_set" || cond.op === "is_not_empty") {
    return (cond.var in ctx) && (ctx[cond.var] ?? "") !== "";
  }
  if (cond.op === "is_unset")     return !(cond.var in ctx) || (ctx[cond.var] ?? "") === "";
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
/* Bundle child runner                                                         */
/* -------------------------------------------------------------------------- */

/** Bundle child snapshot — same fields a top-level module carries
 *  (id, type, payload, instance), passed through here as a loosely-typed
 *  dict because `BundleRow.children` is stored as `Record<string, unknown>[]`
 *  and we don't have a static guarantee on shape beyond `id` + `type`.
 *
 *  Name lives under `meta.name` in the saved snapshot (see
 *  BundleEditor.vue's `snapshot()` helper) — not on the top-level row
 *  the way ModuleRow surfaces it. Snapshots also stash `meta.library_name`
 *  as a frozen rename-safe label. */
export interface BundleChildLike {
  id: string;
  type: string;
  meta?: { name?: string; library_name?: string };
  payload?: Record<string, unknown>;
  instance?: Record<string, unknown>;
}

/** Trace entry produced by `runBundleChild`. Mirrors the per-step
 *  shape the TestRunner pipeline panel used to render. */
export interface BundleChildTrace {
  kind: string;
  name: string;
  note: string;
  delta: Record<string, string>;
}

/** Resolve a single bundle child against `ctx` and return what it
 *  produced. Mirrors per-kind handling in the canvas-side bundle
 *  insert flow but only does preview-grade simulation (option [0] vs.
 *  weighted-random for wildcards is controlled by the caller via
 *  `Math.random` mocking, same trick as the wildcard histogram).
 *
 *  `instance.variable_binding` (when set) overrides the wildcard's
 *  library-default `$var` so users see the same binding the bundle
 *  produces on canvas. Other instance overrides (locked_seed,
 *  enabled_options, etc.) are NOT honored here — preview-grade. */
export function runBundleChild(
  child: BundleChildLike,
  allWildcards: ModuleRow[],
  ctx: Record<string, string>,
): BundleChildTrace {
  const name = child.meta?.name ?? child.meta?.library_name ?? "(unnamed)";
  const payload = (child.payload ?? {}) as Record<string, unknown>;
  const instance = (child.instance ?? {}) as Record<string, unknown>;

  if (child.type === "wildcard") {
    const fakeRow = { ...child, payload, type: "wildcard" } as unknown as ModuleRow;
    const value = resolveWildcard(fakeRow, ctx, allWildcards);
    const bindingOverride = typeof instance.variable_binding === "string"
      ? instance.variable_binding.replace(/^\$/, "").trim()
      : "";
    const varName = bindingOverride || wildcardVar(fakeRow);
    ctx[varName] = value;
    return {
      kind: "wildcard",
      name,
      note: `$${varName} = ${value}`,
      delta: { [varName]: value },
    };
  }

  if (child.type === "fixed_values") {
    const values = (payload.values as { var?: string; name?: string; value?: string }[]) ?? [];
    const delta: Record<string, string> = {};
    for (const row of values) {
      const key = (row.var || row.name || "").replace(/^\$/, "");
      if (!key) continue;
      const value = (row.value ?? "").toString();
      ctx[key] = value;
      delta[key] = value;
    }
    return {
      kind: "fixed_values",
      name,
      note: Object.keys(delta).map((k) => `$${k}`).join(", ") || "(no bindings)",
      delta,
    };
  }

  if (child.type === "combine") {
    const cp = payload as Partial<CombinePayload>;
    const out = (cp.output_var ?? "").replace(/^\$/, "") || "output";
    // Two-phase resolve: substitute `$var` / `@{ref}` first via
    // fillTemplate, THEN run the result through `expandInlineChoices`
    // so any `{a|b|c}` literals (whether from the template itself or
    // dropped in by an upstream wildcard value) get picked. Skipping
    // the second pass left brace-blocks unresolved in the trace.
    const substituted = fillTemplate(cp.template ?? "", ctx, allWildcards);
    const filled = expandInlineChoices(substituted);
    ctx[out] = filled;
    return {
      kind: "combine",
      name,
      note: `$${out} = "${filled}"`,
      delta: { [out]: filled },
    };
  }

  if (child.type === "constraint") {
    // Engine-side constraint is config-only: it appends meta to
    // `ctx["__wp_constraints__"]` and returns `{}` (see
    // `engine/modules/constraint_handler.py:_ctx_set_constraint`).
    // The downstream wildcard reads the bias bucket when picking. So
    // the trace entry should describe the bias, not assign a value —
    // an earlier draft mistakenly picked + wrote $target which produced
    // a spurious "$mood = serene" line that got overwritten by the
    // wildcard step that followed.
    const cp = payload as unknown as ConstraintPayload;
    const target = allWildcards.find((m) => m.id === cp.target_wildcard_id);
    const source = allWildcards.find((m) => m.id === cp.source_wildcard_id);
    if (!target || !source) {
      return { kind: "constraint", name, note: "missing target/source", delta: {} };
    }
    return {
      kind: "constraint",
      name,
      note: `biases $${wildcardVar(target)} from $${wildcardVar(source)}`,
      delta: {},
    };
  }

  if (child.type === "derivation") {
    const dp = payload as unknown as DerivationPayload;
    const before = JSON.stringify(ctx);
    const trace = evalDerivation(dp, ctx);
    const fired = trace.filter((t) => t.fired !== "skip").length;
    const delta: Record<string, string> = {};
    for (const t of trace) Object.assign(delta, t.delta);
    return {
      kind: "derivation",
      name,
      note: `${fired}/${trace.length} rule(s) fired${before !== JSON.stringify(ctx) ? "" : " (no change)"}`,
      delta,
    };
  }

  return { kind: child.type, name, note: "(unsupported kind)", delta: {} };
}

/** Public re-export — the wildcard `$var` name resolver. */
export { wildcardVar };
