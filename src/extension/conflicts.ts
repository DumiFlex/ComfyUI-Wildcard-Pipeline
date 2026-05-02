import type { ContextWidgetValue, ModuleEntry } from "../widgets/_shared";

/** Same kind-aware writes-extraction `extension/graph.ts:moduleWrites` uses.
 *  Inlined here to keep the conflicts module dependency-light. */
function writesOf(m: ModuleEntry): string[] {
  const out: string[] = [];
  if (m.type === "fixed_values") {
    // Dedup within a single fixed_values module: `entries` (UI source)
    // and `payload.values` (engine source) carry the same names after
    // ModuleEditModal sync, so naive concat would falsely flag every
    // entry as `duplicate_variable` against itself. Multi-module dup
    // detection still works — outer `written` set tracks across modules.
    const seen = new Set<string>();
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
    const b = (p.var_binding as string | undefined)?.replace(/^\$/, "").trim();
    if (b) out.push(b);
  } else if (m.type === "combine") {
    const o = (p.output_var as string | undefined)?.replace(/^\$/, "").trim();
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
export type ConflictType = "shadows_upstream" | "duplicate_variable" | "missing_template_variable";
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

export function scanConflicts(value: ContextWidgetValue, upstreamVars: string[]): Conflict[] {
  const upstream = new Set(upstreamVars);
  const written = new Set<string>();
  const out: Conflict[] = [];
  for (const m of value.modules) {
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
        out.push({ moduleId: m.id, variable: name, type: "duplicate_variable", severity: "warning" });
      } else {
        written.add(name);
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
