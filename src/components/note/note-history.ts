/**
 * Undo and redo for the note's text.
 *
 * The toolbar writes the textarea's value from script, and a value set from
 * script never joins the browser's own undo stack (Chrome even clears it),
 * so Ctrl+Z skipped or lost every toolbar edit. The editor keeps this stack
 * instead and answers Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, the right-click Undo
 * and its own buttons from it.
 *
 * Typing joins one step until a pause, a caret jump, a new line or a switch
 * between typing and deleting, the way text editors group it. Each toolbar
 * edit is one step of its own.
 */

/** A state of the text: its value and the selection in it. */
export interface Snapshot { value: string; start: number; end: number }

/** "insert" / "delete" are typing (they join a run); "edit" never joins. */
export type ChangeKind = "insert" | "delete" | "edit";

/** A typing pause this long starts a new step. */
export const GROUP_MS = 1000;
/** The oldest steps drop off past this. */
export const HISTORY_LIMIT = 200;

export class TextHistory {
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private run: ChangeKind | null = null;
  private lastAt = 0;

  constructor(private readonly limit = HISTORY_LIMIT) {}

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }

  /**
   * Note a change. `before` is the text as it was just before it. A typed
   * change that continues the current run adds no step.
   */
  record(before: Snapshot, kind: ChangeKind, now = Date.now()): void {
    const joins = kind !== "edit" && this.run === kind && now - this.lastAt < GROUP_MS;
    this.future = [];
    this.lastAt = now;
    this.run = kind === "edit" ? null : kind;
    if (joins) return;
    const top = this.past[this.past.length - 1];
    if (top && top.value === before.value && top.start === before.start && top.end === before.end) return;
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
  }

  /** The next keystroke starts a step of its own (caret moved, new line). */
  breakRun(): void { this.run = null; }

  /** Steps back. `current` is the text now, kept for redo. */
  undo(current: Snapshot): Snapshot | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(current);
    this.run = null;
    return prev;
  }

  redo(current: Snapshot): Snapshot | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    this.run = null;
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.run = null;
  }
}

/** What a beforeinput's `inputType` means for the history. */
export function kindOf(inputType: string): ChangeKind {
  if (inputType === "insertText" || inputType === "insertCompositionText") return "insert";
  if (inputType === "deleteContentBackward" || inputType === "deleteContentForward") return "delete";
  // New lines, paste, drop, cut, word/line deletes: a step each.
  return "edit";
}

/** The history key for a keydown, or null. Ctrl+Y and Ctrl+Shift+Z redo. */
export function historyKey(ev: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): "undo" | "redo" | null {
  if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return null;
  const k = ev.key.toLowerCase();
  if (k === "z") return ev.shiftKey ? "redo" : "undo";
  if (k === "y" && !ev.shiftKey) return "redo";
  return null;
}
