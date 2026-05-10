import type { ContextWidgetValue, ModuleEntry } from "../widgets/_shared";

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
  | "constraint_source_after_self"
  | "constraint_source_missing"
  | "constraint_source_in_downstream"
  | "constraint_target_before_self"
  | "constraint_target_in_upstream"
  | "constraint_target_missing";
export type Severity = "info" | "warning" | "error";
export interface Conflict {
  moduleId: string;
  variable: string;
  type: ConflictType;
  severity: Severity;
}

/** Canonical label per ConflictType. Use this everywhere conflict text
 *  surfaces (card tooltip, subgraph badge, future log viewers) so the
 *  wording stays in sync across surfaces — drift between
 *  "overrides upstream" / "shadows" / "shadow" is a real reported UX
 *  bug. Always paired with `$${variable}` by the caller. */
export function labelFor(type: ConflictType): string {
  if (type === "shadows_upstream") return "overrides upstream";
  if (type === "duplicate_variable") return "duplicate";
  if (type === "missing_template_variable") return "missing";
  if (type === "constraint_source_after_self") return "source after constraint";
  if (type === "constraint_source_missing") return "source missing";
  if (type === "constraint_target_before_self") return "target before constraint";
  if (type === "constraint_target_in_upstream") return "target already picked upstream";
  if (type === "constraint_target_missing") return "target missing";
  if (type === "constraint_source_in_downstream") return "source in downstream";
  return type;
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

export function scanConflicts(
  value: ContextWidgetValue,
  upstreamVars: string[],
  upstreamWildcardUuids: string[] = [],
  downstreamWildcardUuids: string[] = [],
): Conflict[] {
  const upstream = new Set(upstreamVars);
  const upstreamUuids = new Set(upstreamWildcardUuids);
  const downstreamUuids = new Set(downstreamWildcardUuids);
  // Same-node wildcard index lookup. Used by the constraint ordering
  // checks: a constraint references its source/target by uuid, and we
  // need to know whether each uuid lives in this node (and at what
  // position) versus upstream / unfindable. Built once per scan.
  // Includes DISABLED wildcards too — otherwise a constraint pointing
  // at a disabled local wildcard would falsely flag as "missing"
  // (it lives in this node, the user just toggled it off). The
  // resulting warning would push the user to fix a typo that isn't
  // there. Disabled vs enabled is a separate concern.
  const localWildcardIndex = new Map<string, number>();
  value.modules.forEach((m, i) => {
    if (m.type === "wildcard") localWildcardIndex.set(m.id, i);
  });
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
  for (let i = 0; i < value.modules.length; i++) {
    const m = value.modules[i];
    if (!m.enabled) continue;

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
      out.push({ moduleId: m.id, variable: v, type: "missing_template_variable", severity: "warning" });
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
        out.push({ moduleId: m.id, variable: name, type: "shadows_upstream", severity: "info" });
      } else if (written.has(name)) {
        const prevKind = firstWriterKind.get(name);
        const prevId = firstWriterId.get(name);
        if (prevId === m.id) {
          // Sibling writer — same library uuid instantiated twice.
          // Intentional last-write-wins (like alternate rolls of the
          // same wildcard). Emit info-level shadows so the user sees
          // the layering without the false-alarm duplicate warning.
          out.push({ moduleId: m.id, variable: name, type: "shadows_upstream", severity: "info" });
        } else if (prevKind && prevKind !== m.type) {
          // Cross-kind same-node override — e.g. wildcard `$test`
          // after fixed_values `$test`. Last-write-wins by design;
          // surface as info so the user sees the layering without
          // the duplicate-variable warning.
          out.push({ moduleId: m.id, variable: name, type: "shadows_upstream", severity: "info" });
        } else {
          // Same-kind same-node duplicate (two wildcards both
          // writing `$color`, two fixed_values rows etc.) — almost
          // always a config bug. Keep the warning.
          out.push({ moduleId: m.id, variable: name, type: "duplicate_variable", severity: "warning" });
        }
      } else {
        written.add(name);
        firstWriterKind.set(name, m.type);
        firstWriterId.set(name, m.id);
      }
    }

    // 3. Constraint ordering & reference resolution. The runtime contract
    //    is `source picks → constraint loads → target picks` against the
    //    ctx. Ordering rules:
    //      - source MUST run before this constraint (same-node-earlier
    //        OR upstream chain). Otherwise the source's pick isn't yet
    //        in `__wp_picks__` when the wildcard handler reads it.
    //      - target MUST run after this constraint (same-node-later OR
    //        downstream chain). Otherwise the target's pick already
    //        happened and the matrix never reaches it.
    //    Out-of-order references make the constraint a silent no-op at
    //    runtime; the only signal would be the post-run
    //    `unknown_constraint_source` warning. Static checks here flip
    //    that into a card-level dot before the user even queues. The
    //    `variable` field carries a short uuid prefix so the tooltip
    //    points at the offending reference.
    if (m.type === "constraint") {
      const cp = (m.payload ?? {}) as { source_wildcard_id?: string; target_wildcard_id?: string };
      const srcId = cp.source_wildcard_id;
      const tgtId = cp.target_wildcard_id;
      if (typeof srcId === "string" && srcId) {
        // Source needs to have picked BEFORE this constraint runs.
        // Good locations: same node at index < i, OR upstream Context.
        // Bad locations: same node at index >= i (after_self),
        // downstream Context (in_downstream), or unfindable (missing).
        const localIdx = localWildcardIndex.get(srcId);
        const inLocal = localIdx !== undefined;
        const inUpstream = upstreamUuids.has(srcId);
        const inDownstream = downstreamUuids.has(srcId);
        if (inLocal && (localIdx as number) >= i) {
          out.push({
            moduleId: m.id,
            variable: srcId,
            type: "constraint_source_after_self",
            severity: "warning",
          });
        } else if (!inLocal && !inUpstream && inDownstream) {
          // Source IS visible — just in the wrong direction. Surface
          // a more specific signal than the catch-all "missing" so
          // the user knows where to look.
          out.push({
            moduleId: m.id,
            variable: srcId,
            type: "constraint_source_in_downstream",
            severity: "warning",
          });
        } else if (!inLocal && !inUpstream && !inDownstream) {
          out.push({
            moduleId: m.id,
            variable: srcId,
            type: "constraint_source_missing",
            severity: "warning",
          });
        }
      }
      if (typeof tgtId === "string" && tgtId) {
        // Target needs to pick AFTER this constraint runs. Good
        // locations: same node at index > i, OR downstream Context.
        // Bad locations: same node at index <= i (before_self),
        // upstream Context (in_upstream — already picked), or
        // unfindable (missing).
        const localIdx = localWildcardIndex.get(tgtId);
        const inLocal = localIdx !== undefined;
        const inUpstream = upstreamUuids.has(tgtId);
        const inDownstream = downstreamUuids.has(tgtId);
        if (inLocal && (localIdx as number) <= i) {
          out.push({
            moduleId: m.id,
            variable: tgtId,
            type: "constraint_target_before_self",
            severity: "warning",
          });
        } else if (inUpstream) {
          out.push({
            moduleId: m.id,
            variable: tgtId,
            type: "constraint_target_in_upstream",
            severity: "warning",
          });
        } else if (!inLocal && !inDownstream) {
          // Not findable anywhere reachable. Pre-fix the scanner
          // flagged this even when target was downstream; the
          // downstream walker now lets us distinguish — only flag
          // when truly unfindable.
          out.push({
            moduleId: m.id,
            variable: tgtId,
            type: "constraint_target_missing",
            severity: "warning",
          });
        }
        // Target in downstream → no warning (good case).
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
