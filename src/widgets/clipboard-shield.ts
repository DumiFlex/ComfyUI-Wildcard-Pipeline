/**
 * Clipboard-shortcut shield (extension / graph side).
 *
 * ComfyUI's canvas binds Ctrl+A / C / X / V / Z / Y and the copy/cut/paste
 * clipboard events at the document level to drive NODE select-all / copy /
 * paste. When the user types in an editable element inside a WP widget or
 * modal, those keystrokes bubble up to ComfyUI's handlers and run a node op
 * instead of the text op — the classic "paste spawned a whole WP_Context node"
 * bug, and the same reason Ctrl+A/C/V don't work in the Injector
 * variable-binding field.
 *
 * `installClipboardShield(el)` attaches BUBBLE-phase listeners that, when the
 * event target is editable, stop the event propagating past `el` (so it never
 * reaches ComfyUI's document/window handlers) WITHOUT calling preventDefault —
 * the browser's native select/copy/cut/paste still runs, and the widget's own
 * input handlers (deeper in the tree) have already fired by the time the event
 * bubbles here. `stopImmediatePropagation` is also called so a same-target
 * ComfyUI listener registered earlier can't sneak through.
 *
 * Two install points:
 *   - each DOM-widget `inner` (on-node inputs) — see widgets/_shared.ts;
 *   - `document.body` once at bootstrap (main.ts) — the catch-all for modals,
 *     which Teleport to <body> and so bypass the per-widget `inner` shield
 *     (Injector binding modal, instance-edit modals, blocklist, pickers, …).
 *
 * Returns a cleanup that removes the listeners.
 */
const CLIPBOARD_KEYS = new Set(["a", "c", "v", "x", "z", "y"]);

/** INPUT / TEXTAREA / contenteditable (incl. descendants of a contenteditable). */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return true;
  return t.isContentEditable === true;
}

export function installClipboardShield(el: HTMLElement): () => void {
  const stop = (e: Event): void => {
    e.stopPropagation();
    (e as Event & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();
  };
  const onKeydown: EventListener = (e) => {
    const ke = e as KeyboardEvent;
    if (!(ke.ctrlKey || ke.metaKey)) return;
    if (!CLIPBOARD_KEYS.has(ke.key.toLowerCase())) return;
    if (!isEditableTarget(e.target)) return;
    stop(e);
  };
  const onClipboard: EventListener = (e) => {
    if (!isEditableTarget(e.target)) return;
    stop(e);
  };
  el.addEventListener("keydown", onKeydown);
  el.addEventListener("copy", onClipboard);
  el.addEventListener("cut", onClipboard);
  el.addEventListener("paste", onClipboard);
  return () => {
    el.removeEventListener("keydown", onKeydown);
    el.removeEventListener("copy", onClipboard);
    el.removeEventListener("cut", onClipboard);
    el.removeEventListener("paste", onClipboard);
  };
}
