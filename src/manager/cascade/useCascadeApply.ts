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

export interface CascadeApplyRequest {
  kind: string;
  id: string;
  action: "delete" | "rename";
  cascade_refs?: boolean;
  new_name?: string;
  extra?: Record<string, unknown>;
}

export interface CascadeApplyOk {
  ok: true;
  undo_entry_id: string;
  affected_count: number;
  affected_entities: Array<{ kind: string; id: string; name: string }>;
  diff?: DiffEntry[];
  broken_refs?: Array<{ kind: string; id: string; name: string }>;
}

export interface CascadeDryRunOk {
  ok: true;
  affected_count: number;
  affected_entities: Array<{ kind: string; id: string; name: string }>;
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
