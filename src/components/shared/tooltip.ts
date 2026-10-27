/**
 * `v-tooltip`: a short hint shown on hover (after a short wait) and on
 * keyboard focus, hidden on leave, blur or Escape. Use it instead of
 * `title=`, which is slow, unstyled, never shows from the keyboard and is
 * cut off on the canvas.
 *
 *   <Button v-tooltip="'Copy the prompt'" icon="pi-copy" aria-label="Copy" />
 *   <span v-tooltip="{ text: 'Runs first', placement: 'right' }">…</span>
 *   <Button v-tooltip="{ text: 'Copy to clipboard', kbd: 'Ctrl C' }" … />
 *
 * One tooltip element is shared by the whole page, so a thousand hints
 * cost one node. State per element lives in a WeakMap (no expando keys).
 */
import type { Directive } from "vue";
import { placeFloating, viewportSize, type Placement } from "./floating";
import "./tooltip.css";

export type TooltipValue =
  | string
  | null
  | undefined
  | {
    text: string | null | undefined;
    placement?: Placement;
    /** A shortcut shown after the text, e.g. "Ctrl C". */
    kbd?: string;
  };

interface State {
  text: string;
  kbd: string;
  placement: Placement;
  timer: number | undefined;
  off: () => void;
}

const SHOW_DELAY = 450;
/** Moving from one hint to the next within this window shows it at once. */
const WARM_MS = 600;

const states = new WeakMap<HTMLElement, State>();
let tipEl: HTMLDivElement | null = null;
let owner: HTMLElement | null = null;
let lastHidden = 0;
let uid = 0;

function read(v: TooltipValue): { text: string; kbd: string; placement: Placement } {
  if (v && typeof v === "object") return { text: v.text ?? "", kbd: v.kbd ?? "", placement: v.placement ?? "top" };
  return { text: v ?? "", kbd: "", placement: "top" };
}

function tip(): HTMLDivElement {
  if (tipEl && tipEl.isConnected) return tipEl;
  tipEl = document.createElement("div");
  tipEl.className = "wp-tooltip";
  tipEl.id = `wp-tooltip-${++uid}`;
  tipEl.setAttribute("role", "tooltip");
  document.body.appendChild(tipEl);
  return tipEl;
}

function show(el: HTMLElement): void {
  const s = states.get(el);
  if (!s || !s.text || !el.isConnected) return;
  const t = tip();
  t.textContent = s.text;
  if (s.kbd) {
    const k = document.createElement("kbd");
    k.className = "wp-tooltip__kbd";
    k.textContent = s.kbd;
    t.append(" ", k);
  }
  t.dataset.open = "true";
  owner = el;
  const ids = (el.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
  if (!ids.includes(t.id)) el.setAttribute("aria-describedby", [...ids, t.id].join(" "));
  const at = placeFloating(el.getBoundingClientRect(), { width: t.offsetWidth, height: t.offsetHeight }, viewportSize(), {
    placement: s.placement,
  });
  t.style.left = `${at.x}px`;
  t.style.top = `${at.y}px`;
  t.dataset.side = at.side;
}

function hide(el: HTMLElement): void {
  const s = states.get(el);
  if (s?.timer !== undefined) { window.clearTimeout(s.timer); s.timer = undefined; }
  if (owner !== el) return;
  owner = null;
  lastHidden = Date.now();
  if (tipEl) {
    delete tipEl.dataset.open;
    const ids = (el.getAttribute("aria-describedby") ?? "").split(" ").filter((i) => i && i !== tipEl?.id);
    if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
    else el.removeAttribute("aria-describedby");
  }
}

function schedule(el: HTMLElement): void {
  const s = states.get(el);
  if (!s) return;
  if (s.timer !== undefined) window.clearTimeout(s.timer);
  const warm = owner !== null || Date.now() - lastHidden < WARM_MS;
  if (warm) { show(el); return; }
  s.timer = window.setTimeout(() => { s.timer = undefined; show(el); }, SHOW_DELAY);
}

export const vTooltip: Directive<HTMLElement, TooltipValue> = {
  mounted(el, binding) {
    const enter = (): void => schedule(el);
    const leave = (): void => hide(el);
    const focus = (): void => { if (el.matches(":focus-visible")) show(el); };
    const key = (ev: KeyboardEvent): void => { if (ev.key === "Escape" && owner === el) hide(el); };
    el.addEventListener("pointerenter", enter);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("pointerdown", leave);
    el.addEventListener("focusin", focus);
    el.addEventListener("focusout", leave);
    el.addEventListener("keydown", key);
    states.set(el, {
      ...read(binding.value),
      timer: undefined,
      off: () => {
        el.removeEventListener("pointerenter", enter);
        el.removeEventListener("pointerleave", leave);
        el.removeEventListener("pointerdown", leave);
        el.removeEventListener("focusin", focus);
        el.removeEventListener("focusout", leave);
        el.removeEventListener("keydown", key);
      },
    });
  },
  updated(el, binding) {
    const s = states.get(el);
    if (!s) return;
    Object.assign(s, read(binding.value));
    if (owner === el) { if (s.text) show(el); else hide(el); }
  },
  beforeUnmount(el) {
    hide(el);
    states.get(el)?.off();
    states.delete(el);
  },
};

export default vTooltip;
