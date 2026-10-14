/**
 * useAiChatWidth — the assistant drawer's width, which the user drags or
 * sets with the keyboard on its left edge (a WAI-ARIA window splitter).
 *
 * The width lives in `--wp-ai-chat-w` on the document root so the drawer
 * and the page margin that makes room for it on wide screens
 * (`AppLayout.vue`) read the same number. It is kept per browser in
 * localStorage; a width that no longer fits the window is clamped, not
 * saved.
 */
import { onBeforeUnmount, onMounted, ref } from "vue";

export const AI_CHAT_DEFAULT = 440;
export const AI_CHAT_MIN = 340;
const AI_CHAT_MAX = 960;
/** Room the sidebar and page keep beside the drawer: a page area of about
 *  520px (usePageWidth's narrow layouts), so no page is squeezed past them. */
const PAGE_MIN = 760;
const KEY = "wp-ai-chat-width";
const VAR = "--wp-ai-chat-w";
/** Keyboard step; Shift moves four. */
const STEP = 16;

export function maxWidth(viewport = window.innerWidth): number {
  return Math.max(AI_CHAT_MIN, Math.min(AI_CHAT_MAX, viewport - PAGE_MIN));
}

export function clampWidth(w: number, viewport = window.innerWidth): number {
  if (!Number.isFinite(w)) return AI_CHAT_DEFAULT;
  return Math.round(Math.min(maxWidth(viewport), Math.max(AI_CHAT_MIN, w)));
}

function stored(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v > 0 ? v : AI_CHAT_DEFAULT;
  } catch {
    return AI_CHAT_DEFAULT;
  }
}

function save(w: number): void {
  try {
    if (w === AI_CHAT_DEFAULT) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(w));
  } catch {
    /* localStorage unavailable: the width lasts this session */
  }
}

export function useAiChatWidth() {
  const saved = ref(stored());
  const width = ref(clampWidth(saved.value));
  const max = ref(maxWidth());
  const dragging = ref(false);

  function apply(): void {
    document.documentElement.style.setProperty(VAR, `${width.value}px`);
  }

  function set(w: number, keep = true): void {
    width.value = clampWidth(w);
    apply();
    if (keep) {
      saved.value = width.value;
      save(width.value);
    }
  }

  function reset(): void {
    set(AI_CHAT_DEFAULT);
  }

  let startX = 0;
  let startW = 0;

  function onMove(ev: PointerEvent): void {
    // The drawer is on the right: moving left makes it wider.
    set(startW + (startX - ev.clientX), false);
  }

  function onUp(): void {
    dragging.value = false;
    listen(false);
    grab(false);
    set(width.value);
  }

  function listen(on: boolean): void {
    const fn = on ? window.addEventListener : window.removeEventListener;
    fn("pointermove", onMove, true);
    fn("pointerup", onUp, true);
    fn("pointercancel", onUp, true);
  }

  /** The resize cursor everywhere, and no text selection, while dragging. */
  function grab(on: boolean): void {
    const style = document.documentElement.style;
    style.cursor = on ? "col-resize" : "";
    style.userSelect = on ? "none" : "";
  }

  function startDrag(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    ev.preventDefault();
    startX = ev.clientX;
    startW = width.value;
    dragging.value = true;
    grab(true);
    listen(true);
  }

  function onKey(ev: KeyboardEvent): void {
    const step = ev.shiftKey ? STEP * 4 : STEP;
    const to: Record<string, number> = {
      ArrowLeft: width.value + step, ArrowRight: width.value - step,
      Home: AI_CHAT_MIN, End: max.value, Enter: AI_CHAT_DEFAULT,
    };
    if (!(ev.key in to)) return;
    ev.preventDefault();
    set(to[ev.key]);
  }

  function onResize(): void {
    max.value = maxWidth();
    width.value = clampWidth(saved.value);
    apply();
  }

  onMounted(() => {
    apply();
    window.addEventListener("resize", onResize);
  });
  onBeforeUnmount(() => {
    window.removeEventListener("resize", onResize);
    if (dragging.value) {
      listen(false);
      grab(false);
    }
  });

  return { width, max, min: AI_CHAT_MIN, dragging, startDrag, onKey, reset };
}
