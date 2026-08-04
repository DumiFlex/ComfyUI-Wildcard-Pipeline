import { onBeforeUnmount, watch, type Ref } from "vue";

/**
 * Stop keystrokes inside one of our modals from reaching ComfyUI's global
 * shortcuts.
 *
 * ComfyUI binds `useEventListener(window, 'keydown', keybindHandler)` and only
 * bails for text-editing targets:
 *
 *     const target = event.composedPath()[0]
 *     if (keyCombo.isReservedByTextInput &&
 *         (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' ||
 *          target.contentEditable === 'true' || ...)) return
 *
 * So a plain letter pressed while focus sits on a button or a div inside our
 * modal is not "reserved by text input" and runs the global keybinding —
 * pressing `r` in an edit modal fired Refresh Node Definitions and froze the
 * page. Its other guard, which skips global keybindings while a dialog is
 * open, keys off ComfyUI's OWN dialog stack, which our modals never enter.
 *
 * The listener is bound to the modal ROOT in bubble phase. Anything inside the
 * modal has already had its turn by then — inner `@keydown` handlers, input
 * defaults, IME — and the event simply stops before it can climb to window.
 *
 * That alone is not enough, because a key only traverses the overlay if it is
 * TARGETED inside it. Open a modal and type without clicking in it first and
 * `document.activeElement` is still `<body>`, so the event goes body → window
 * and never passes the shield at all — which is how `a` kept reaching ComfyUI
 * even with the root listener in place. Two additions close that:
 *
 *   - focus the overlay when it opens, so keystrokes land inside the modal;
 *   - guard at the document for keys targeted OUTSIDE the open modal, since a
 *     modal owns the keyboard while it is up. Escape still passes, so the
 *     modal's own window-level close handler keeps working.
 *
 * Because of that, a modal's own key handling must live on the root too, not
 * on `window`: a window listener sits ABOVE the shield and would never see
 * keys pressed inside its own modal. `onKey` is where that logic goes.
 */
export interface ModalKeyShieldOptions {
  /** Runs for every keydown inside the modal, before the event is stopped. */
  onKey?: (event: KeyboardEvent) => void;
  /**
   * Let a key through to the rest of the page. Use sparingly — the point of
   * the shield is that a modal owns the keyboard while it is open.
   */
  passThrough?: (event: KeyboardEvent) => boolean;
}

/** Wire the shield to a root element that exists only while the modal is open. */
export function useModalKeyShield(
  root: Ref<HTMLElement | null | undefined>,
  options: ModalKeyShieldOptions = {},
): void {
  let bound: HTMLElement | null = null;

  const onKeydown = (event: KeyboardEvent): void => {
    options.onKey?.(event);
    if (options.passThrough?.(event)) return;
    // stopPropagation only: the default action still happens, so typing,
    // shortcuts inside inputs and IME composition all behave normally.
    event.stopPropagation();
  };

  // Keyup carries no handling of ours, but extensions bind shortcuts on it
  // and a half-seen chord is worse than none.
  const onKeyup = (event: KeyboardEvent): void => {
    if (options.passThrough?.(event)) return;
    event.stopPropagation();
  };

  // Keys aimed outside the open modal — the canvas, the body — never reach the
  // overlay, so they are stopped here instead. Document bubble runs before
  // window, where ComfyUI's keybindHandler lives.
  const onOutside = (event: KeyboardEvent): void => {
    if (!bound) return;
    const target = event.target;
    if (target instanceof Node && bound.contains(target)) return;
    // Escape belongs to whoever wants to close something.
    if (event.key === "Escape") return;
    if (options.passThrough?.(event)) return;
    event.stopPropagation();
  };

  const detach = (): void => {
    if (!bound) return;
    bound.removeEventListener("keydown", onKeydown);
    bound.removeEventListener("keyup", onKeyup);
    document.removeEventListener("keydown", onOutside);
    document.removeEventListener("keyup", onOutside);
    bound = null;
  };

  watch(
    root,
    (el) => {
      detach();
      if (!el) return;
      bound = el;
      el.addEventListener("keydown", onKeydown);
      el.addEventListener("keyup", onKeyup);
      document.addEventListener("keydown", onOutside);
      document.addEventListener("keyup", onOutside);
      // Pull focus in, so typing lands inside the modal rather than on <body>.
      // Only when focus is not already somewhere inside — an autofocused input
      // must keep it.
      if (!el.contains(document.activeElement)) {
        if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
        el.focus({ preventScroll: true });
      }
    },
    { immediate: true, flush: "post" },
  );

  onBeforeUnmount(detach);
}
