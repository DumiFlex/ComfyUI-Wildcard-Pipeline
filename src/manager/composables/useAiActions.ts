/**
 * useAiActions — what the chat's page tools do in the browser.
 *
 * When the model calls a page tool the server checks the call, pauses the
 * turn and hands it here (`useAiChat` runs it): open a page, read what the
 * page offers, point at part of it, or hand work to a page's own AI feature
 * (draft options in the wildcard editor, organize rows on a list, run the
 * Test Runner). The text each returns is what the model reads back.
 *
 * Pages offer delegates with `registerAiAction` while they are mounted, the
 * same way editors register with `registerOpenEditor`. Parts worth pointing
 * at carry `data-ai-anchor` (plus `data-ai-label`); Settings rows count
 * through their `data-setting` key and sidebar links through `data-nav-id`.
 *
 * See `/pr-drafts/ai-client-tools.md`.
 */
import { nextTick, onBeforeUnmount, shallowRef } from "vue";
import type { AiChatPage, AiPendingCall } from "../api/types";
import { currentPageNote } from "./useOpenEditor";

/** Where an item opens, by the type the server gives. */
export const EDIT_ROUTES: Record<string, string> = {
  wildcard: "wildcards-edit",
  combine: "combines-edit",
  derivation: "derivations-edit",
  constraint: "constraints-edit",
  fixed_values: "fixed-values-edit",
  bundle: "bundles-edit",
  template: "templates-edit",
};

/** A route to go to, in vue-router's terms. */
export type AiRoute = { name: string; params?: Record<string, string> };

/** What the chat needs from the app to run page tools (set by the drawer). */
export interface AiActionHost {
  /** Go somewhere; resolves false when the user stayed (unsaved changes). */
  navigate(to: AiRoute): Promise<boolean>;
  /** Whether a route name exists. */
  hasRoute(name: string): boolean;
  page(): AiChatPage;
}

export type AiDelegate = "draft_options" | "select_rows" | "organize" | "show_test";

interface Registered {
  run: (args: Record<string, unknown>) => Promise<string>;
  /** Whether this page instance is the one for these args (the right item,
   *  rows it lists). */
  owns: (args: Record<string, unknown>) => boolean;
}

const delegates = new Map<AiDelegate, Registered>();

/** Offer a delegate while the calling component is mounted (call in setup). */
export function registerAiAction(
  name: AiDelegate,
  run: Registered["run"],
  owns: Registered["owns"] = () => true,
): void {
  const entry: Registered = { run, owns };
  delegates.set(name, entry);
  onBeforeUnmount(() => {
    if (delegates.get(name) === entry) delegates.delete(name);
  });
}

/* ── Pointing ──────────────────────────────────────────────────────────── */

export interface AiPointer {
  el: HTMLElement;
  caption: string;
  key: string;
}

/** The part of the page the model pointed at, drawn by `AiPointer.vue`. */
export const pointer = shallowRef<AiPointer | null>(null);

export function clearPointer(): void {
  pointer.value = null;
}

const MAX_ANCHORS = 40;
/** How long to wait for a page (or its part) to show up. */
const WAIT_MS = 4000;
const SKIP = ".wp-ai-chat";

function visible(el: HTMLElement): boolean {
  return el.isConnected && el.getClientRects().length > 0 && !el.closest(SKIP);
}

function labelOf(el: HTMLElement): string {
  const own = el.getAttribute("data-ai-label") ?? el.getAttribute("aria-label");
  const text = own ?? el.querySelector(".wp-set-row__label, .wp-nav__label")?.textContent
    ?? el.textContent ?? "";
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > 60 ? `${one.slice(0, 59)}…` : one;
}

/** Every part of the page the model may point at, by key. */
export function anchors(root: ParentNode = document): Array<{ key: string; label: string; el: HTMLElement }> {
  const out: Array<{ key: string; label: string; el: HTMLElement }> = [];
  const seen = new Set<string>();
  const add = (key: string | null, el: HTMLElement, prefix = ""): void => {
    if (!key || seen.has(prefix + key) || !visible(el)) return;
    seen.add(prefix + key);
    out.push({ key: prefix + key, label: labelOf(el), el });
  };
  for (const el of root.querySelectorAll<HTMLElement>("[data-ai-anchor]")) add(el.getAttribute("data-ai-anchor"), el);
  for (const el of root.querySelectorAll<HTMLElement>("[data-setting]")) add(el.getAttribute("data-setting"), el);
  for (const el of root.querySelectorAll<HTMLElement>("[data-nav-id]")) add(el.getAttribute("data-nav-id"), el, "nav-");
  return out.slice(0, MAX_ANCHORS);
}

function findAnchor(key: string): HTMLElement | null {
  return anchors().find((a) => a.key === key)?.el ?? null;
}

function readPage(host: AiActionHost): string {
  const p = host.page();
  const lines = [`Page: ${p.route}${p.id ? ` (item ${p.id})` : ""}${p.doc ? ` (docs ${p.doc})` : ""}`];
  const note = currentPageNote() || p.note;
  if (note) lines.push(note);
  const list = anchors();
  if (list.length) {
    lines.push("Parts you can point at with highlight:");
    for (const a of list) lines.push(`[${a.key}] ${a.label}`);
  } else {
    lines.push("Nothing on this page is marked to point at.");
  }
  return lines.join("\n");
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

async function highlight(key: string, caption: string): Promise<string> {
  // A page that just opened may still be loading its parts.
  let el = findAnchor(key);
  for (let waited = 0; !el && waited < WAIT_MS / 2; waited += 100) {
    await new Promise((r) => setTimeout(r, 100));
    el = findAnchor(key);
  }
  if (!el) return `no part "${key}" on this page; call read_page for the list`;
  el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  pointer.value = { el, caption, key };
  return `pointed at ${labelOf(el) || key}`;
}

/* ── Running a call ────────────────────────────────────────────────────── */

/** Let a page that just opened render: until its parts stop changing
 *  (lazy sections load after the route does), at most two seconds. */
async function settle(): Promise<void> {
  await nextTick();
  let last = -1;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const now = document.querySelectorAll("[data-ai-anchor],[data-setting],[data-test]").length;
    if (now === last) return;
    last = now;
  }
}

/** The delegate for these args once its page is mounted, else null. */
async function waitFor(name: AiDelegate, args: Record<string, unknown>): Promise<Registered | null> {
  const end = Date.now() + WAIT_MS;
  for (;;) {
    const d = delegates.get(name);
    if (d && d.owns(args)) return d;
    if (Date.now() > end) return null;
    await new Promise((r) => setTimeout(r, 80));
  }
}

function delegatePage(call: AiPendingCall): AiRoute {
  if (call.tool === "draft_options") return { name: EDIT_ROUTES.wildcard, params: { id: call.args.id } };
  if (call.tool === "show_test") return { name: "test" };
  return { name: "all" };
}

async function go(host: AiActionHost, to: AiRoute): Promise<string> {
  if (!host.hasRoute(to.name)) return `couldn't: there is no page ${to.name}`;
  const ok = await host.navigate(to);
  await settle();
  return ok ? "" : "couldn't: the user stayed on the page (it has unsaved changes)";
}

function openTarget(call: Extract<AiPendingCall, { tool: "open" }>): AiRoute | null {
  const a = call.args;
  if ("doc" in a) return { name: "documentation-page", params: { page: a.doc } };
  if ("page" in a) {
    return a.page === "settings" ? { name: "settings", params: { section: a.section ?? "" } }
      : { name: a.page };
  }
  const name = EDIT_ROUTES[a.type];
  return name ? { name, params: { id: a.id } } : null;
}

/** Run one page tool; the text is what the model reads back. Web search
 *  isn't run here (the server runs it once the user allows it). */
export async function runCall(call: AiPendingCall, host: AiActionHost): Promise<string> {
  try {
    switch (call.tool) {
      case "open": {
        const to = openTarget(call);
        if (!to) return "couldn't: that item has no editor";
        clearPointer();
        return (await go(host, to)) || "opened";
      }
      case "read_page":
        return readPage(host);
      case "highlight":
        return await highlight(call.args.anchor, call.args.caption);
      case "web_search":
        return "couldn't: web search runs on the server";
      default: {
        const args = call.args as Record<string, unknown>;
        const here = delegates.get(call.tool);
        let d = here && here.owns(args) ? here : null;
        if (!d) {
          const err = await go(host, delegatePage(call));
          if (err) return err;
          d = await waitFor(call.tool, args);
        }
        if (!d) return "couldn't: that page didn't open";
        clearPointer();
        return await d.run(args);
      }
    }
  } catch (err) {
    return `couldn't: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Test seam. */
export function _resetAiActionsForTests(): void {
  delegates.clear();
  pointer.value = null;
}
