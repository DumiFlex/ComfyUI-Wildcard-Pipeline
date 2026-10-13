/**
 * chat-markdown — the small Markdown the assistant writes, parsed into a tree
 * the chat renders with plain elements (no v-html).
 *
 * Blocks: paragraphs, "#" headings, "- " / "* " / "1." lists, ``` code
 * fences, "> " quotes. Inline: **bold**, *italic* / _italic_, `code`, and
 * [[Name]] item mentions, which the chat turns into chips that open the item.
 * Anything else stays as text, so a model that writes no Markdown reads the
 * same as before. Links, images and HTML are never made: `![](url)` would
 * have the browser fetch a URL carrying chat data with no click.
 */

/* Hidden characters: Unicode tag characters (except inside an emoji flag),
   bidi controls, zero-width and other invisible format characters. Mirrors
   `engine/ai/safety.py`; the server strips them already, this is for
   anything that reaches the page another way. */
const INVISIBLE = /[\u00ad\u180e\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0100}-\u{e01ef}]/gu;
const TAGS = /(\u{1f3f4}?)([\u{e0000}-\u{e007f}]+)/gu;

export function stripInvisible(text: string): string {
  if (!/[^\x00-\x7f]/.test(text)) return text;
  return text
    .replace(TAGS, (_m, flag: string, run: string) =>
      flag && run.endsWith("\u{e007f}") && [...run].length <= 8 ? flag + run : flag)
    .replace(INVISIBLE, "");
}

export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; c: Inline[] }
  | { t: "i"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "ref"; v: string };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; c: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] }
  | { t: "pre"; v: string }
  | { t: "quote"; c: Inline[] };

const INLINE = /\[\[([^[\]\n]{1,80})\]\]|`([^`\n]+)`|\*\*(.+?)\*\*|(?<![\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])|(?<![\w_])_(?!\s)([^_\n]+?)_(?![\w_])/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ t: "text", v: text.slice(last, at) });
    if (m[1] !== undefined) out.push({ t: "ref", v: m[1].trim() });
    else if (m[2] !== undefined) out.push({ t: "code", v: m[2] });
    else if (m[3] !== undefined) out.push({ t: "b", c: parseInline(m[3]) });
    else out.push({ t: "i", c: parseInline(m[4] ?? m[5] ?? "") });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
/** A line that is only bold text works as a heading ("**Wildcards:**"). */
const BOLD_LINE = /^\s*\*\*([^*]+)\*\*:?\s*$/;

export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = stripInvisible(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  let list: { t: "ul" | "ol"; items: Inline[][] } | null = null;
  const flushPara = (): void => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join("\n")) });
    para = [];
  };
  const flushList = (): void => {
    if (list) blocks.push(list);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushPara(); flushList();
      const body: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i]);
      blocks.push({ t: "pre", v: body.join("\n") });
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    const bullet = BULLET.exec(line);
    const number = bullet ? null : NUMBER.exec(line);
    if (bullet || number) {
      flushPara();
      const kind = bullet ? "ul" : "ol";
      if (!list || list.t !== kind) { flushList(); list = { t: kind, items: [] }; }
      list.items.push(parseInline((bullet ?? number)?.[1] ?? ""));
      continue;
    }
    const heading = HEADING.exec(line) ?? BOLD_LINE.exec(line);
    if (heading) { flushPara(); flushList(); blocks.push({ t: "h", c: parseInline(heading[1]) }); continue; }
    if (/^\s*>\s?/.test(line)) {
      flushPara(); flushList();
      blocks.push({ t: "quote", c: parseInline(line.replace(/^\s*>\s?/, "")) });
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return blocks;
}
