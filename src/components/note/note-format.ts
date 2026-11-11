/**
 * The WP Note text syntax on top of Markdown, and the toolbar's edits.
 *
 *   [text](https://…)              a link, opens in a new tab
 *   [text](docs:page#s-section)    a link to the built-in docs (section optional)
 *   [text](wp:library)             a button that adds this workflow's bundles
 *                                  and modules to your library
 *   [text](wp:library#node-12)     … only those of one WP Context
 *   [text](wp:community/owner/pack)  a published pack in the Community tab
 *   [text](target){button}         the link drawn as a button
 *   [text](target){button pi-book} … with an icon
 *   [text](target){button pi-book #e11d48}  … in its own colour
 *   [text](target){#e11d48}        a text link in its own colour
 *   :pi-cog:  :pi-cog:{#e11d48}    a PrimeIcons glyph, optionally coloured
 *   ![alt](wp:image/1a2b3c4d)      a picture saved in the note (pasted, dropped
 *                                  or picked; the data lives in the workflow)
 *   ![alt](wp:asset/toolbar-help)  a picture the extension ships
 *   ![alt](target){width=60%}      … as wide as 60% of the note
 *
 * Pictures never load from a web address: anything other than those two
 * stays as its alt text, so opening a shared workflow fetches nothing.
 *
 * The `{…}` blocks follow the attribute lists of MkDocs Material and Pandoc.
 * Pure functions: the renderer (note-markdown.ts) and the editor share them.
 */
import { PI_ICON_SET } from "@/kit/pi-icons";
import noteAssets from "./note-assets.json";

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export type LinkTarget =
  | { kind: "web"; href: string }
  | { kind: "docs"; page: string; section: string }
  /** Adds the workflow's bundles and modules to the library. `node` is ""
   *  for the whole workflow, else one WP Context's key (`12`, or
   *  `<subgraph id>:12` inside a subgraph). */
  | { kind: "library"; node: string }
  /** A published pack's page in the manager's Community tab. */
  | { kind: "community"; owner: string; name: string }
  | { kind: "none" };

// A fixed list of actions with no free arguments: a node key is digits, or a
// subgraph id (hex and dashes) then `:` and digits.
const LIBRARY_RE = /^wp:library(?:#node-((?:[0-9a-f-]{1,64}:)?\d{1,9}))?$/i;
const COMMUNITY_RE = /^wp:community\/([a-z0-9][a-z0-9_.-]{0,63})\/([a-z0-9][a-z0-9_.-]{0,127})$/i;

/** What a link's target points at. Only http(s), docs: and the two wp:
 *  actions are links; anything else shows as text. */
export function parseTarget(href: string): LinkTarget {
  const h = href.trim();
  const lib = LIBRARY_RE.exec(h);
  if (lib) return { kind: "library", node: (lib[1] ?? "").toLowerCase() };
  const pack = COMMUNITY_RE.exec(h);
  if (pack?.[1] && pack[2]) return { kind: "community", owner: pack[1], name: pack[2] };
  const docs = /^docs:([a-z0-9-]+)(?:#([a-z0-9-]+))?$/i.exec(h);
  if (docs?.[1]) return { kind: "docs", page: docs[1].toLowerCase(), section: docs[2]?.toLowerCase() ?? "" };
  if (/^https?:\/\/[^\s]+$/i.test(h)) return { kind: "web", href: h };
  return { kind: "none" };
}

/** The address a target opens: the manager's docs page on this ComfyUI. */
export function targetUrl(t: LinkTarget, origin: string): string | null {
  if (t.kind === "web") return t.href;
  if (t.kind === "docs") return `${origin}/wp/docs/${encodeURIComponent(t.page)}${t.section ? `#${t.section}` : ""}`;
  if (t.kind === "community") return `${origin}/wp/community/p/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.name)}`;
  return null;
}

/** The target for an "add to library" button: the whole workflow, or one
 *  WP Context by its key. */
export function libraryTarget(node = ""): string {
  return `wp:library${node ? `#node-${node}` : ""}`;
}

/** The target for a community pack, from `owner/name` or a pasted page
 *  address (`…/p/owner/name`, `…/community/p/owner/name`). Null when it
 *  names no pack. */
export function communityTarget(input: string): string | null {
  const v = input.trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  const m = /(?:^|\/p\/)([^/\s]+)\/([^/\s]+)$/.exec(v);
  if (!m?.[1] || !m[2]) return null;
  const target = `wp:community/${m[1]}/${m[2]}`;
  return parseTarget(target).kind === "community" ? target : null;
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

// ── pictures ───────────────────────────────────────────────────────────

/** The pictures the extension ships, served from `/wp/images/`: the note
 *  pictures and every docs screenshot (`note-assets.json`, kept in step with
 *  the files by `note-assets.test.ts`). A fixed list: a note can't name any
 *  other file. */
export const NOTE_ASSETS: ReadonlyArray<{ id: string; label: string; file: string; w: number; h: number }> = noteAssets;

export type ImageTarget =
  | { kind: "saved"; id: string }
  | { kind: "asset"; id: string }
  | { kind: "none" };

/** Picture ids are 8 hex characters, like module ids. */
export const IMAGE_ID_RE = /^[0-9a-f]{8}$/;

export function parseImageTarget(src: string): ImageTarget {
  const s = src.trim();
  const saved = /^wp:image\/([0-9a-f]{8})$/i.exec(s);
  if (saved?.[1]) return { kind: "saved", id: saved[1].toLowerCase() };
  const asset = /^wp:asset\/([a-z0-9-]{1,64})$/i.exec(s);
  if (asset?.[1]) {
    const id = asset[1].toLowerCase();
    if (NOTE_ASSETS.some((a) => a.id === id)) return { kind: "asset", id };
  }
  return { kind: "none" };
}

export function assetUrl(id: string, origin: string): string | null {
  const a = NOTE_ASSETS.find((x) => x.id === id);
  return a ? `${origin}/wp/images/${a.file}` : null;
}

export const IMAGE_WIDTH_MIN = 10;
export const IMAGE_WIDTH_MAX = 100;

/** A `{width=60%}` block at the start of the text after a picture. Width in
 *  percent of the note (10–100), so the picture follows the note's width
 *  and never makes it wider. */
export function readImageAttrs(after: string): { width: number; length: number } | null {
  const m = /^\{\s*width\s*=\s*(\d{1,3})\s*%\s*\}/i.exec(after);
  if (!m?.[1]) return null;
  return { width: clampWidth(Number(m[1])), length: m[0].length };
}

export function clampWidth(w: number): number {
  if (!Number.isFinite(w)) return IMAGE_WIDTH_MAX;
  return Math.min(IMAGE_WIDTH_MAX, Math.max(IMAGE_WIDTH_MIN, Math.round(w)));
}

/** The Markdown for a picture. Brackets in the alt text become parentheses
 *  (the parser ends it at the first `]`). No width: as wide as it is, up to
 *  the note's width. */
export function imageMarkdown(alt: string, target: string, width: number | null = null): string {
  const a = alt.replace(/\[/g, "(").replace(/\]/g, ")").replace(/\n+/g, " ").trim();
  return `![${a}](${target})${width === null ? "" : `{width=${clampWidth(width)}%}`}`;
}

export function savedImageTarget(id: string): string {
  return `wp:image/${id}`;
}

export function assetImageTarget(id: string): string {
  return `wp:asset/${id}`;
}

/** One picture written in the text: where its Markdown sits, so the editor
 *  can change its width or take it out. */
export interface ImageRef {
  start: number;
  end: number;
  alt: string;
  target: ImageTarget;
  src: string;
  width: number | null;
}

const IMAGE_SRC_RE = /!\[([^\]\n]*)\]\((wp:(?:image|asset)\/[A-Za-z0-9-]{1,64})\)(\{\s*width\s*=\s*\d{1,3}\s*%\s*\})?/g;

/** Every `wp:` picture in the text, in order. (Code spans aren't skipped: a
 *  picture written in backticks still counts, which only keeps its data.) */
export function findImages(text: string): ImageRef[] {
  const out: ImageRef[] = [];
  for (const m of text.matchAll(IMAGE_SRC_RE)) {
    const at = m.index ?? 0;
    const src = m[2] ?? "";
    out.push({
      start: at,
      end: at + m[0].length,
      alt: m[1] ?? "",
      src,
      target: parseImageTarget(src),
      width: m[3] ? readImageAttrs(m[3])?.width ?? null : null,
    });
  }
  return out;
}

/** The text with one picture's width set (null: its own size). */
export function setImageWidth(text: string, ref: ImageRef, width: number | null): string {
  return text.slice(0, ref.start) + imageMarkdown(ref.alt, ref.src, width) + text.slice(ref.end);
}

/** The text with one picture taken out (and a line it leaves empty). */
export function removeImage(text: string, ref: ImageRef): string {
  let start = ref.start;
  let end = ref.end;
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const nl = text.indexOf("\n", end);
  const lineEnd = nl === -1 ? text.length : nl;
  if (!text.slice(lineStart, start).trim() && !text.slice(end, lineEnd).trim()) {
    start = lineStart;
    end = nl === -1 ? lineEnd : lineEnd + 1;
    if (nl === -1 && start > 0) start--;
  }
  // No run of blank lines left where it was.
  const head = text.slice(0, start);
  const tail = text.slice(end);
  const m = /\n*$/.exec(head);
  const n = /^\n*/.exec(tail);
  const lines = (m?.[0].length ?? 0) + (n?.[0].length ?? 0);
  if (lines > 2) return head.replace(/\n*$/, "") + (head.trim() && tail.trim() ? "\n\n" : "") + tail.replace(/^\n*/, "");
  return head + tail;
}
