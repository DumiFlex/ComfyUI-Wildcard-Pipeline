/**
 * useResolveWarnings — cross-view warning singleton.
 *
 * Shared module-level `ref<ResolveWarning[]>` (singleton pattern, same as
 * `useToast.ts`) so every consumer reads + writes the same warning list.
 * Lets the post-commit broken-ref discovery (`broken-refs.ts`) push a
 * batch from the Import/Export view and have those warnings show up
 * automatically inside `RichTextInput` / `RichTextPreview` instances on
 * the editor views that key off the same `module_id`.
 *
 * Public surface:
 *   - `warnings`        Read-only view (`ReadonlyArray<ResolveWarning>`).
 *                       Direct mutation is blocked via the type — callers
 *                       must go through `push` / `clear*`.
 *   - `forModule(id)`   Reactive `computed<ResolveWarning[]>` filtered to
 *                       a single module id. Cheaper than re-filtering in
 *                       every consumer's template; recomputed only when
 *                       the underlying ref changes.
 *   - `push(next)`      Append (NOT replace) — the broken-ref pass is one
 *                       batch among potentially several future sources.
 *   - `clearForModule`  Remove all warnings whose `module_id` matches.
 *                       Used by the Undo path so the just-surfaced
 *                       broken-refs disappear when their owning import
 *                       is reversed.
 *   - `clearByType`     Coarser undo lever — remove all warnings of a
 *                       given type (e.g. all `broken_ref_on_import`).
 *   - `clearAll`        Test convenience; reset for a fresh suite.
 *
 * The store is module-singleton — the `const warnings = ref<…>()` lives
 * outside the factory so every call to `useResolveWarnings()` returns
 * the same surface bound to the same underlying ref. This matches
 * `useToast`'s pattern; do NOT move the ref inside the factory or the
 * singleton guarantee breaks (each composable call would mint a fresh
 * ref and no consumer would see anybody else's pushes).
 */
import { computed, ref, type ComputedRef, type Ref } from "vue";

import type { ResolveWarning } from "../utils/resolveTokens";

// Module-level singleton ref — every `useResolveWarnings()` call returns
// the same handle bound to this list.
const warnings = ref<ResolveWarning[]>([]);

export interface UseResolveWarnings {
  warnings: Ref<ReadonlyArray<ResolveWarning>>;
  forModule(moduleId: string): ComputedRef<ResolveWarning[]>;
  push(next: ResolveWarning[]): void;
  clearForModule(moduleId: string): void;
  clearByType(typeStr: string): void;
  clearAll(): void;
}

export function useResolveWarnings(): UseResolveWarnings {
  return {
    warnings: warnings as Ref<ReadonlyArray<ResolveWarning>>,
    forModule(moduleId: string): ComputedRef<ResolveWarning[]> {
      return computed(() =>
        warnings.value.filter((w) => w.module_id === moduleId),
      );
    },
    push(next: ResolveWarning[]): void {
      if (next.length === 0) return;
      warnings.value = [...warnings.value, ...next];
    },
    clearForModule(moduleId: string): void {
      warnings.value = warnings.value.filter((w) => w.module_id !== moduleId);
    },
    clearByType(typeStr: string): void {
      warnings.value = warnings.value.filter((w) => w.type !== typeStr);
    },
    clearAll(): void {
      warnings.value = [];
    },
  };
}
