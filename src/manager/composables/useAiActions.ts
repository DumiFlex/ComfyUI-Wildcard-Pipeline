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
 * Everything else in the page area is found without markup (headings,
 * buttons, fields, images, paragraphs, code, table rows), and `highlight`
 * can mark quoted words inside a part. See `/pr-drafts/ai-pointer-research.md`.
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
  /** The quoted words inside the part, when the model marked some. */
  range?: Range;
}

/** The parts of the page the model pointed at, drawn by `AiPointer.vue`. */
export const pointers = shallowRef<AiPointer[]>([]);

export function clearPointer(): void {
  if (pointers.value.length) pointers.value = [];
}

/** How long to wait for a page (or its part) to show up. */
const WAIT_MS = 4000;
const SKIP = ".wp-ai-chat, .wp-ai-pointer";
/** Most parts each list in `read_page` shows. */
const MAX_MARKED = 60;
const MAX_TOP = 50;
const MAX_WITHIN = 80;
/** Longest label kept per part. */
const LABEL = 90;

function visible(el: HTMLElement): boolean {
  return el.isConnected && el.getClientRects().length > 0 && !el.closest(SKIP)
    && !el.closest("[aria-hidden='true'], [hidden]");
}

function clip(text: string, n = LABEL): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

function labelOf(el: HTMLElement): string {
  const own = el.getAttribute("data-ai-label") ?? el.getAttribute("aria-label");
  // A collapsed sidebar shows only icons; its links keep their name in title.
  const text = own ?? el.querySelector(".wp-set-row__label, .wp-nav__label")?.textContent
    ?? (el.textContent?.trim() || el.getAttribute("title") || "");
  return clip(text, 60);
}

export interface PagePart { key: string; label: string; el: HTMLElement }

/** The parts marked to point at (`data-ai-anchor`, Settings rows, sidebar
 *  links), by key. */
export function anchors(root: ParentNode = document): PagePart[] {
  const out: PagePart[] = [];
  const seen = new Set<string>();
  const add = (key: string | null, el: HTMLElement, prefix = ""): void => {
    if (!key || seen.has(prefix + key) || !visible(el)) return;
    seen.add(prefix + key);
    out.push({ key: prefix + key, label: labelOf(el), el });
  };
  for (const el of root.querySelectorAll<HTMLElement>("[data-ai-anchor]")) add(el.getAttribute("data-ai-anchor"), el);
  for (const el of root.querySelectorAll<HTMLElement>("[data-setting]")) add(el.getAttribute("data-setting"), el);
  for (const el of root.querySelectorAll<HTMLElement>("[data-nav-id]")) add(el.getAttribute("data-nav-id"), el, "nav-");
  return out;
}

/* Parts found without markup, in reading order. A part's kind decides its
   key: headings, buttons and fields by their words (they survive a
   re-render), the rest by their place among their kind. */
type Kind = "h" | "btn" | "field" | "img" | "code" | "note" | "p" | "item" | "row";
const KINDS: Array<[Kind, string]> = [
  ["h", "h1,h2,h3,h4,h5,[role=heading]"],
  ["row", "tr,[role=row]"],
  ["btn", "button,a[href],[role=button],[role=tab],[role=link],[role=menuitem]"],
  ["field", "input:not([type=hidden]),textarea,select,[role=switch],[role=combobox],[role=slider],[role=checkbox],[contenteditable=true]"],
  ["img", "img,figure,svg[role=img],video,canvas"],
  ["code", "pre"],
  ["note", "blockquote,[role=note],[role=alert],.wp-callout,.wp-doc-callout"],
  ["p", "p,dd,figcaption"],
  ["item", "li"],
];
const ALL = KINDS.map(([, sel]) => sel).join(",");
/** Kinds `read_page` lists up top; the rest only show with `within`. */
const TOP: ReadonlySet<Kind> = new Set(["h", "btn", "field", "img"]);
const NAMES: Record<Kind, [string, string]> = {
  h: ["heading", "headings"], btn: ["button", "buttons"], field: ["field", "fields"],
  img: ["image", "images"], code: ["code block", "code blocks"], note: ["note", "notes"],
  p: ["paragraph", "paragraphs"], item: ["list item", "list items"], row: ["row", "rows"],
};

interface AutoPart extends PagePart { kind: Kind; level: number }

function kindOf(el: Element): Kind | null {
  for (const [kind, sel] of KINDS) if (el.matches(sel)) return kind;
  return null;
}

function slug(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim()
    .replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 32) || "x";
}

/** What a field is for: its own label, the label pointing at it, the
 *  Settings row or table column it sits in, its placeholder. */
function fieldName(el: HTMLElement): string {
  const input = el as HTMLInputElement;
  const own = el.getAttribute("aria-label") || el.getAttribute("data-ai-label")
    || input.labels?.[0]?.textContent
    || el.closest("label")?.textContent
    || el.closest("[data-setting]")?.querySelector(".wp-set-row__label")?.textContent
    || el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || "";
  return clip(own, 50);
}

function fieldValue(el: HTMLElement): string {
  const input = el as HTMLInputElement;
  if (input.type === "checkbox" || input.type === "radio") return input.checked ? "on" : "off";
  const sw = el.getAttribute("aria-checked");
  if (sw) return sw === "true" ? "on" : "off";
  if (el.isContentEditable) return el.textContent ?? "";
  if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.textContent ?? "";
  return typeof input.value === "string" ? input.value : el.textContent ?? "";
}

/** A row's words, the values typed in its fields included. */
function rowText(el: HTMLElement): string {
  const parts: string[] = [];
  const walk = (n: Node): void => {
    if (n.nodeType === Node.TEXT_NODE) { parts.push(n.textContent ?? ""); return; }
    if (!(n instanceof HTMLElement) || n.closest(SKIP) || n.getAttribute("aria-hidden") === "true") return;
    if (n.matches("input,textarea,select")) { parts.push(` ${fieldValue(n)} `); return; }
    for (const c of n.childNodes) walk(c);
  };
  walk(el);
  return parts.join(" ");
}

function autoLabel(kind: Kind, el: HTMLElement): string {
  switch (kind) {
    case "field": {
      const name = fieldName(el);
      const value = clip(fieldValue(el), 40);
      return value ? `${name || "field"} = "${value}"` : name || "field";
    }
    case "img":
      return clip(el.getAttribute("alt") || el.querySelector("img")?.getAttribute("alt")
        || el.querySelector("figcaption")?.textContent || el.getAttribute("aria-label")
        || el.getAttribute("title") || "image");
    case "btn":
      return clip(el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || "", 60);
    case "row":
      return clip(rowText(el));
    default:
      return clip(el.textContent ?? "");
  }
}

/** Where unmarked parts are looked for: the page area plus open dialogs. */
function roots(): HTMLElement[] {
  const main = document.getElementById("wp-main");
  const out = [main ?? document.body];
  for (const d of document.querySelectorAll<HTMLElement>("[role=dialog],[aria-modal=true]")) {
    if (!out.some((r) => r.contains(d)) && visible(d)) out.push(d);
  }
  return out;
}

/** Every unmarked part, in reading order. */
function autoParts(): AutoPart[] {
  const out: AutoPart[] = [];
  const used = new Set<string>();
  const counts: Partial<Record<Kind, number>> = {};
  for (const root of roots()) {
    for (const el of root.querySelectorAll<HTMLElement>(ALL)) {
      const kind = kindOf(el);
      if (!kind || !visible(el)) continue;
      // Nested copies: a paragraph inside a list item or note, an image in a
      // figure, a heading's own link.
      if ((kind === "p" && el.parentElement?.closest("li,blockquote,td,th,figure,button"))
        || (kind === "img" && el.tagName !== "FIGURE" && el.closest("figure,button,a"))
        || (kind === "btn" && el.closest("h1,h2,h3,h4,h5"))
        || (kind === "field" && el.closest("[role=combobox]") && el.getAttribute("role") !== "combobox")) continue;
      const label = autoLabel(kind, el);
      if (!label && kind !== "img") continue;
      let key: string;
      if (kind === "h" || kind === "btn" || kind === "field") {
        const base = `${kind}-${slug(kind === "field" ? fieldName(el) || label : label)}`;
        key = base;
        for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
      } else {
        counts[kind] = (counts[kind] ?? 0) + 1;
        key = `${kind}-${counts[kind]}`;
      }
      used.add(key);
      const level = kind === "h"
        ? Number(el.getAttribute("aria-level")) || Number(el.tagName.slice(1)) || 2 : 0;
      out.push({ key, label, el, kind, level });
    }
  }
  return out;
}

/** Marked parts first, then the found ones; one key each. */
function allParts(): Array<PagePart & { kind?: Kind }> {
  const marked = anchors();
  const keys = new Set(marked.map((a) => a.key));
  const els = new Set(marked.map((a) => a.el));
  return [...marked, ...autoParts().filter((p) => !keys.has(p.key) && !els.has(p.el))];
}

function findPart(key: string): HTMLElement | null {
  return allParts().find((a) => a.key === key)?.el ?? null;
}

/** The parts a heading's section holds: those after it up to the next
 *  heading of the same or a higher level. */
function sectionOf(parts: AutoPart[], i: number): AutoPart[] {
  const head = parts[i];
  const out: AutoPart[] = [];
  for (const p of parts.slice(i + 1)) {
    if (p.kind === "h" && p.level <= head.level) break;
    out.push(p);
  }
  return out;
}

function tally(parts: AutoPart[]): string {
  const n: Partial<Record<Kind, number>> = {};
  for (const p of parts) if (p.kind !== "h") n[p.kind] = (n[p.kind] ?? 0) + 1;
  return (Object.entries(n) as Array<[Kind, number]>)
    .map(([k, c]) => `${c} ${NAMES[k][c === 1 ? 0 : 1]}`).join(", ");
}

function readPage(host: AiActionHost, within = ""): string {
  if (within) return readWithin(within);
  const p = host.page();
  const lines = [`Page: ${p.route}${p.id ? ` (item ${p.id})` : ""}${p.doc ? ` (docs ${p.doc})` : ""}`];
  const note = currentPageNote() || p.note;
  if (note) lines.push(note);
  const marked = anchors();
  const els = new Set(marked.map((a) => a.el));
  const auto = autoParts().filter((a) => !els.has(a.el));
  if (marked.length) {
    lines.push("Marked parts:");
    for (const a of marked.slice(0, MAX_MARKED)) lines.push(`[${a.key}] ${a.label}`);
    if (marked.length > MAX_MARKED) lines.push(`… ${marked.length - MAX_MARKED} more`);
  }
  const heads = auto.map((a, i) => [a, i] as const).filter(([a]) => a.kind === "h");
  if (heads.length) {
    lines.push("Sections:");
    for (const [a, i] of heads.slice(0, MAX_TOP)) {
      const inside = tally(sectionOf(auto, i));
      lines.push(`${"  ".repeat(Math.max(0, a.level - 1))}[${a.key}] ${a.label}${inside ? ` (${inside})` : ""}`);
    }
  }
  // Buttons and fields inside table rows show with their row.
  const top = auto.filter((a) => TOP.has(a.kind) && a.kind !== "h" && !a.el.closest("tr,[role=row]"));
  if (top.length) {
    lines.push("Buttons, fields and images:");
    for (const a of top.slice(0, MAX_TOP)) lines.push(`[${a.key}] ${a.label}`);
    if (top.length > MAX_TOP) lines.push(`… ${top.length - MAX_TOP} more (read_page with within lists a section's)`);
  }
  const rest = tally(auto.filter((a) => !TOP.has(a.kind)));
  if (rest) lines.push(`Also on the page: ${rest}.`);
  if (marked.length + auto.length === 0) {
    lines.push("Nothing on this page can be pointed at.");
  } else {
    lines.push('read_page {"within": key} lists everything inside a section or part with its text; '
      + 'highlight takes "text" to mark words inside a part.');
  }
  return lines.join("\n");
}

function readWithin(key: string): string {
  const auto = autoParts();
  const i = auto.findIndex((a) => a.key === key);
  const el = i >= 0 ? auto[i].el : findPart(key);
  if (!el) return `no part "${key}" on this page; call read_page for the list`;
  const inside = i >= 0 && auto[i].kind === "h" ? sectionOf(auto, i)
    : auto.filter((a) => a.el !== el && el.contains(a.el));
  const marked = anchors().filter((a) => a.el !== el && el.contains(a.el));
  const lines = [`Inside [${key}] ${i >= 0 ? auto[i].label : labelOf(el)}:`];
  const list = [...marked.map((a) => `[${a.key}] ${a.label}`),
    ...inside.map((a) => `[${a.key}] ${a.kind === "h" ? "§ " : ""}${a.label}`)];
  if (!list.length) {
    lines.push(clip(el.textContent ?? "", 600) || "(nothing inside to point at)");
    return lines.join("\n");
  }
  lines.push(...list.slice(0, MAX_WITHIN));
  if (list.length > MAX_WITHIN) lines.push(`… ${list.length - MAX_WITHIN} more`);
  return lines.join("\n");
}

/* ── Marking words inside a part ── */

const FOLD: Record<string, string> = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", " ": " " };

/** A Range over the first place `quote` appears in `el`, ignoring case,
 *  spacing and curly quotes; null when it isn't there. */
export function findText(el: HTMLElement, quote: string): Range | null {
  const map: Array<[Text, number]> = [];
  let flat = "";
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (n.parentElement?.closest("script,style")) continue;
    const t = n.data;
    for (let i = 0; i < t.length; i++) {
      let c = FOLD[t[i]] ?? t[i];
      if (/\s/.test(c)) {
        if (flat.endsWith(" ") || !flat) continue;
        c = " ";
      }
      flat += c.toLowerCase();
      map.push([n, i]);
    }
  }
  const norm = (q: string): string => [...q].map((c) => FOLD[c] ?? c).join("")
    .replace(/\s+/g, " ").trim().toLowerCase();
  let q = norm(quote);
  let at = q ? flat.indexOf(q) : -1;
  // A quote the model shortened or reworded at the end: its opening words.
  if (at < 0 && q.length > 40) {
    q = q.slice(0, 40).replace(/\s\S*$/, "");
    at = flat.indexOf(q);
  }
  if (at < 0) return null;
  const range = document.createRange();
  const [sNode, sOff] = map[at];
  const [eNode, eOff] = map[at + q.length - 1];
  range.setStart(sNode, sOff);
  range.setEnd(eNode, eOff + 1);
  return range;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface PointArgs { anchor: string; caption: string; text?: string }

async function highlight(points: PointArgs[]): Promise<string> {
  // A page that just opened may still be loading its parts.
  let first = findPart(points[0].anchor);
  for (let waited = 0; !first && waited < WAIT_MS / 2; waited += 100) {
    await new Promise((r) => setTimeout(r, 100));
    first = findPart(points[0].anchor);
  }
  const shown: AiPointer[] = [];
  const said: string[] = [];
  for (const pt of points) {
    const el = findPart(pt.anchor);
    if (!el) {
      said.push(`no part "${pt.anchor}" on this page`);
      continue;
    }
    let range: Range | undefined;
    let note = "";
    if (pt.text) {
      range = findText(el, pt.text) ?? undefined;
      if (!range) note = ` (the words "${clip(pt.text, 40)}" aren't in it, so the whole part is outlined)`;
    }
    shown.push({ el, caption: pt.caption, key: pt.anchor, range });
    said.push(`pointed at ${range ? `"${clip(range.toString(), 50)}" in ` : ""}${labelOf(el) || pt.anchor}${note}`);
  }
  if (!shown.length) return `${said.join("; ")}; call read_page for the list`;
  const target = shown[0].range?.startContainer.parentElement ?? shown[0].el;
  target.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  pointers.value = shown;
  return said.join("; ");
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
  if ("proposal" in a) return null;
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
        return readPage(host, call.args.within ?? "");
      case "highlight": {
        // Calls stored before points existed carry one anchor.
        const a = call.args;
        const points = "points" in a && Array.isArray(a.points) ? a.points
          : "anchor" in a ? [{ anchor: a.anchor, caption: a.caption }] : [];
        if (!points.length) return "couldn't: no part named";
        return await highlight(points);
      }
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
  pointers.value = [];
}
