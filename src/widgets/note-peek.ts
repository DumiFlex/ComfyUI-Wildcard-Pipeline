import { createApp, defineAsyncComponent, h, shallowRef, type App } from "vue";
import type { NoteConfig } from "../extension/note";

const NotePeek = defineAsyncComponent(() => import("../components/note/NotePeek.vue"));

/**
 * The hover card of a Label note. The note lets every press through to the
 * canvas (so it drags like a node), which also means the browser never sees
 * the pointer on it: no `:hover`, no `title` tooltip. So one window listener
 * hit-tests the label panels instead, at most once a frame, and shows a card
 * with the note's text and docs link. The card takes the pointer, so moving
 * onto it keeps it open and its buttons can be clicked.
 */
export interface PeekTarget {
  /** The label's panel, or null while it isn't on the page. */
  panel(): HTMLElement | null;
  config(): NoteConfig;
  title(): string;
  /** Not while the note is open in its editor. */
  active(): boolean;
  openDoc(id: string): void;
  edit(): void;
}

const SHOW_DELAY = 350;
const HIDE_DELAY = 250;

const targets = new Set<PeekTarget>();
const shown = shallowRef<PeekTarget | null>(null);
let pending: PeekTarget | null = null;
// A label that was just pressed (to drag or select it): no card for it until
// the pointer leaves it.
let pressed: PeekTarget | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let cardHost: HTMLElement | null = null;
let cardApp: App | null = null;
let raf = 0;
let last: PointerEvent | null = null;
let wired = false;

function inside(r: DOMRect, x: number, y: number): boolean {
  return r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** The label under the pointer, if nothing else is on top of it there. */
export function labelAt(x: number, y: number): PeekTarget | null {
  let hit: PeekTarget | null = null;
  for (const t of targets) {
    if (!t.active()) continue;
    const panel = t.panel();
    if (panel?.isConnected && inside(panel.getBoundingClientRect(), x, y)) hit = t;
  }
  if (!hit) return null;
  // The panel takes no pointer events, so the top element there is the
  // canvas (Classic) or the note's node (Nodes 2.0). Anything else, a menu,
  // a dialog or another node, is covering the label.
  const top = document.elementFromPoint(x, y);
  if (!top || top.tagName === "CANVAS") return hit;
  const node = hit.panel()?.closest(".lg-node");
  if (node && top.closest(".lg-node") === node) return hit;
  return hit.panel()?.contains(top) ? hit : null;
}

function clearTimers(): void {
  if (showTimer) { clearTimeout(showTimer); showTimer = null; }
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  pending = null;
}

export function hidePeek(): void {
  clearTimers();
  shown.value = null;
}

function mountCard(): void {
  if (cardApp) return;
  cardHost = document.createElement("div");
  cardHost.className = "wp-note-peek-host";
  document.body.appendChild(cardHost);
  cardApp = createApp({
    setup() {
      return () => {
        const t = shown.value;
        if (!t) return null;
        const panel = t.panel();
        if (!panel) return null;
        return h(NotePeek, {
          config: t.config(),
          title: t.title(),
          anchor: panel.getBoundingClientRect(),
          onOpenDoc: (id: string) => { hidePeek(); t.openDoc(id); },
          onEdit: () => { hidePeek(); t.edit(); },
        });
      };
    },
  });
  cardApp.mount(cardHost);
}

function overCard(x: number, y: number): boolean {
  const card = cardHost?.firstElementChild;
  return !!card && inside(card.getBoundingClientRect(), x, y);
}

function tick(): void {
  raf = 0;
  const e = last;
  if (!e) return;
  if (shown.value && overCard(e.clientX, e.clientY)) {
    clearTimers();
    return;
  }
  const t = labelAt(e.clientX, e.clientY);
  if (pressed && t !== pressed) pressed = null;
  if (t && t === pressed) return;
  if (t && t === shown.value) {
    clearTimers();
    return;
  }
  if (t) {
    if (t === pending) return;
    clearTimers();
    pending = t;
    showTimer = setTimeout(() => {
      showTimer = null;
      pending = null;
      if (!t.active()) return;
      mountCard();
      shown.value = t;
    }, shown.value ? 0 : SHOW_DELAY);
    return;
  }
  if (pending) clearTimers();
  if (shown.value && !hideTimer) hideTimer = setTimeout(() => { hideTimer = null; shown.value = null; }, HIDE_DELAY);
}

function wire(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("pointermove", (e) => {
    last = e;
    // A drag (of the note, the canvas or anything else) closes it.
    if (e.buttons) {
      if (shown.value || pending) hidePeek();
      return;
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }, { capture: true, passive: true });
  window.addEventListener("pointerdown", (e) => {
    if (overCard(e.clientX, e.clientY)) return;
    pressed = labelAt(e.clientX, e.clientY);
    hidePeek();
  }, true);
  window.addEventListener("wheel", (e) => {
    if (!overCard(e.clientX, e.clientY)) hidePeek();
  }, { capture: true, passive: true });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") hidePeek(); }, true);
  window.addEventListener("blur", hidePeek);
}

/** Track a note for the hover card. Returns the function that stops it. */
export function trackPeek(t: PeekTarget): () => void {
  wire();
  targets.add(t);
  return () => {
    targets.delete(t);
    if (shown.value === t || pending === t) hidePeek();
  };
}
