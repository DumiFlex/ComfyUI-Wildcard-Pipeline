import { removeSubcatFromExpr } from "@/manager/cascade/subcatExprCascade";
import { parse as parseSubcatExpr, type Ast } from "@/manager/parsing/subcatFilter";

import type { ModuleEntry } from "../../../../widgets/_shared";
import type { ModuleKind } from "../_shell";
import { encodeKey } from "./keys";

type Instance = NonNullable<ModuleEntry["instance"]>;

/** Distinct sub-category tags referenced by a parsed filter expression. */
function exprTags(ast: Ast | null): string[] {
  if (!ast) return [];
  if ("tag" in ast) return [ast.tag];
  if (ast.op === "not") return exprTags(ast.x);
  return ast.kids.flatMap(exprTags);
}

export interface PruneResult {
  instance: Instance;
  warnings: string[];
}

/**
 * Prune instance refs that no longer match the new payload after a
 * library refresh. Per-kind rules per spec §5.7 stale-reference table.
 * Preserves `_ui` content untouched.
 *
 * See: docs/superpowers/specs/2026-05-07-instance-overrides-modal-design.md §5.7
 */
export function pruneStaleInstanceRefs(
  instance: Instance | undefined,
  newPayload: unknown,
  kind: ModuleKind,
): PruneResult {
  const out: Instance = { ...(instance ?? {}) };
  const warnings: string[] = [];

  if (kind === "wildcard") {
    const payload = (newPayload ?? {}) as {
      options?: Array<{ id: string }>;
      sub_categories?: string[];
    };
    const optionIds = new Set((payload.options ?? []).map((o) => o.id));
    const subCats = new Set(payload.sub_categories ?? []);

    if (Array.isArray(out.enabled_options)) {
      const before = out.enabled_options;
      const after = before.filter((id) => optionIds.has(id));
      if (after.length !== before.length) {
        for (const dropped of before.filter((id) => !optionIds.has(id))) {
          warnings.push(`enabled_options: dropped stale id '${dropped}'`);
        }
        out.enabled_options = after;
      }
    }
    if (out.option_weights && typeof out.option_weights === "object") {
      const next: Record<string, number> = {};
      for (const [k, v] of Object.entries(out.option_weights)) {
        if (optionIds.has(k)) next[k] = v;
        else warnings.push(`option_weights: dropped stale id '${k}'`);
      }
      out.option_weights = Object.keys(next).length > 0 ? next : null;
    }
    if (out.pinned_option_id != null && !optionIds.has(out.pinned_option_id)) {
      warnings.push(`pinned_option_id: dropped stale id '${out.pinned_option_id}'`);
      out.pinned_option_id = null;
      out.mode = "random";
    }
    if (typeof out.category_filter === "string" && out.category_filter.trim()) {
      const stale = [...new Set(exprTags(parseSubcatExpr(out.category_filter)))]
        .filter((c) => !subCats.has(c));
      if (stale.length > 0) {
        let expr = out.category_filter;
        for (const dropped of stale) {
          warnings.push(`category_filter: dropped stale category '${dropped}'`);
          expr = removeSubcatFromExpr(expr, dropped);
        }
        out.category_filter = expr || null;
      }
    }
  } else if (kind === "derivation") {
    const payload = (newPayload ?? {}) as { rules?: Array<{ id: string }> };
    const ruleIds = new Set((payload.rules ?? []).map((r) => r.id));
    if (Array.isArray(out.disabled_rule_ids)) {
      const before = out.disabled_rule_ids;
      const after = before.filter((id) => ruleIds.has(id));
      if (after.length !== before.length) {
        for (const dropped of before.filter((id) => !ruleIds.has(id))) {
          warnings.push(`disabled_rule_ids: dropped stale id '${dropped}'`);
        }
        out.disabled_rule_ids = after.length > 0 ? after : null;
      }
    }
  } else if (kind === "constraint") {
    // Engine accepts both Tier 2 (`source_value`/`target_value`) and
    // legacy (`source`/`target`) exception shapes — see
    // `engine/modules/constraint_handler.py:215`. Mirror the same
    // fallback chain when computing prune keys; otherwise a refresh
    // against a legacy-shaped payload would emit
    // `encodeKey([undefined, undefined])` and falsely flag every saved
    // disable selection as stale.
    const payload = (newPayload ?? {}) as {
      matrix?: Record<string, Record<string, unknown>>;
      exceptions?: Array<{
        source_value?: string;
        target_value?: string;
        source?: string;
        target?: string;
      }>;
    };
    const matrixKeys = new Set<string>();
    for (const [src, row] of Object.entries(payload.matrix ?? {})) {
      for (const tgt of Object.keys(row ?? {})) {
        matrixKeys.add(encodeKey([src, tgt]));
      }
    }
    const exceptionKeys = new Set(
      (payload.exceptions ?? []).map((e) =>
        encodeKey([e.source_value ?? e.source ?? "", e.target_value ?? e.target ?? ""]),
      ),
    );
    if (Array.isArray(out.disabled_matrix_cells)) {
      const before = out.disabled_matrix_cells;
      const after = before.filter((k) => matrixKeys.has(k));
      if (after.length !== before.length) {
        for (const dropped of before.filter((k) => !matrixKeys.has(k))) {
          warnings.push(`disabled_matrix_cells: dropped stale key '${dropped}'`);
        }
        out.disabled_matrix_cells = after.length > 0 ? after : null;
      }
    }
    if (Array.isArray(out.disabled_exception_keys)) {
      const before = out.disabled_exception_keys;
      const after = before.filter((k) => exceptionKeys.has(k));
      if (after.length !== before.length) {
        for (const dropped of before.filter((k) => !exceptionKeys.has(k))) {
          warnings.push(`disabled_exception_keys: dropped stale key '${dropped}'`);
        }
        out.disabled_exception_keys = after.length > 0 ? after : null;
      }
    }

    // Tier-D override maps — drop entries whose key isn't in current
    // payload. extra_exceptions are instance-owned and NEVER pruned.
    function pruneRecord<V>(
      field: "cell_mode_overrides" | "cell_factor_overrides"
        | "exception_mode_overrides" | "exception_factor_overrides",
      validKeys: Set<string>,
    ): void {
      const map = out[field] as Record<string, V> | null | undefined;
      if (!map || typeof map !== "object") return;
      const next: Record<string, V> = {};
      for (const [k, v] of Object.entries(map)) {
        if (validKeys.has(k)) next[k] = v as V;
        else warnings.push(`${field}: dropped stale key '${k}'`);
      }
      (out as Record<string, unknown>)[field] =
        Object.keys(next).length > 0 ? next : null;
    }

    pruneRecord<string>("cell_mode_overrides", matrixKeys);
    pruneRecord<number>("cell_factor_overrides", matrixKeys);
    pruneRecord<string>("exception_mode_overrides", exceptionKeys);
    pruneRecord<number>("exception_factor_overrides", exceptionKeys);
  }

  return { instance: out, warnings };
}
