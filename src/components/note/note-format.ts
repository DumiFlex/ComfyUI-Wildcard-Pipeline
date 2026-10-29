/**
 * The WP Note text syntax on top of Markdown, and the toolbar's edits.
 *
 *   [text](https://…)              a link, opens in a new tab
 *   [text](docs:page#s-section)    a link to the built-in docs (section optional)
 *   [text](target){button}         the link drawn as a button
 *   [text](target){button pi-book} … with an icon
 *   [text](target){button pi-book #e11d48}  … in its own colour
 *   [text](target){#e11d48}        a text link in its own colour
 *   :pi-cog:  :pi-cog:{#e11d48}    a PrimeIcons glyph, optionally coloured
 *
 * The `{…}` blocks follow the attribute lists of MkDocs Material and Pandoc.
 * Pure functions: the renderer (note-markdown.ts) and the editor share them.
 */
import { PI_ICON_SET } from "./pi-icons";

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export type LinkTarget =
  | { kind: "web"; href: string }
  | { kind: "docs"; page: string; section: string }
  | { kind: "none" };

/** What a link's target points at. Only http(s) and docs: links are links. */
export function parseTarget(href: string): LinkTarget {
  const h = href.trim();
  const docs = /^docs:([a-z0-9-]+)(?:#([a-z0-9-]+))?$/i.exec(h);
  if (docs?.[1]) return { kind: "docs", page: docs[1].toLowerCase(), section: docs[2]?.toLowerCase() ?? "" };
  if (/^https?:\/\/[^\s]+$/i.test(h)) return { kind: "web", href: h };
  return { kind: "none" };
}

/** The address a target opens: the manager's docs page on this ComfyUI. */
export function targetUrl(t: LinkTarget, origin: string): string | null {
  if (t.kind === "web") return t.href;
  if (t.kind === "docs") return `${origin}/wp/docs/${encodeURIComponent(t.page)}${t.section ? `#${t.section}` : ""}`;
  return null;
}

export interface LinkAttrs { button: boolean; icon: string; color: string }

/**
 * A `{button}` / `{button pi-book #e11d48}` / `{#e11d48}` block at the start
 * of the text after a link. Returns the attributes and how many characters
 * it took, or null. A colour alone keeps the link a text link.
 */
export function readLinkAttrs(after: string): { attrs: LinkAttrs; length: number } | null {
  const m = /^\{\s*(button)?(?:\s*pi-([a-z0-9-]+))?(?:\s*(#[0-9a-f]{6}|#[0-9a-f]{3}))?\s*\}/i.exec(after);
  if (!m || (!m[1] && !m[3]) || (!m[1] && m[2])) return null;
  const name = m[2]?.toLowerCase() ?? "";
  const icon = name && PI_ICON_SET.has(name) ? name : "";
  return { attrs: { button: !!m[1], icon, color: m[3]?.toLowerCase() ?? "" }, length: m[0].length };
}

export type IconPiece = string | { icon: string; color: string };

const ICON_RE = /:pi-([a-z0-9-]+):(?:\{(#[0-9a-f]{3,6})\})?/gi;

/** Splits text into plain runs and known `:pi-name:` icons. */
export function splitIcons(text: string): IconPiece[] {
  const out: IconPiece[] = [];
  let last = 0;
  for (const m of text.matchAll(ICON_RE)) {
    const name = (m[1] ?? "").toLowerCase();
    if (!PI_ICON_SET.has(name)) continue;
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push({ icon: name, color: m[2] && HEX.test(m[2]) ? m[2].toLowerCase() : "" });
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ── writing ────────────────────────────────────────────────────────────

/** The Markdown for a link. The parser ends link text at the first `]`, so
 *  brackets in the text become parentheses. */
export function linkMarkdown(
  text: string,
  target: string,
  opts: { button?: boolean; icon?: string; color?: string } = {},
): string {
  const label = (text.trim() || target).replace(/\[/g, "(").replace(/\]/g, ")").replace(/\n+/g, " ");
  const color = opts.color && HEX.test(opts.color) ? opts.color.toLowerCase() : "";
  const parts = [opts.button ? "button" : "", opts.button && opts.icon ? `pi-${opts.icon}` : "", color].filter(Boolean);
  return `[${label}](${target.trim()})${parts.length ? `{${parts.join(" ")}}` : ""}`;
}

export function iconMarkdown(icon: string, color = ""): string {
  return `:pi-${icon}:${color && HEX.test(color) ? `{${color.toLowerCase()}}` : ""}`;
}

export function docsTarget(page: string, section = ""): string {
  return `docs:${page}${section ? `#${section}` : ""}`;
}

/** A text edit: the new value and the selection to put back. */
export interface Edit { value: string; start: number; end: number }

/** Wraps the selection in `mark` (or takes it off when already wrapped). */
export function wrap(value: string, start: number, end: number, mark: string, placeholder: string): Edit {
  const before = value.slice(0, start);
  const sel = value.slice(start, end);
  const after = value.slice(end);
  if (before.endsWith(mark) && after.startsWith(mark)) {
    return { value: before.slice(0, -mark.length) + sel + after.slice(mark.length), start: start - mark.length, end: end - mark.length };
  }
  const inner = sel || placeholder;
  return { value: before + mark + inner + mark + after, start: start + mark.length, end: start + mark.length + inner.length };
}

/** Puts `prefix` before every selected line (`1. ` counts up), or takes it off. */
export function prefixLines(value: string, start: number, end: number, prefix: "- " | "1. " | "> "): Edit {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = value.indexOf("\n", end);
  const stop = lineEnd === -1 ? value.length : lineEnd;
  const lines = value.slice(lineStart, stop).split("\n");
  const re = prefix === "1. " ? /^\d+\. / : prefix === "- " ? /^- / : /^> /;
  const all = lines.every((l) => re.test(l));
  const next = lines.map((l, i) => (all ? l.replace(re, "") : `${prefix === "1. " ? `${i + 1}. ` : prefix}${l}`));
  const block = next.join("\n");
  return { value: value.slice(0, lineStart) + block + value.slice(stop), start: lineStart, end: lineStart + block.length };
}

/** Puts `text` in place of the selection, with the caret after it. */
export function insert(value: string, start: number, end: number, text: string): Edit {
  const at = start + text.length;
  return { value: value.slice(0, start) + text + value.slice(end), start: at, end: at };
}
