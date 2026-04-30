import type { ContextWidgetValue, ModuleEntry } from "../widgets/_shared";

/** Same kind-aware writes-extraction `extension/graph.ts:moduleWrites` uses.
 *  Inlined here to keep the conflicts module dependency-light. */
function writesOf(m: ModuleEntry): string[] {
  const out: string[] = [];
  if (m.type === "fixed_values") {
    for (const e of m.entries) {
      const name = e.variable_name.replace(/^\$/, "").trim();
      if (name) out.push(name);
    }
    const values = (m.payload as { values?: Array<{ name?: string }> } | undefined)?.values ?? [];
    for (const v of values) {
      const name = (v.name ?? "").replace(/^\$/, "").trim();
      if (name) out.push(name);
    }
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
    const rules = (p.rules ?? []) as Array<{
      branches?: Array<{ action?: { target_var?: string } }>;
      else?: { action?: { target_var?: string } };
    }>;
    for (const rule of rules) {
      for (const br of rule.branches ?? []) {
        const t = (br.action?.target_var ?? "").replace(/^\$/, "").trim();
        if (t) out.push(t);
      }
      const e = (rule.else?.action?.target_var ?? "").replace(/^\$/, "").trim();
      if (e) out.push(e);
    }
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
 *  the ctx (`$var` lookups). Currently only `combine.template` qualifies —
 *  wildcard option values resolve nested refs but treat `$var` as text;
 *  derivations + constraints surface their var-deps via condition/action
 *  fields, not free-form templates. Extend the union here if a future
 *  kind grows a template-style payload field. */
function templatesOf(m: ModuleEntry): string[] {
  if (m.type === "combine") {
    const tpl = (m.payload as { template?: string } | undefined)?.template;
    return typeof tpl === "string" ? [tpl] : [];
  }
  return [];
}

export function scanConflicts(value: ContextWidgetValue, upstreamVars: string[]): Conflict[] {
  const upstream = new Set(upstreamVars);
  const written = new Set<string>();
  const out: Conflict[] = [];
  for (const m of value.modules) {
    if (!m.enabled) continue;

    // 1. Template-var references: every `$var` mentioned must already
    //    exist either upstream or in a prior enabled module's writes.
    //    Order matters — a combine that references `$a` written by
    //    an earlier combine in the same node is fine. Per spec the
    //    combine handler does NOT auto-bind input_vars, so we need
    //    static visibility here to give the user a card-level signal
    //    when a referenced var isn't reachable. Dedup per-module so
    //    the same missing name doesn't surface twice when a template
    //    repeats it.
    const seenMissing = new Set<string>();
    for (const tpl of templatesOf(m)) {
      for (const v of templateVarsIn(tpl)) {
        if (upstream.has(v) || written.has(v)) continue;
        if (seenMissing.has(v)) continue;
        seenMissing.add(v);
        out.push({ moduleId: m.id, variable: v, type: "missing_template_variable", severity: "warning" });
      }
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
