/**
 * Helper for registering cascade-apply undo entries with the
 * manager's undo surface. Toast Undo buttons + the future Ctrl+Z
 * handler call `handle.undo()` to revert a cascade-apply.
 *
 * Marks the cascade store stale on success so the reverse-dep
 * index gets lazy-rebuilt on next read (server-side state changed
 * in ways that can't be precisely diff'd from the client).
 */

import { api } from "../api/client";
import { useCascadeStore } from "./cascade-store";

export interface CascadeUndoHandle {
  undo_entry_id: string;
  label: string;
  undo: () => Promise<{ ok: boolean; error?: string }>;
}

export function registerCascadeUndo(undo_entry_id: string, label: string): CascadeUndoHandle {
  return {
    undo_entry_id,
    label,
    async undo() {
      const result = await api.cascade_undo(undo_entry_id);
      if (result.ok) {
        useCascadeStore().invalidate();
      }
      return result;
    },
  };
}
