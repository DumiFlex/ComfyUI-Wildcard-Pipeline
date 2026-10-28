/**
 * Focus handling every dialog-like panel needs (Modal, Drawer): while open,
 * Escape calls `onEscape` and Tab stays inside the panel; on open, focus
 * moves in (`initial`, else the first control, else the panel itself); on
 * close, it goes back to where it was.
 */
import { nextTick, onBeforeUnmount, watch, type Ref } from "vue";

export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
  + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function focusablesIn(root: HTMLElement | null): HTMLElement[] {
  return Array.from(root?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    .filter((el) => !el.closest("[hidden], [inert]"));
}

export interface DialogFocusOptions {
  onEscape: () => void;
  /** Where focus goes on open; defaults to the first control. */
  initial?: (root: HTMLElement, controls: HTMLElement[]) => HTMLElement | null | undefined;
  /** Keep Tab inside the panel (default). Off for a panel beside the page. */
  trap?: () => boolean;
}

export function useDialogFocus(panel: Ref<HTMLElement | null>, isOpen: () => boolean, opts: DialogFocusOptions): void {
  let returnTo: HTMLElement | null = null;

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") { opts.onEscape(); return; }
    const root = panel.value;
    if (e.key !== "Tab" || !root || opts.trap?.() === false) return;
    const els = focusablesIn(root);
    if (!els.length) { e.preventDefault(); root.focus(); return; }
    const first = els[0];
    const last = els[els.length - 1];
    const at = document.activeElement;
    const inside = at instanceof Node && root.contains(at);
    if (e.shiftKey && (at === first || !inside)) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && (at === last || !inside)) { e.preventDefault(); first?.focus(); }
  }

  async function opened(): Promise<void> {
    returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await nextTick();
    const root = panel.value;
    if (!root || root.contains(document.activeElement)) return;
    const els = focusablesIn(root);
    ((opts.initial ? opts.initial(root, els) : els[0]) ?? root).focus();
  }

  function closed(): void {
    const el = returnTo;
    returnTo = null;
    if (el?.isConnected) el.focus();
  }

  watch(isOpen, (v, was) => {
    if (typeof window === "undefined") return;
    if (v) {
      window.addEventListener("keydown", onKeydown);
      void opened();
    } else {
      window.removeEventListener("keydown", onKeydown);
      if (was) closed();
    }
  }, { immediate: true });

  onBeforeUnmount(() => {
    if (typeof window === "undefined") return;
    window.removeEventListener("keydown", onKeydown);
    if (isOpen()) closed();
  });
}
