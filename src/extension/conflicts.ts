import {
  buildBundleEnabledMap,
  isModuleEffectivelyEnabled,
  type ContextWidgetValue,
  type InjectorRowsValue,
  type ModuleEntry,
} from "../widgets/_shared";

/** Resolve a module's effective var-binding name. Mirrors engine
 *  precedence: per-instance override (`instance.variable_binding`)
 *  wins when set to a non-empty string, otherwise fall back to the
 *  library default — `payload.var_binding` for wildcard,
 *  `payload.output_var` for combine. Empty string and null both mean
 *  "use library default" per the `_shared.ts` instance-shape contract.
 *  Returns "" for kinds that don't produce a single binding. Single
 *  source of truth so any surface that needs the effective binding
 *  stays in lockstep with the override layer. */
function bindingNameOf(m: ModuleEntry): string {
  if (m.type === "wildcard") {
    const overrideName = m.instance?.variable_binding;
    if (typeof overrideName === "string" && overrideName.length > 0) return overrideName;
    const payloadName = (m.payload as { var_binding?: string } | undefined)?.var_binding;
    return typeof payloadName === "string" ? payloadName : "";
  }
  if (m.type === "combine") {
    const overrideName = m.instance?.variable_binding;
    if (typeof overrideName === "string" && overrideName.length > 0) return overrideName;
    const payloadName = (m.payload as { output_var?: string } | undefined)?.output_var;
    return typeof payloadName === "string" ? payloadName : "";
  }
  return "";
}

/** Same kind-aware writes-extraction `extension/graph.ts:moduleWrites` uses.
 *  Inlined here to keep the conflicts module dependency-light. */
function writesOf(m: ModuleEntry): string[] {
  const out: string[] = [];
  if (m.type === "fixed_values") {
    // Two-tier read mirroring `engine/modules/fixed_values_handler.py`:
    // overrides (`instance.values_overrides`) win when present; else
    // the union of `entries` (UI source) + `payload.values` (engine
    // source). Dedup via Set so a single module's UI/engine mirrors
    // don't trip the `duplicate_variable` rule against themselves —
    // multi-module dup detection still works via the outer `written`
    // set.
    const seen = new Set<string>();
    const inst = (m.instance ?? {}) as { values_overrides?: Array<{ name?: string }> };
    const overrides = Array.isArray(inst.values_overrides) ? inst.values_overrides : null;
    if (overrides && overrides.length > 0) {
      for (const v of overrides) {
        const name = (v.name ?? "").replace(/^\$/, "").trim();
        if (name) seen.add(name);
      }
      out.push(...seen);
      return out;
    }
    for (const e of m.entries) {
      const name = e.variable_name.replace(/^\$/, "").trim();
      if (name) seen.add(name);
    }
    const values = (m.payload as { values?: Array<{ name?: string }> } | undefined)?.values ?? [];
    for (const v of values) {
      const name = (v.name ?? "").replace(/^\$/, "").trim();
      if (name) seen.add(name);
    }
    out.push(...seen);
    return out;
  }
  const p = (m.payload ?? {}) as Record<string, unknown>;
  if (m.type === "wildcard") {
    // Honour `instance.variable_binding` override before falling back
    // to `payload.var_binding` — same precedence as the engine. A
    // direct `payload.var_binding` read would miss user-renamed
    // wildcards and skip duplicate / shadow detection on the
    // EFFECTIVE binding the runtime will write.
    const b = bindingNameOf(m).replace(/^\$/, "").trim();
    if (b) out.push(b);
  } else if (m.type === "combine") {
    // Honor `instance.variable_binding` override before
    // `payload.output_var` — engine reads override first
    // (combine_handler.py:60-65 via shared bindingNameOf precedence).
    const o = bindingNameOf(m).replace(/^\$/, "").trim();
    if (o) out.push(o);
  } else if (m.type === "derivation") {
    // Dedup within a single derivation module: a rule that targets the
    // same `target_var` from both an IF branch and the ELSE clause is
    // a single write at runtime (only one path fires per evaluation),
    // not a duplicate. Multi-rule writes of the same name across the
    // same module also collapse here — at runtime they're sequential
    // mutations on one var, not "two modules fighting." Multi-MODULE
    // dup detection still works via the outer `written` set.
    const seen = new Set<string>();
    const rules = (p.rules ?? []) as Array<{
      branches?: Array<{ action?: { target_var?: string } }>;
      else?: { action?: { target_var?: string } };
    }>;
    for (const rule of rules) {
      for (const br of rule.branches ?? []) {
        const t = (br.action?.target_var ?? "").replace(/^\$/, "").trim();
        if (t) seen.add(t);
      }
      const e = (rule.else?.action?.target_var ?? "").replace(/^\$/, "").trim();
      if (e) seen.add(e);
    }
    out.push(...seen);
  }
  return out;
}

// `shadows_upstream` — informational: this module overrides a value that
//   already exists upstream. Last-write-wins is the *intended* runtime
//   behavior, so this is a low-key hint, not an error.
// `duplicate_variable` — warning: two enabled modules in the SAME node both
//   write the same name. Almost always a bug in this node's local config.
// `missing_template_variable` — warning: assembler template references a
//   variable nothing upstream provides; it'll render literally as `$name`.
// `constraint_source_after_self` — warning: constraint's source wildcard
//   sits AT or AFTER the constraint in the same node. Source must pick
//   first so the constraint has a value to key on; out-of-order = no-op.
// `constraint_source_missing` — warning: constraint's source uuid isn't
//   in the same node, the upstream chain, or any reachable Context.
//   Either a typo / deleted source, or the source lives downstream
//   (which still wouldn't run before this constraint). Both = no-op.
// `constraint_target_before_self` — warning: target wildcard sits AT
//   or BEFORE the constraint. Target picks before the constraint is
//   loaded into ctx, so the matrix never applies. Reorder needed.
// `constraint_target_in_upstream` — warning: target lives in an upstream
//   Context that already ran. Same problem as before_self: target
//   picked before constraint registered. The reference might also
//   be a typo of source vs target.
// `constraint_target_missing` — warning: target uuid not findable in this
//   node, the upstream chain, OR the downstream chain. Real typo /
//   deleted module / constraint pointing at a uuid that doesn't exist.
// `constraint_source_in_downstream` — warning: source wildcard lives in
//   a downstream Context that runs AFTER this constraint's Context.
//   Source's pick won't be in `__wp_picks__` when the wildcard handler
//   reads constraints. Same runtime no-op as source_after_self, but
//   surfacing the cross-node placement gives the user a more
//   actionable signal than the catch-all "missing".
export type ConflictType =
  | "shadows_upstream"
  | "duplicate_variable"
  | "missing_template_variable"
  // Constraint rules (2026-05-24 first-instance redesign). Legacy rules
  // `constraint_source_after_self`, `constraint_source_in_downstream`,
  // `constraint_target_before_self`, `constraint_target_in_upstream`
  // collapse into the two `orphan_*` types below. `_missing` rules stay
  // for the "uuid not in any catalog" case which is independent of
  // position.
  | "constraint_source_missing"
  | "constraint_target_missing"
  | "constraint_orphan_source"   // no source instance upstream
  | "constraint_orphan_target"   // no available target instance downstream
                                  // (count-aware: N constraints targeting
                                  //  the same wildcard need N downstream
                                  //  instances; later ones get this rule)
  | "injector_binding_missing";
export type Severity = "info" | "warning" | "error";
export interface Conflict {
  moduleId: string;
  variable: string;
  type: ConflictType;
  severity: Severity;
}

/** Canonical label per ConflictType. Use this everywhere conflict text
 *  surfaces in TOOLTIP form (card tooltip, subgraph badge, future log
 *  viewers) so the wording stays in sync across surfaces — drift
 *  between "overrides upstream" / "shadows" / "shadow" is a real
 *  reported UX bug. Always paired with `$${variable}` by the caller.
 *
 *  For the short chip label rendered inside row badges, use
 *  `shortConflictLabel` instead — keeps both row surfaces (module +
 *  injector) writing the same compact wording. */
export function labelFor(type: ConflictType): string {
  if (type === "shadows_upstream") return "overrides upstream";
  if (type === "duplicate_variable") return "duplicate";
  if (type === "missing_template_variable") return "missing";
  if (type === "constraint_source_missing") return "source missing";
  if (type === "constraint_target_missing") return "target missing";
  if (type === "constraint_orphan_source") return "source missing — no upstream instance";
  if (type === "constraint_orphan_target") return "target missing — no available instance downstream";
  if (type === "injector_binding_missing") return "no binding";
  return type;
}

/** Compact label for the in-row conflict chip. Mirrors the wording
 *  ModuleRow uses so injector rows and module rows surface identical
 *  badges for the same conflict type — chip width budget is tight,
 *  full sentences live in the tooltip via `labelFor`. */
export function shortConflictLabel(type: ConflictType): string {
  switch (type) {
    case "shadows_upstream":            return "override";
    case "duplicate_variable":          return "duplicate";
    case "missing_template_variable":   return "missing var";
    case "constraint_source_missing":   return "src missing";
    case "constraint_target_missing":   return "tgt missing";
    case "constraint_orphan_source":    return "no src upstream";
    case "constraint_orphan_target":    return "no tgt downstream";
    case "injector_binding_missing":    return "no binding";
    default:                            return "conflict";
  }
}

/** Scan an injector node's rows for missing connections + duplicate
 *  bindings + shadows-upstream. Mirrors `scanConflicts` semantics
 *  but operates on the injector's flatter shape. `connectedSlots`
 *  is the set of input slot names with a live wire. `upstreamVars`
 *  is the set of `$var` names produced by anything upstream of THIS
 *  injector — used to flag bindings that overwrite an upstream
 *  Context module's output (`shadows_upstream`, info-level). */
export function scanInjectorConflicts(
  value: InjectorRowsValue,
  _connectedSlots: string[],
  upstreamVars: string[] = [],
): Conflict[] {
  const upstream = new Set(upstreamVars);
  const written = new Set<string>();
  const out: Conflict[] = [];

  for (const row of value.rows) {
    if (!row.enabled) continue;
    const binding = row.binding.trim();
    if (!binding) {
      // Distinct from injector_input_disconnected (severed socket) —
      // here the socket IS linked but the user hasn't typed a binding
      // name yet. Badge reads "no binding", not "no link".
      out.push({
        moduleId: row._uid,
        variable: row.slot_name,
        type: "injector_binding_missing",
        severity: "warning",
      });
      continue;
    }
    // Severed-socket case is unreachable in practice — the
    // InjectorWidget watcher auto-removes rows whose slot is no
    // longer in connectedSlots, so a row with row.slot_name not in
    // `connected` can't exist at this point. Path retired.
    if (written.has(binding)) {
      out.push({
        moduleId: row._uid,
        variable: binding,
        type: "duplicate_variable",
        severity: "warning",
      });
    } else {
      written.add(binding);
      if (upstream.has(binding)) {
        // Injector binding shadows an upstream Context module's
        // output — info-level since last-write-wins is the
        // intentional semantic, but the user should see the layering.
        out.push({
          moduleId: row._uid,
          variable: binding,
          type: "shadows_upstream",
          severity: "info",
        });
      }
    }
  }
  return out;
}

/** Token regex matching `$ident` references but NOT `$$` literal escapes.
 *  Hoisted to the top of the module so both scanners see it without
 *  forward-reference TDZ concerns. */
const TEMPLATE_VAR = /(?<!\$)\$([A-Za-z_][A-Za-z0-9_]*)/g;

/** Pull every `$ident` reference out of a string. Skips `$$` escapes. */
function templateVarsIn(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(TEMPLATE_VAR)) out.push(m[1]);
  return out;
}

/** Extract the templates a module's runtime resolver will consume against
 *  the ctx (`$var` lookups). Surfaces:
 *    - combine: `payload.template`
 *    - derivation: every branch + else `action.value` — they pass through
 *      `resolve_text` under surface="derivation" at runtime, so `$var`
 *      tokens inside MUST resolve. Same gap as combine; same warning.
 *  Wildcard option values resolve nested refs but treat `$var` as plain
 *  text. Constraints don't surface user-defined `$var` refs at all
 *  (they reference wildcards by uuid, scanned separately downstream).
 *  Extend the union here if a future kind grows a template-style field. */
function templatesOf(m: ModuleEntry): string[] {
  if (m.type === "combine") {
    // v2 modal writes `instance.template_override` — honor that first
    // so the conflict scanner reflects the user's edits immediately.
    // Empty string / null collapses back to the library template.
    const inst = (m.instance ?? {}) as { template_override?: string | null };
    const override = inst.template_override;
    if (typeof override === "string" && override !== "") return [override];
    const tpl = (m.payload as { template?: string } | undefined)?.template;
    return typeof tpl === "string" ? [tpl] : [];
  }
  if (m.type === "derivation") {
    const out: string[] = [];
    const rules = ((m.payload as { rules?: unknown[] } | undefined)?.rules ?? []) as Array<{
      branches?: Array<{ action?: { value?: unknown } }>;
      else?: { action?: { value?: unknown } };
    }>;
    for (const rule of rules) {
      for (const br of rule.branches ?? []) {
        const v = br.action?.value;
        if (typeof v === "string" && v) out.push(v);
      }
      const ev = rule.else?.action?.value;
      if (typeof ev === "string" && ev) out.push(ev);
    }
    return out;
  }
  return [];
}

/** Extract bare variable-name reads — names looked up directly against
 *  ctx, not via `$var` template tokens. Currently only derivations:
 *  each branch's `condition.var` is read raw (no `$` prefix) before
 *  the runtime compares it to `condition.value`. Static visibility
 *  matters here for the same reason as combine: an unbound condition
 *  read evaluates to "" and silently mis-matches. */
function varReadsOf(m: ModuleEntry): string[] {
  if (m.type !== "derivation") return [];
  const out: string[] = [];
  const rules = ((m.payload as { rules?: unknown[] } | undefined)?.rules ?? []) as Array<{
    branches?: Array<{ condition?: { var?: unknown } }>;
  }>;
  for (const rule of rules) {
    for (const br of rule.branches ?? []) {
      const v = br.condition?.var;
      if (typeof v === "string") {
        const name = v.replace(/^\$/, "").trim();
        if (name) out.push(name);
      }
    }
  }
  return out;
}

/** Regex for `@{uuid[:subcat,subcat]}` ref tokens inside string values.
 *  Captures the uuid (group 1); the optional sub-category filter is
 *  matched but not captured because the scanner only cares about
 *  reachability, not the filter contents. Kept in sync with
 *  `engine/syntax/tokenize.py:_REF_RE` so the scanner's reach-set
 *  walker recognises every form the engine resolver accepts. */
const REF_TOKEN_RE = /@\{([0-9a-f]{8})(?:#[^#:}@{]*)?(?::[^}]*)?\}/g;

/** Extract every nested `@{uuid}` ref a wildcard module would walk at
 *  runtime — currently only the option `value` strings. Used by the
 *  reach-set walker so the scanner knows constraint targets reached
 *  via nested refs from later-in-chain wildcards are NOT missing. */
function nestedRefsOf(m: ModuleEntry): string[] {
  if (m.type !== "wildcard") return [];
  const payload = (m.payload ?? {}) as { options?: Array<{ value?: unknown }> };
  const out: string[] = [];
  for (const opt of payload.options ?? []) {
    const v = opt.value;
    if (typeof v !== "string") continue;
    for (const match of v.matchAll(REF_TOKEN_RE)) out.push(match[1]);
  }
  return out;
}

/** Walk the local catalog from a starting set of uuids, expanding via
 *  every `@{uuid}` ref found inside each visited wildcard's option
 *  values. Bounded by `MAX_REACH_DEPTH` (matches the engine resolver's
 *  `max_ref_depth` default). Returns the full set of uuids reachable,
 *  including the starting seeds. */
const MAX_REACH_DEPTH = 8;
function walkLocalReach(
  seeds: Iterable<string>,
  catalog: Map<string, ModuleEntry>,
): Set<string> {
  const reach = new Set<string>();
  let frontier: string[] = [];
  for (const u of seeds) {
    if (!reach.has(u)) { reach.add(u); frontier.push(u); }
  }
  for (let depth = 0; depth < MAX_REACH_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const u of frontier) {
      const m = catalog.get(u);
      if (!m) continue;
      for (const r of nestedRefsOf(m)) {
        if (!reach.has(r)) { reach.add(r); next.push(r); }
      }
    }
    frontier = next;
  }
  return reach;
}

export function scanConflicts(
  value: ContextWidgetValue,
  upstreamVars: string[],
  upstreamWildcardUuids: string[] = [],
  downstreamWildcardUuids: string[] = [],
  downstreamNestedReachUuids: string[] = [],
): Conflict[] {
  const upstream = new Set(upstreamVars);
  const upstreamUuids = new Set(upstreamWildcardUuids);
  // Per-uuid downstream instance count — distinct from a Set because
  // the count-aware `constraint_orphan_target` check needs to know how
  // many downstream slots a uuid offers. Two duplicated constraints
  // targeting the same wildcard need two downstream instances; a Set
  // would collapse to 1 and falsely orphan the second constraint.
  const downstreamCounts = new Map<string, number>();
  for (const u of downstreamWildcardUuids) {
    downstreamCounts.set(u, (downstreamCounts.get(u) ?? 0) + 1);
  }
  // Set (not counted) — via-nested route is non-consuming. Pair badge
  // logic lets ↪×N multiple constraints route through the same downstream
  // carrier, so the scanner mirrors that by treating cross-node nested
  // reach as a slot that can satisfy any number of constraints. Used
  // alongside `inLocalNestedAfter` to suppress the orphan warning when
  // the pair badge would have found a downstream `@{uuid}` carrier.
  const downstreamNestedReach = new Set(downstreamNestedReachUuids);
  // Same-node wildcard index lookup. Used by the constraint ordering
  // checks: a constraint references its source/target by uuid, and we
  // need to know whether each uuid lives in this node (and at what
  // position) versus upstream / unfindable. Built once per scan.
  // Includes DISABLED wildcards too — otherwise a constraint pointing
  // at a disabled local wildcard would falsely flag as "missing"
  // (it lives in this node, the user just toggled it off). The
  // resulting warning would push the user to fix a typo that isn't
  // there. Disabled vs enabled is a separate concern.
  // Map uuid → ARRAY of chain positions. Pre-2026-05-24 this was a
  // single-index Map<uuid, number>, but the first-instance count-aware
  // orphan check needs to know how many local instances share a uuid
  // (two `mood` wildcard slots in one node = two claimable targets).
  // Keep `localWildcardIndex.get(uuid)?.[0]` for the legacy single-
  // index reads — callers that don't care about duplicates get the
  // earliest occurrence.
  const localWildcardIndex = new Map<string, number[]>();
  // Per-position cumulative nested-reach: `localNestedReachAfter[i]`
  // is the set of uuids reachable via `@{}` from any wildcard at
  // index > i, transitively via this node's local catalog. Used by
  // the constraint target check so a constraint at position i whose
  // target reaches via nested ref from a later wildcard doesn't flag
  // as "missing".
  const localCatalog = new Map<string, ModuleEntry>();
  value.modules.forEach((m, i) => {
    if (m.type === "wildcard") {
      const arr = localWildcardIndex.get(m.id);
      if (arr) arr.push(i);
      else localWildcardIndex.set(m.id, [i]);
      localCatalog.set(m.id, m);
    }
  });
  // Walk backwards: each position's "reach at-or-after" is everything
  // referenced by modules at positions ≥ k, expanded transitively
  // through the catalog. Cheap for library volumes (dozens of modules,
  // single-digit refs each). For a constraint at position i, the
  // check uses `localNestedReachAfter[i + 1]` which corresponds to
  // "uuids reachable from modules at positions > i".
  const localNestedReachAfter: Set<string>[] = new Array(value.modules.length + 1);
  localNestedReachAfter[value.modules.length] = new Set();
  const seedsAccumulator: string[] = [];
  for (let i = value.modules.length - 1; i >= 0; i--) {
    for (const r of nestedRefsOf(value.modules[i])) seedsAccumulator.push(r);
    localNestedReachAfter[i] = walkLocalReach(seedsAccumulator, localCatalog);
  }
  // Per-target slot allocator (2026-05-24 first-instance spec).
  // Each constraint at position i claims the FIRST unclaimed target
  // instance reachable from i — a local wildcard at position > i, or
  // (if no local slot left) a downstream Context instance. Modeling
  // this as a counter was wrong: a constraint at position 4 with a
  // local target at position 3 (BEFORE itself) cannot claim that
  // local — it's upstream. The counter happily decremented anyway,
  // falsely orphaning later constraints when an earlier one had
  // already consumed the only downstream slot.
  //
  // `availableLocalSlots[tgtId]` is a *sorted* list of local indices
  // where this target appears. `claimLocalSlot(tgtId, i)` removes and
  // returns the smallest index > i; `remainingDownstream[tgtId]`
  // tracks how many cross-node instances are still up for grabs.
  const availableLocalSlots = new Map<string, number[]>();
  for (const [uuid, indices] of localWildcardIndex) {
    availableLocalSlots.set(uuid, [...indices].sort((a, b) => a - b));
  }
  const remainingDownstream = new Map<string, number>(downstreamCounts);
  function claimSlot(tgtId: string, i: number): boolean {
    const locals = availableLocalSlots.get(tgtId);
    if (locals) {
      const idx = locals.findIndex((slot) => slot > i);
      if (idx !== -1) {
        locals.splice(idx, 1);
        return true;
      }
    }
    const left = remainingDownstream.get(tgtId) ?? 0;
    if (left > 0) {
      remainingDownstream.set(tgtId, left - 1);
      return true;
    }
    return false;
  }
  const written = new Set<string>();
  // Track the kind of the FIRST module to write each name in this
  // node. Used to distinguish intentional cross-kind overrides
  // (e.g. wildcard `$test` after fixed_values `$test` upstream — the
  // user is layering a literal default with a randomised variant)
  // from genuinely duplicated bindings (e.g. two wildcards both
  // writing `$color`, almost always a config bug). Cross-kind same-
  // node collisions emit `shadows_upstream` (info), same-kind emits
  // `duplicate_variable` (warning).
  const firstWriterKind = new Map<string, ModuleEntry["type"]>();
  // Phase B (2026-05-10): also track the first writer's `module.id`
  // (library uuid). When a later writer shares the same id, the two
  // are SIBLINGS — same library definition instantiated twice. Phase B
  // auto-suffixes bindings for wildcard/combine, but kinds with no
  // single primary binding (fixed_values entries, derivation rules)
  // still emit the same names. That's intentional last-write-wins
  // sibling behavior, NOT a config bug — skip the duplicate_variable
  // warning when the duplicate writer is a sibling.
  const firstWriterId = new Map<string, string>();
  const out: Conflict[] = [];
  const bundleEnabled = buildBundleEnabledMap(value.bundles);
  for (let i = 0; i < value.modules.length; i++) {
    const m = value.modules[i];
    if (!isModuleEffectivelyEnabled(m, bundleEnabled)) continue;

    // 1. Var references — bare reads (`derivation.condition.var`) and
    //    `$var` tokens inside templates (`combine.template`,
    //    `derivation.action.value`) must already exist either upstream
    //    or in a prior enabled module's writes. Order matters — a
    //    combine that references `$a` written by an earlier combine
    //    in the same node is fine. Per spec the combine handler does
    //    NOT auto-bind input_vars, so we need static visibility to
    //    give the user a card-level signal when a referenced var
    //    isn't reachable. Dedup per-module so the same missing name
    //    doesn't surface twice when a template repeats it OR when a
    //    bare read names the same var as a template token below it.
    const seenMissing = new Set<string>();
    const flagMissing = (v: string): void => {
      if (upstream.has(v) || written.has(v)) return;
      if (seenMissing.has(v)) return;
      seenMissing.add(v);
      out.push({ moduleId: m._uid ?? m.id, variable: v, type: "missing_template_variable", severity: "warning" });
    };
    for (const v of varReadsOf(m)) flagMissing(v);
    for (const tpl of templatesOf(m)) {
      for (const v of templateVarsIn(tpl)) flagMissing(v);
    }

    // 2. Writes from this module — order-dependent, so happens AFTER
    //    template scan so a combine can't satisfy its own `$var` refs.
    for (const name of writesOf(m)) {
      if (upstream.has(name)) {
        // Intended override — surface it but don't scream.
        out.push({ moduleId: m._uid ?? m.id, variable: name, type: "shadows_upstream", severity: "info" });
      } else if (written.has(name)) {
        const prevKind = firstWriterKind.get(name);
        const prevId = firstWriterId.get(name);
        if (prevId === m.id) {
          // Sibling writer — same library uuid instantiated twice.
          // Intentional last-write-wins (like alternate rolls of the
          // same wildcard). Emit info-level shadows so the user sees
          // the layering without the false-alarm duplicate warning.
          out.push({ moduleId: m._uid ?? m.id, variable: name, type: "shadows_upstream", severity: "info" });
        } else if (prevKind && prevKind !== m.type) {
          // Cross-kind same-node override — e.g. wildcard `$test`
          // after fixed_values `$test`. Last-write-wins by design;
          // surface as info so the user sees the layering without
          // the duplicate-variable warning.
          out.push({ moduleId: m._uid ?? m.id, variable: name, type: "shadows_upstream", severity: "info" });
        } else {
          // Same-kind same-node duplicate (two wildcards both
          // writing `$color`, two fixed_values rows etc.) — almost
          // always a config bug. Keep the warning.
          out.push({ moduleId: m._uid ?? m.id, variable: name, type: "duplicate_variable", severity: "warning" });
        }
      } else {
        written.add(name);
        firstWriterKind.set(name, m.type);
        firstWriterId.set(name, m.id);
      }
    }

    // 3. Constraint orphan + count check (2026-05-24 first-instance
    //    redesign). Per the new one-shot semantic, each constraint
    //    targets ONE downstream target instance — and source must have
    //    picked upstream of the constraint position. Replaces the
    //    legacy after_self / before_self / in_upstream / in_downstream
    //    rules with two unified orphan checks:
    //
    //      - `constraint_orphan_source`  : no source wildcard instance
    //        upstream of this constraint. Upstream = same-node at
    //        index < i, OR an upstream Context node. A source that
    //        ALSO appears downstream is fine — only flag when there's
    //        no upstream instance at all.
    //
    //      - `constraint_orphan_target`  : no available target
    //        wildcard instance downstream of this constraint. Count-
    //        aware: each prior constraint targeting the same wildcard
    //        consumes one downstream instance slot. If N constraints
    //        targeting target X share fewer than N downstream X
    //        instances, the later constraints get this rule. Available
    //        instances include same-node at index > i, downstream
    //        Context, AND nested-ref reachable via `@{X}` from any
    //        wildcard at index > i (the engine resolver applies
    //        constraints to nested refs too).
    //
    //      - `constraint_source_missing` / `constraint_target_missing`
    //        : uuid not findable in catalog at all. Independent of
    //        position. Surfaces typos / dangling refs.
    if (m.type === "constraint") {
      const cp = (m.payload ?? {}) as { source_wildcard_id?: string; target_wildcard_id?: string };
      const srcId = cp.source_wildcard_id;
      const tgtId = cp.target_wildcard_id;

      if (typeof srcId === "string" && srcId) {
        const localIdxs = localWildcardIndex.get(srcId);
        const inLocalBeforeSelf = (localIdxs ?? []).some((idx) => idx < i);
        const inUpstream = upstreamUuids.has(srcId);
        const inDownstream = (downstreamCounts.get(srcId) ?? 0) > 0;
        const inLocal = localIdxs !== undefined && localIdxs.length > 0;
        const hasUpstreamInstance = inLocalBeforeSelf || inUpstream;
        if (!hasUpstreamInstance) {
          if (!inLocal && !inUpstream && !inDownstream) {
            out.push({
              moduleId: m._uid ?? m.id,
              variable: srcId,
              type: "constraint_source_missing",
              severity: "warning",
            });
          } else {
            // Source exists somewhere but not upstream of this constraint
            // → orphan. Includes same-node-at-or-after-self and
            // downstream-only cases.
            out.push({
              moduleId: m._uid ?? m.id,
              variable: srcId,
              type: "constraint_orphan_source",
              severity: "warning",
            });
          }
        }
      }

      if (typeof tgtId === "string" && tgtId) {
        // Count-aware target orphan check. Track per-target claim
        // count across constraints in chain order. Each constraint at
        // position i can claim the next unclaimed downstream instance.
        // Available instance count = local-after-self count +
        // downstream chain count + nested-reach count (each treated as
        // one slot apiece — best-effort static analysis).
        const localIdxs = localWildcardIndex.get(tgtId);
        const inLocalDirect = localIdxs !== undefined && localIdxs.length > 0;
        const inUpstream = upstreamUuids.has(tgtId);
        const downstreamCount = downstreamCounts.get(tgtId) ?? 0;
        const inDownstream = downstreamCount > 0;
        const inLocalNestedAfter = localNestedReachAfter[i + 1].has(tgtId);
        const inDownstreamNested = downstreamNestedReach.has(tgtId);

        if (
          !inLocalDirect
          && !inUpstream
          && !inDownstream
          && !inLocalNestedAfter
          && !inDownstreamNested
        ) {
          out.push({
            moduleId: m._uid ?? m.id,
            variable: tgtId,
            type: "constraint_target_missing",
            severity: "warning",
          });
        } else {
          // Slot allocation: first try a local instance at index > i,
          // then a downstream cross-node instance. Falls back to
          // nested-reach (best-effort — counts as one extra slot, not
          // tracked per nested instance because static counting through
          // `@{}` chains gets hairy fast). Cross-node via-nested
          // (`inDownstreamNested`) mirrors the pair-badge `↪×N` semantic:
          // multiple constraints can route through the same downstream
          // carrier without consuming a slot — so it suppresses orphan
          // unconditionally.
          const claimed = claimSlot(tgtId, i);
          if (!claimed && !inLocalNestedAfter && !inDownstreamNested) {
            out.push({
              moduleId: m._uid ?? m.id,
              variable: tgtId,
              type: "constraint_orphan_target",
              severity: "warning",
            });
          }
        }
      }
    }
  }
  return out;
}

export function scanTemplateConflicts(template: string, knownVars: string[]): Conflict[] {
  const known = new Set(knownVars);
  const out: Conflict[] = [];
  for (const m of template.matchAll(TEMPLATE_VAR)) {
    const v = m[1];
    if (!known.has(v)) {
      out.push({ moduleId: "", variable: v, type: "missing_template_variable", severity: "warning" });
    }
  }
  return out;
}
