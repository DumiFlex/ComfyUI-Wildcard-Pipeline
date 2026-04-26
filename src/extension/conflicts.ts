import type { ContextWidgetValue } from "../widgets/_shared";

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

export function scanConflicts(value: ContextWidgetValue, upstreamVars: string[]): Conflict[] {
  const upstream = new Set(upstreamVars);
  const written = new Set<string>();
  const out: Conflict[] = [];
  for (const m of value.modules) {
    if (!m.enabled) continue;
    for (const e of m.entries) {
      const name = e.variable_name.replace(/^\$/, "").trim();
      if (!name) continue;
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

const TEMPLATE_VAR = /(?<!\$)\$([A-Za-z_][A-Za-z0-9_]*)/g;

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
