import type { PipelineModule, ConstraintRule, InjectSlotConfig } from "@/types";
import { constraintApi } from "@/api/client";

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

// Cache for resolved constraint rules: source ID → rules[]
const constraintCache = new Map<string, ConstraintRule[]>();

/**
 * Fetch constraint rules for a source ID, using cache when available.
 * Returns empty array on fetch failure (graceful degradation).
 */
async function fetchConstraintRules(sourceId: string): Promise<ConstraintRule[]> {
  const cached = constraintCache.get(sourceId);
  if (cached) return cached;

  try {
    const data = await constraintApi.get(sourceId);
    const rules = (data.rules ?? []) as ConstraintRule[];
    constraintCache.set(sourceId, rules);
    return rules;
  } catch {
    return [];
  }
}

export function invalidateConstraintCache(sourceId?: string): void {
  if (sourceId) {
    constraintCache.delete(sourceId);
  } else {
    constraintCache.clear();
  }
}

/**
 * Resolve constrain modules that reference external sources.
 * Returns a new array with source-based constrain modules augmented with fetched rules.
 */
export async function resolveConstrainSources(
  modules: PipelineModule[],
): Promise<PipelineModule[]> {
  const resolved: PipelineModule[] = [];

  for (const mod of modules) {
    if (mod.type === "constrain" && mod.source && (!mod.rules || mod.rules.length === 0)) {
      const rules = await fetchConstraintRules(mod.source);
      resolved.push({ ...mod, rules });
    } else {
      resolved.push(mod);
    }
  }

  return resolved;
}

function getConstrainRuleTargets(mod: PipelineModule): string[] {
  if (mod.type !== "constrain") return [];
  const targets: string[] = [];
  if (mod.target) targets.push(stripDollar(mod.target));
  if (mod.rules) {
    for (const rule of mod.rules) {
      if (rule.target) {
        const t = stripDollar(rule.target);
        if (t && !targets.includes(t)) targets.push(t);
      }
    }
  }
  return targets;
}

function getConstrainRuleWhenVariables(mod: PipelineModule): string[] {
  if (mod.type !== "constrain" || !mod.rules) return [];
  const vars: string[] = [];
  for (const rule of mod.rules) {
    if (rule.when_variable) {
      const v = stripDollar(rule.when_variable);
      if (v && !vars.includes(v)) vars.push(v);
    }
  }
  return vars;
}

/**
 * Analyzes a list of pipeline modules for variable conflicts.
 * Constrain modules should be pre-resolved via resolveConstrainSources()
 * so that source-based rules are available for inspection.
 *
 * @param modules - Ordered list of pipeline modules to analyze
 * @param upstreamVariables - Variable names already defined by upstream nodes
 * @param downstreamVariables - Variable names defined by downstream nodes
 * @returns Array of detected conflicts (may be empty)
 */
export function analyzePipelineConflicts(
  modules: PipelineModule[],
  upstreamVariables: string[],
  downstreamVariables: string[] = [],
): Conflict[] {
  const conflicts: Conflict[] = [];
  const upstreamSet = new Set(upstreamVariables);
  const capturedSoFar = new Set<string>(upstreamVariables);
  const downstreamSet = new Set(downstreamVariables);

  const allChainVars = new Set<string>(upstreamVariables);
  for (const v of downstreamVariables) allChainVars.add(v);
  for (const mod of modules) {
    if ('enabled' in mod && mod.enabled === false) continue;
    if ("capture_as" in mod && mod.capture_as) {
      allChainVars.add(stripDollar(mod.capture_as));
    }
  }

  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];

    // Skip disabled modules — they don't participate in conflict analysis
    if ('enabled' in mod && mod.enabled === false) continue;

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

    // Check 4 + 5: constrain modules — ordering-aware, checks per-rule targets
    if (mod.type === "constrain") {
      const futureCaptures = new Set<string>(downstreamSet);
      for (let j = i + 1; j < modules.length; j++) {
        const futureModule = modules[j];
        if ("capture_as" in futureModule && futureModule.capture_as) {
          futureCaptures.add(stripDollar(futureModule.capture_as));
        }
      }

      // Check 4: each rule's target — must be a future wildcard, not already sampled
      const ruleTargets = getConstrainRuleTargets(mod);
      for (const target of ruleTargets) {
        if (capturedSoFar.has(target)) {
          conflicts.push({
            moduleIndex: i,
            type: "unresolved_constraint_target",
            severity: "warning",
            message: `Constraint target '$${target}' was already sampled — move this constraint before it`,
          });
        } else if (!futureCaptures.has(target)) {
          conflicts.push({
            moduleIndex: i,
            type: "unresolved_constraint_target",
            severity: "warning",
            message: `Constraint target '$${target}' is not defined in the pipeline`,
          });
        }
      }

      // Check 5: each rule's when_variable — must exist somewhere in the pipeline
      const whenVars = getConstrainRuleWhenVariables(mod);
      for (const whenVar of whenVars) {
        if (!allChainVars.has(whenVar)) {
          conflicts.push({
            moduleIndex: i,
            type: "unresolved_constraint_when_variable",
            severity: "warning",
            message: `Constraint rule references undefined variable '$${whenVar}'`,
          });
        }
      }

      for (const rule of mod.rules ?? []) {
        if (!rule.when_variable || !rule.target) continue;
        const whenVar = stripDollar(rule.when_variable);
        const target = stripDollar(rule.target ?? mod.target ?? "");
        if (!whenVar || !target) continue;

        if (capturedSoFar.has(whenVar)) continue;

        if (!allChainVars.has(whenVar)) continue;

        if (capturedSoFar.has(target)) continue;

        let whenVarFutureIdx = -1;
        let targetFutureIdx = -1;
        for (let j = i + 1; j < modules.length; j++) {
          const futureModule = modules[j];
          if ("capture_as" in futureModule && futureModule.capture_as) {
            const cap = stripDollar(futureModule.capture_as);
            if (cap === whenVar && whenVarFutureIdx === -1) whenVarFutureIdx = j;
            if (cap === target && targetFutureIdx === -1) targetFutureIdx = j;
          }
        }

        if (targetFutureIdx !== -1 && whenVarFutureIdx === -1 && downstreamSet.has(whenVar)) {
          conflicts.push({
            moduleIndex: i,
            type: "unresolved_constraint_when_variable",
            severity: "warning",
            message: `Constraint's when_variable '$${whenVar}' won't be resolved before target '$${target}' is sampled`,
          });
          continue;
        }

        if (whenVarFutureIdx !== -1 && targetFutureIdx !== -1 && whenVarFutureIdx > targetFutureIdx) {
          conflicts.push({
            moduleIndex: i,
            type: "unresolved_constraint_when_variable",
            severity: "warning",
            message: `Constraint's when_variable '$${whenVar}' won't be resolved before target '$${target}' is sampled`,
          });
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
  mapping: Record<string, string | InjectSlotConfig>,
  connectedSlots: string[] | Set<string>,
  upstreamVariables: string[],
): Conflict[] {
  const conflicts: Conflict[] = [];
  const upstreamSet = new Set(upstreamVariables);
  const connectedSet =
    connectedSlots instanceof Set ? connectedSlots : new Set(connectedSlots);

  const seenVars = new Map<string, number>();

  for (let slotIdx = 0; slotIdx < INJECT_SLOT_NAMES.length; slotIdx++) {
    const slotName = INJECT_SLOT_NAMES[slotIdx];
    if (!connectedSet.has(slotName)) continue;

    const slotVal = mapping[slotName];
    if (!slotVal) continue;

    const cfg: InjectSlotConfig = typeof slotVal === "string"
      ? { varName: slotVal }
      : slotVal;

    if (cfg.enabled === false) continue;

    const rawVar = cfg.varName;
    if (!rawVar || rawVar.trim() === "") continue;

    const varName = stripDollar(rawVar.trim());
    if (!varName) continue;

    if (upstreamSet.has(varName)) {
      conflicts.push({
        moduleIndex: slotIdx,
        type: "context_overwrite",
        severity: "error",
        message: `Variable '$${varName}' overwrites an upstream value`,
      });
    }

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
