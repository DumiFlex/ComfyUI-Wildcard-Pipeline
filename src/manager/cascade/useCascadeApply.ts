/**
 * useCascadeApply — composable wrapping cascade-apply + cascade-undo.
 *
 * Three entry points:
 *   - `dryRun(req)`: fires POST with `dry_run: true`. Returns scan only,
 *     no mutation. Used by CascadeConfirmDialog to populate the affected
 *     list before the user confirms.
 *   - `apply(req)`: fires POST with `dry_run: false` (commit mode). On
 *     success, patches the cascade-store's reverse-dep index via the
 *     server-returned `diff` payload. Returns full response including
 *     `undo_entry_id` (so the caller can register an Undo toast action).
 *   - `undo(undo_entry_id)`: fires POST to /wp/api/cascade/undo. On
 *     success, invalidates the cascade-store (forcing a lazy rebuild
 *     on next read) since the diff payload is not symmetric.
 */

import { api } from "../api/client";
import { useCascadeStore } from "./cascade-store";
import type { DiffEntry } from "./reverse-dep-index";

/**
 * Request to apply or dry-run a cascade-edit mutation.
 */
export interface CascadeApplyRequest {
  kind: string;
  id: string;
  action: "delete" | "rename";
  cascade_refs?: boolean;
  /**
   * Per-entity opt-in cleanup list for wildcard-delete. Each id names a
   * nested-ref wildcard/derivation whose dead `@{deleted}` token the
   * engine should strip; entities omitted here are left broken (healed
   * later via chip remap). Constraints are NEVER listed — they're never
   * cleaned (the engine ignores them and the user reattaches via the
   * constraint editor). Only sent by the wildcard-delete branch; other
   * kinds use `cascade_refs`. `apply()` forwards it when present;
   * `dryRun()` never needs it (the scan reports full impact regardless).
   */
  cleanup_ids?: string[];
  new_name?: string;
  extra?: Record<string, unknown>;
}

/**
 * Affected entity returned by the server during scan.
 * Represents an entity that holds a reference to the target of the mutation.
 *
 * @property kind - Entity type ("wildcard" | "fixed_values" | "combine" | "derivation" | "constraint" | "bundle")
 * @property id - Entity UUID or slug
 * @property name - Display name
 * @property ref_path - Human-readable breadcrumb showing where the reference lives,
 *                      e.g. "options[0].value", "matrix.warm", "children[2]", "payload.template"
 */
export interface AffectedEntity {
  kind: string;
  id: string;
  name: string;
  ref_path: string;
}

export interface CascadeApplyOk {
  ok: true;
  undo_entry_id: string;
  affected_count: number;
  affected_entities: Array<{ kind: string; id: string; name: string; ref_path: string }>;
  diff?: DiffEntry[];
  broken_refs?: Array<{ kind: string; id: string; name: string; ref_path: string }>;
}

export interface CascadeDryRunOk {
  ok: true;
  affected_count: number;
  affected_entities: Array<{ kind: string; id: string; name: string; ref_path: string }>;
}

export interface CascadeFail {
  ok: false;
  error: string;
}

export type CascadeApplyResult = CascadeApplyOk | CascadeFail;
export type CascadeDryRunResult = CascadeDryRunOk | CascadeFail;

function isDiffEntryArray(value: unknown): value is DiffEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        "entity_id" in item &&
        typeof (item as Record<string, unknown>).entity_id === "string",
    )
  );
}

export function useCascadeApply() {
  const store = useCascadeStore();

  async function dryRun(req: CascadeApplyRequest): Promise<CascadeDryRunResult> {
    const raw = await api.cascade_apply({ ...(req as unknown as Record<string, unknown>), dry_run: true });
    if (raw.ok) {
      return raw as unknown as CascadeDryRunOk;
    }
    return { ok: false, error: (raw.error as string | undefined) ?? "unknown error" };
  }

  async function apply(req: CascadeApplyRequest): Promise<CascadeApplyResult> {
    const raw = await api.cascade_apply({ ...(req as unknown as Record<string, unknown>), dry_run: false });
    if (raw.ok) {
      if (isDiffEntryArray(raw.diff)) {
        store.applyDiff(raw.diff);
      }
      return raw as unknown as CascadeApplyOk;
    }
    return { ok: false, error: (raw.error as string | undefined) ?? "unknown error" };
  }

  async function undo(undo_entry_id: string): Promise<{ ok: boolean; error?: string }> {
    const result = await api.cascade_undo(undo_entry_id);
    if (result.ok) {
      // Server-side state changed in ways we can't precisely diff —
      // mark for lazy rebuild on next read.
      store.invalidate();
    }
    return result;
  }

  return { dryRun, apply, undo };
}
