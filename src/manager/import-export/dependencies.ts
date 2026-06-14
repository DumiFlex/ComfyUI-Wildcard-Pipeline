/**
 * Upload dependency detection (Feature B2a).
 *
 * `listReferencedUuids(module)` — given ONE library module, returns the
 * de-duplicated set of wildcard uuids it references, so the upload flow
 * (B2b `single-row-publish.ts`) can resolve which referenced wildcards
 * are already published (prefill) vs. unpublished (warn).
 *
 * Pure function. No I/O, no store access — it reads only the module's
 * `id` / `type` / `payload`, the structural intersection of `ModuleRow`
 * (library row, the publish path) and `ModuleEntry` (in-graph instance).
 *
 * Two reference shapes exist in a payload:
 *   - constraint source/target: WHOLE-id fields (`source_wildcard_id` /
 *     `target_wildcard_id`), each an 8-hex `ModuleRow.id`. Taken verbatim
 *     (skipping null/empty/whitespace) — same as `dep-graph.ts`.
 *   - nested `@{uuid}` tokens inside resolvable string values (wildcard
 *     option values, derivation action values, constraint exception
 *     strings). Scanned with the SAME `REF_TOKEN_RE` the conflict scanner
 *     uses (`@\{[0-9a-f]{8}…\}`) — one shared 8-hex token regex, never a
 *     forked copy. Combine templates are intentionally NOT scanned: the
 *     engine treats their `@{}` as literal text, mirroring
 *     `scanConflicts`' broken-nested-ref exclusion.
 *
 * The module's OWN id is excluded — a self-reference is not a dependency.
 */

import { REF_TOKEN_RE } from "../../extension/conflicts";
import type {
  ConstraintException,
  ConstraintPayload,
  DerivationPayload,
  ModuleType,
  WildcardPayload,
} from "../api/types";

/** Module kinds that can appear in a publish. `ModuleType` covers the five
 *  module subtypes; bundles arrive as a `"bundle"` row with `children`
 *  instead of a typed payload, so the detector accepts the wider union and
 *  returns `[]` for it (children are frozen self-contained snapshots —
 *  out of scope per the B2 spec). */
export type ReferencingModuleType = ModuleType | "bundle";

/** Minimal structural shape `listReferencedUuids` reads — satisfied by both
 *  `ModuleRow` (library row) and `ModuleEntry` (in-graph instance). */
export interface ReferencingModule {
  id: string;
  type: ReferencingModuleType;
  payload?: Record<string, unknown>;
}

/** Push every `@{8hex}` ref found in `text` into `out`. `matchAll` (never
 *  `.exec`) so the shared global `REF_TOKEN_RE` stays stateless across
 *  calls and the security pre-tool hook stays quiet. */
function collectNestedRefs(text: unknown, out: string[]): void {
  if (typeof text !== "string") return;
  for (const match of text.matchAll(REF_TOKEN_RE)) out.push(match[1]);
}

/** Whole-id field (constraint source/target): keep iff a non-blank string. */
function pushWholeId(id: unknown, out: string[]): void {
  if (typeof id === "string" && id.trim() !== "") out.push(id);
}

/**
 * The de-duplicated set of wildcard uuids `module` references, excluding
 * its own id. Returns a fresh array (insertion order preserved, first
 * occurrence wins). Unknown / ref-free types return `[]`.
 */
export function listReferencedUuids(module: ReferencingModule): string[] {
  const payload = (module.payload ?? {}) as Record<string, unknown>;
  const refs: string[] = [];

  switch (module.type) {
    case "constraint": {
      const cp = payload as Partial<ConstraintPayload>;
      pushWholeId(cp.source_wildcard_id, refs);
      pushWholeId(cp.target_wildcard_id, refs);
      // Exception strings may embed `@{}` refs (migration 010 mirrors
      // runtime keys onto `*_value`; scan whichever forms are present).
      const exceptions = (cp.exceptions ?? []) as Array<Partial<ConstraintException> & {
        source_value?: unknown;
        target_value?: unknown;
      }>;
      for (const ex of exceptions) {
        collectNestedRefs(ex?.source, refs);
        collectNestedRefs(ex?.target, refs);
        collectNestedRefs(ex?.source_value, refs);
        collectNestedRefs(ex?.target_value, refs);
      }
      break;
    }
    case "wildcard": {
      const wp = payload as Partial<WildcardPayload>;
      for (const opt of wp.options ?? []) collectNestedRefs(opt?.value, refs);
      break;
    }
    case "derivation": {
      const dp = payload as Partial<DerivationPayload>;
      for (const rule of dp.rules ?? []) {
        for (const branch of rule?.branches ?? []) {
          collectNestedRefs(branch?.action?.value, refs);
        }
        collectNestedRefs(rule?.else?.action?.value, refs);
      }
      break;
    }
    // fixed_values / combine / bundle: no wildcard refs the downloader
    // would need to reattach. Combine `@{}` is literal text; bundle
    // children are self-contained snapshots.
    default:
      break;
  }

  // De-duplicate (first occurrence wins) and drop the module's own id —
  // a self-reference isn't a dependency.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const uuid of refs) {
    if (uuid === module.id || seen.has(uuid)) continue;
    seen.add(uuid);
    out.push(uuid);
  }
  return out;
}
