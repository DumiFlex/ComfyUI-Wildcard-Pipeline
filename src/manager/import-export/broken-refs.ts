/**
 * Post-commit broken-reference discovery.
 *
 * After a successful import commit, walk each newly-committed entity's
 * outgoing refs against the receiver library's id set. Anything not
 * found is a dangling ref the user picked up either by:
 *
 *   - Selecting a wildcard that mentions `@{id}` while leaving the
 *     referenced id out of the picker selection (or skipping it on
 *     conflict resolution).
 *   - Importing a constraint whose source/target wildcard id is not in
 *     the local library.
 *
 * Output mirrors the `ResolveWarning` shape produced by
 * `src/manager/utils/resolveTokens.ts` so the rich-text editors
 * (`RichTextInput` / `RichTextPreview`) can surface these inline next
 * to the offending token. The `type` discriminator is set to
 * `"broken_ref_on_import"` so callers can filter the post-commit
 * batch from regular resolve-time warnings.
 *
 * Scope: v1 walks wildcard option values + constraint source/target
 * only. Fixed values, combines, derivations don't carry inline `@{}`
 * refs (their content shapes are name-keyed templates, not free-form
 * text), so they're deferred until those ref shapes are non-obvious.
 *
 * Pure function. No I/O. Entity key convention: `id` (per the Task 17
 * alignment fix in `dep-graph.ts`), constraint refs nested under
 * `payload.source_wildcard_id` / `payload.target_wildcard_id` (per the
 * `engine.modules.constraint_handler.py` shape).
 */

import type { ResolveWarning } from "../utils/resolveTokens";

/**
 * Subset of the imported wildcard shape the broken-ref walker reads.
 * Matches the row payload from `engine/importer.py` after commit — the
 * full row carries many more fields (name, tags, var_binding, ...) but
 * the walker only needs `id` for warning attribution and `options[].value`
 * for the ref regex.
 */
export interface ImportedWildcard {
  id: string;
  options?: Array<{ value: unknown; weight?: number }>;
}

/**
 * Subset of the imported constraint shape the broken-ref walker reads.
 * Source/target wildcard ids live nested under `payload` to match the
 * `engine.modules.constraint_handler.py` schema (see Task 17 fix in
 * `dep-graph.ts`).
 */
export interface ImportedConstraint {
  id: string;
  payload?: {
    source_wildcard_id?: string;
    target_wildcard_id?: string;
  };
}

/**
 * Same `@{8hex(:label)?}` ref grammar as `engine/syntax/tokenize.py`
 * and the `dep-graph.ts` REF_REGEX twin. Captures only the 8-hex id —
 * the optional `:label` suffix is for editor-display only and not part
 * of the resolution key.
 */
const REF_REGEX = /@\{([0-9a-f]{8})(?:#[^#:}@{]*)?(?::[^}]*)?\}/g;

export function discoverBrokenRefsForImport(
  wildcards: ImportedWildcard[],
  constraints: ImportedConstraint[],
  libraryIds: Set<string>,
): ResolveWarning[] {
  const warnings: ResolveWarning[] = [];

  for (const w of wildcards) {
    const options = w.options ?? [];
    for (let optIdx = 0; optIdx < options.length; optIdx++) {
      const opt = options[optIdx];
      // Defensive: malformed payloads may carry non-string `value`
      // (null, number, missing). Same guard pattern as
      // `dep-graph.ts:extractRefsFromText` (Task 17 fix).
      if (typeof opt?.value !== "string") continue;
      REF_REGEX.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = REF_REGEX.exec(opt.value)) !== null) {
        const target = m[1];
        // The single capture group is non-optional in REF_REGEX, so a
        // successful match always yields a string here. The runtime
        // guard keeps the lint clean without resorting to a non-null
        // assertion.
        if (target === undefined) continue;
        if (libraryIds.has(target)) continue;
        warnings.push({
          type: "broken_ref_on_import",
          severity: "warn",
          module_id: w.id,
          source_field: `options[${optIdx}].value`,
          position: m.index,
          token_index: null,
          detail: { target_id: target },
          message: `Reference @{${target}} not found in library`,
        });
      }
    }
  }

  for (const c of constraints) {
    const cp = c.payload;
    const src = cp?.source_wildcard_id;
    const tgt = cp?.target_wildcard_id;
    if (src && !libraryIds.has(src)) {
      warnings.push({
        type: "broken_ref_on_import",
        severity: "warn",
        module_id: c.id,
        source_field: "payload.source_wildcard_id",
        position: 0,
        token_index: null,
        detail: { target_id: src },
        message: `Reference @{${src}} not found in library`,
      });
    }
    if (tgt && !libraryIds.has(tgt)) {
      warnings.push({
        type: "broken_ref_on_import",
        severity: "warn",
        module_id: c.id,
        source_field: "payload.target_wildcard_id",
        position: 0,
        token_index: null,
        detail: { target_id: tgt },
        message: `Reference @{${tgt}} not found in library`,
      });
    }
  }

  return warnings;
}
