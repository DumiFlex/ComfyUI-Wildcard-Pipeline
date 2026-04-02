import type { PipelineModule } from "@/types";

export type ConflictSeverity = "error" | "warning";
export type ConflictType =
  | "duplicate_variable"
  | "unresolved_constraint_target"
  | "unresolved_constraint_when_variable"
  | "missing_template_variable"
  | "context_overwrite";

export interface Conflict {
  moduleIndex: number;
  type: ConflictType;
  severity: ConflictSeverity;
  message: string;
}

/**
 * Extract $var references from a template string.
 * - Replaces $$ first (literal dollar sign escape) so they are not scanned.
 * - Skips variables with __ prefix (internal keys).
 */
function extractTemplateVars(template: string): string[] {
  // Replace $$ escapes with a safe placeholder so we don't parse them as var refs
  const sanitized = template.replace(/\$\$/g, "\x00\x00");
  const vars: string[] = [];
  const re = /\$(\w+)/g;
  let m = re.exec(sanitized);
  while (m !== null) {
    const name = m[1];
    if (!name.startsWith("__")) {
      vars.push(name);
    }
    m = re.exec(sanitized);
  }
  return vars;
}

/**
 * Strips leading `$` from a variable name (e.g. "$location" → "location").
 */
function stripDollar(name: string): string {
  return name.replace(/^\$/, "");
}

/**
 * Analyzes a list of pipeline modules for variable conflicts.
 *
 * @param modules - Ordered list of pipeline modules to analyze
 * @param upstreamVariables - Variable names already defined by upstream nodes
 * @returns Array of detected conflicts (may be empty)
 */
export function analyzePipelineConflicts(
  modules: PipelineModule[],
  upstreamVariables: string[],
): Conflict[] {
  const conflicts: Conflict[] = [];
  const upstreamSet = new Set(upstreamVariables);
  // capturedSoFar starts with all upstream vars
  const capturedSoFar = new Set<string>(upstreamVariables);

  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];

    // Checks 1 + 2: capture_as-bearing modules
    if ("capture_as" in mod && mod.capture_as) {
      const varName = stripDollar(mod.capture_as);

      // Check 1: context_overwrite — overwrites an upstream variable
      if (upstreamSet.has(varName)) {
        conflicts.push({
          moduleIndex: i,
          type: "context_overwrite",
          severity: "error",
          message: `Variable '$${varName}' overwrites an upstream value`,
        });
      }
      // Check 2: duplicate_variable — already captured by a prior module in this node
      else if (capturedSoFar.has(varName)) {
        conflicts.push({
          moduleIndex: i,
          type: "duplicate_variable",
          severity: "error",
          message: `Variable '$${varName}' is already captured earlier in this pipeline`,
        });
      }

      // Check 3: register the variable for subsequent modules
      capturedSoFar.add(varName);
    }

    // Check 4 + 5: constrain modules
    if (mod.type === "constrain") {
      // Check 4: unresolved_constraint_target
      if (mod.target !== undefined && mod.target !== null && mod.target !== "") {
        const target = stripDollar(mod.target);
        if (!capturedSoFar.has(target)) {
          conflicts.push({
            moduleIndex: i,
            type: "unresolved_constraint_target",
            severity: "warning",
            message: `Constraint target '$${target}' is not defined in the pipeline`,
          });
        }
      }

      // Check 5: unresolved_constraint_when_variable
      if (mod.rules && mod.rules.length > 0) {
        for (const rule of mod.rules) {
          if (rule.when_variable && !capturedSoFar.has(rule.when_variable)) {
            conflicts.push({
              moduleIndex: i,
              type: "unresolved_constraint_when_variable",
              severity: "warning",
              message: `Constraint rule references undefined variable '$${rule.when_variable}'`,
            });
          }
        }
      }
    }

    // Check 6: missing_template_variable — combine modules
    if (mod.type === "combine") {
      const refs = extractTemplateVars(mod.template);
      for (const ref of refs) {
        if (!capturedSoFar.has(ref)) {
          conflicts.push({
            moduleIndex: i,
            type: "missing_template_variable",
            severity: "warning",
            message: `Template references undefined variable '$${ref}'`,
          });
        }
      }
    }

    // Check 6: missing_template_variable — condition modules
    if (mod.type === "condition") {
      const varName = mod.variable;
      if (varName && !varName.startsWith("__") && !capturedSoFar.has(varName)) {
        conflicts.push({
          moduleIndex: i,
          type: "missing_template_variable",
          severity: "warning",
          message: `Condition references undefined variable '$${varName}'`,
        });
      }
    }
  }

  return conflicts;
}

const INJECT_SLOT_NAMES = ["input_1", "input_2", "input_3"] as const;

/**
 * Analyzes inject node slot-to-variable mapping for conflicts.
 *
 * @param mapping - Record<slotName, variableName> from inject_config JSON
 * @param connectedSlots - Set (or array) of slot names that are actually wired
 * @param upstreamVariables - Variable names already defined by upstream nodes
 * @returns Array of detected conflicts (may be empty)
 */
export function analyzeInjectConflicts(
  mapping: Record<string, string>,
  connectedSlots: string[] | Set<string>,
  upstreamVariables: string[],
): Conflict[] {
  const conflicts: Conflict[] = [];
  const upstreamSet = new Set(upstreamVariables);
  const connectedSet =
    connectedSlots instanceof Set ? connectedSlots : new Set(connectedSlots);

  // Track variable names seen so far among connected slots in this inject node
  const seenVars = new Map<string, number>(); // varName → first moduleIndex

  for (let slotIdx = 0; slotIdx < INJECT_SLOT_NAMES.length; slotIdx++) {
    const slotName = INJECT_SLOT_NAMES[slotIdx];
    if (!connectedSet.has(slotName)) continue;

    const rawVar = mapping[slotName];
    if (!rawVar || rawVar.trim() === "") continue;

    const varName = stripDollar(rawVar.trim());
    if (!varName) continue;

    // Check: context_overwrite
    if (upstreamSet.has(varName)) {
      conflicts.push({
        moduleIndex: slotIdx,
        type: "context_overwrite",
        severity: "error",
        message: `Variable '$${varName}' overwrites an upstream value`,
      });
    }

    // Check: duplicate_variable (same var in another connected slot of this node)
    if (seenVars.has(varName)) {
      conflicts.push({
        moduleIndex: slotIdx,
        type: "duplicate_variable",
        severity: "error",
        message: `Variable '$${varName}' is already used by another slot`,
      });
    } else {
      seenVars.set(varName, slotIdx);
    }
  }

  return conflicts;
}
