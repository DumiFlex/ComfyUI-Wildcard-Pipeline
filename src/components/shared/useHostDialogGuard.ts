/**
 * Let one of our overlays work on top of an open ComfyUI dialog.
 *
 * ComfyUI's Settings dialog is a reka-ui modal. While it is open, reka:
 *
 *   - sets `body.style.pointerEvents = "none"`, so an overlay teleported to
 *     body inherits `none` and every click falls through it (the Display
 *     Playground opened from Settings could not be clicked at all);
 *   - treats a pointerdown or a focus move outside its own panel as "outside"
 *     and closes the dialog;
 *   - traps focus: a `focusin` / `focusout` that leaves its panel is answered
 *     on `document` by focusing the last control inside the panel again;
 *   - closes on Escape from a window listener, unless the key event was
 *     already default-prevented.
 *
 * The guard answers each one, only while `isOpen()` and only for events that
 * involve `root`:
 *
 *   - `root` gets `pointer-events: auto` inline;
 *   - reka's `dismissableLayer.pointerDownOutside` / `.focusOutside` events
 *     are dispatched on the original target, so a capture listener on `root`
 *     sees them first and prevents them;
 *   - `focusin` inside `root` stops at `root` (inner handlers have run by
 *     then), and a `focusout` from the host dialog INTO `root` stops at body,
 *     so neither reaches reka's document listeners;
 *   - Escape is default-prevented in the capture phase, so our own Escape
 *     handler closes our overlay and the host dialog stays open.
 *
 * Nothing here names reka beyond its two event names, and every step is a
 * no-op when no host dialog is open.
 */
import { onBeforeUnmount, watch, type Ref } from "vue";

const OUTSIDE_EVENTS = ["dismissableLayer.pointerDownOutside", "dismissableLayer.focusOutside"];

export function useHostDialogGuard(root: Ref<HTMLElement | null | undefined>, isOpen: () => boolean): void {
  let bound: HTMLElement | null = null;

  const keepHostOpen = (e: Event): void => { e.preventDefault(); };
  const stopAtRoot = (e: Event): void => { e.stopPropagation(); };
  const stopAtBody = (e: Event): void => {
    const to = (e as FocusEvent).relatedTarget;
    if (bound && to instanceof Node && bound.contains(to)) e.stopPropagation();
  };
  const onEscape = (e: KeyboardEvent): void => {
    if (e.key === "Escape") e.preventDefault();
  };

  function unbind(): void {
    if (!bound) return;
    for (const name of OUTSIDE_EVENTS) bound.removeEventListener(name, keepHostOpen, true);
    bound.removeEventListener("focusin", stopAtRoot);
    bound.style.pointerEvents = "";
    document.body.removeEventListener("focusout", stopAtBody);
    window.removeEventListener("keydown", onEscape, true);
    bound = null;
  }

  function bind(el: HTMLElement): void {
    bound = el;
    el.style.pointerEvents = "auto";
    for (const name of OUTSIDE_EVENTS) el.addEventListener(name, keepHostOpen, true);
    el.addEventListener("focusin", stopAtRoot);
    document.body.addEventListener("focusout", stopAtBody);
    window.addEventListener("keydown", onEscape, true);
  }

  watch([root, isOpen], ([el, open]) => {
    if (typeof window === "undefined") return;
    if (el === bound && open) return;
    unbind();
    if (el && open) bind(el);
  }, { immediate: true, flush: "sync" });

  onBeforeUnmount(unbind);
}
