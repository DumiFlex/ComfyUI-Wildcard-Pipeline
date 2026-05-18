import { onBeforeUnmount, onMounted } from "vue";

export interface EditorShortcutsOptions {
  onSave: () => void | Promise<void>;
  onCancel: () => void;
  /** Returns false to disable shortcut handling (e.g. while a save is in flight). */
  enabled?: () => boolean;
}

/**
 * Window-level keyboard shortcuts for the editor surface.
 *
 *   - `Ctrl+S` / `Cmd+S` → `onSave()`, regardless of focus target.
 *     `preventDefault` blocks the browser's native Save Page dialog.
 *   - `Esc` → `onCancel()`, but skipped when focus is inside an input,
 *     textarea, or contenteditable element so the user's own Esc
 *     interactions (close a popover, clear a field) still work.
 */
export function useEditorShortcuts(opts: EditorShortcutsOptions): void {
  function onKey(e: KeyboardEvent): void {
    if (opts.enabled && !opts.enabled()) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void opts.onSave();
      return;
    }
    if (e.key === "Escape") {
      const t = e.target as HTMLElement | null;
      if (t?.matches?.("input, textarea, [contenteditable]")) return;
      opts.onCancel();
    }
  }

  onMounted(() => window.addEventListener("keydown", onKey));
  onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
}
