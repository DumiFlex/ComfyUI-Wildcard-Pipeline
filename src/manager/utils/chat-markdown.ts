/**
 * chat-markdown — the Markdown models write, parsed into a tree the chat
 * renders with plain elements (no v-html).
 *
 * Blocks: paragraphs, headings (`#` and underlined), lists (bulleted,
 * numbered with their start number, nested, task boxes, blank lines between
 * items), ``` and ~~~ code fences with their language, `>` quotes (several
 * lines, nested blocks), GitHub tables with column alignment, and `---`
 * rules. Inline: **bold**, *italic* / _italic_, ***both***, ~~struck~~,
 * `code`, backslash escapes and [[Name]] item mentions, which the chat turns
 * into chips that open the item (also when written in backticks,
 * `` `[[Name]]` ``). Anything else stays as text.
 *
 * A quote opening with a GitHub alert (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`,
 * `[!WARNING]`, `[!CAUTION]`) or `> **Note**` / `> **Warning**` carries a
 * `tone` and shows as a callout. `closeOpen` tidies a reply still streaming;
 * `plainText` is a reply for the clipboard.
 *
 * Links, images and HTML are never made: `![](url)` would have the browser
 * fetch a URL carrying chat data with no click. A link keeps its text (the
 * address goes in a tooltip), an image its alt text, and HTML stays text.
 * `__name__` stays as written because it is wildcard syntax, not bold.
 */

/* Hidden characters: Unicode tag characters (except inside an emoji flag),
   bidi controls, zero-width and other invisible format characters. Mirrors
   `engine/ai/safety.py`; the server strips them already, this is for
   anything that reaches the page another way. */
const INVISIBLE = /[­᠎​‌‎‏‪-‮⁠-⁤⁦-⁩﻿\u{e0100}-\u{e01ef}]/gu;
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
  | { t: "s"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "ref"; v: string }
  /** Shown as its text only; `href` goes in a tooltip, never followed. */
  | { t: "link"; c: Inline[]; href: string };

export type Tone = "tip" | "warn";

export type Align = "left" | "center" | "right" | null;

export interface ListItem {
  /** null: not a task; else whether its box is ticked. */
  task: boolean | null;
  blocks: Block[];
}

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: number; c: Inline[] }
  | { t: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { t: "pre"; lang: string; v: string }
  /** `tone`: a GitHub alert / `**Note**` quote, shown as a callout. */
  | { t: "quote"; blocks: Block[]; tone?: Tone }
  | { t: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { t: "hr" };

/* ── Inline ────────────────────────────────────────────────────────────── */

const INLINE = new RegExp([
  /\\([!-/:-@[-`{-~])/.source, // 1 escape
  /(`+)([^`\n]|[^`\n][\s\S]*?[^`\n])\2(?!`)/.source, // 2,3 code span
  /\[\[([^[\]\n]{1,80})\]\]/.source, // 4 mention
  /!\[([^\]\n]*)\]\([^)\s]*(?:\s+"[^"\n]*")?\)/.source, // 5 image
  /\[([^\]\n]+)\]\(([^)\s]*)(?:\s+"[^"\n]*")?\)/.source, // 6,7 link
  /\*\*\*(?!\s)([^*\n]+?)\*\*\*/.source, // 8 bold italic
  /\*\*(?!\s)(.+?)\*\*/.source, // 9 bold
  /~~(?!\s)([^~\n]+?)~~/.source, // 10 struck
  /(?<![\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])/.source, // 11 italic
  /(?<![\w_])_(?![\s_])([^_\n]+?)_(?![\w_])/.source, // 12 italic
].join("|"), "g");

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const push = (v: string): void => {
    const last = out[out.length - 1];
    if (last?.t === "text") last.v += v;
    else if (v) out.push({ t: "text", v });
  };
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) push(text.slice(last, at));
    last = at + m[0].length;
    if (m[1] !== undefined) push(m[1]);
    else if (m[3] !== undefined) {
      // A code span keeps one leading/trailing space off, like CommonMark.
      const v = m[3].length > 2 && m[3].startsWith(" ") && m[3].endsWith(" ") ? m[3].slice(1, -1) : m[3];
      // A mention in backticks is still a mention (models write `[[Name]]`).
      const ref = /^\[\[([^[\]\n]{1,80})\]\]$/.exec(v.trim());
      out.push(ref ? { t: "ref", v: ref[1].trim() } : { t: "code", v });
    } else if (m[4] !== undefined) out.push({ t: "ref", v: m[4].trim() });
    else if (m[5] !== undefined) push(m[5]);
    else if (m[6] !== undefined) out.push({ t: "link", c: parseInline(m[6]), href: m[7] ?? "" });
    else if (m[8] !== undefined) out.push({ t: "b", c: [{ t: "i", c: parseInline(m[8]) }] });
    else if (m[9] !== undefined) out.push({ t: "b", c: parseInline(m[9]) });
    else if (m[10] !== undefined) out.push({ t: "s", c: parseInline(m[10]) });
    else out.push({ t: "i", c: parseInline(m[11] ?? m[12] ?? "") });
  }
  if (last < text.length) push(text.slice(last));
  return out;
}

/* ── Blocks ────────────────────────────────────────────────────────────── */

const FENCE = /^( {0,3})(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
/** A line that is only bold text works as a heading ("**Wildcards:**"). */
const BOLD_LINE = /^\s*\*\*([^*]+)\*\*:?\s*$/;
const ITEM = /^( *)([-*+•]|\d{1,9}[.)])(?:[ \t]+(.*)|[ \t]*)$/;
const QUOTE = /^ {0,3}>[ ]?(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const TASK = /^\[([ xX])\][ \t]+(.*)$/;
/** `[!NOTE] text` or `**Note** text` on a quote's first line. */
const ALERT = /^\s*(?:\[!(note|tip|important|warning|caution)\]|\*\*(note|tip|important|warning|caution):?\*\*:?)(?:[ \t]+(.*))?$/i;

function indentOf(line: string): number {
  return line.length - line.replace(/^\s+/, "").length;
}

function blank(line: string | undefined): boolean {
  return line === undefined || !line.trim();
}

/** Split a table row on pipes outside code spans and escapes. */
function cells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const out: string[] = [];
  let cur = "";
  let tick = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
    if (ch === "`") {
      let n = 1;
      while (s[i + n] === "`") n++;
      tick = tick === 0 ? n : tick === n ? 0 : tick;
      cur += s.slice(i, i + n);
      i += n - 1;
      continue;
    }
    if (ch === "|" && tick === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** "Tip: … |" or "| Tip: … |" outside a table: the stray pipes go
 *  (Sonnet probe 2026-10-21: a tip under a table ended in "|"). A line with
 *  a pipe between cells is left alone. */
function unpiped(line: string): string {
  const s = line.trim();
  const edge = s.startsWith("|") || (s.endsWith("|") && !s.endsWith("\\|"));
  if (!edge || s === "|") return line;
  const c = cells(s);
  return c.length === 1 ? c[0] : line;
}

/** A one-cell row opening with Tip: / Note: / Warning: under a wider table:
 *  the note after it, not a row. */
const NOTE_ROW = /^(\*\*)?(tip|note|warning)\b/i;

function isTableStart(lines: string[], i: number): boolean {
  const head = lines[i];
  const rule = lines[i + 1];
  if (!head.includes("|") || rule === undefined || !rule.includes("-") || !TABLE_RULE.test(rule)) return false;
  // A rule like "---" alone is a heading underline or a line, not a table.
  return rule.includes("|") || cells(head).length > 1;
}

function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i];
  return FENCE.test(line) || HR.test(line) || HEADING.test(line) || QUOTE.test(line)
    || ITEM.test(line) || isTableStart(lines, i);
}

function stripIndent(line: string, n: number): string {
  let i = 0;
  while (i < n && line[i] === " ") i++;
  return line.slice(i);
}

export function parseMarkdown(text: string): Block[] {
  const lines = stripInvisible(text ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  return parseBlocks(lines, 0);
}

/** `inItem`: a list item's body, where a bold line stays bold text. */
function parseBlocks(lines: string[], depth: number, inItem = false): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = (): void => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join("\n").trim()) });
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) { flush(); i++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const [, pad, mark, lang] = fence;
      const close = new RegExp(`^ {0,3}${mark[0] === "`" ? "`" : "~"}{${mark.length},}\\s*$`);
      const body: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) body.push(stripIndent(lines[i++], pad.length));
      i++; // the closing fence (or past the end: an unclosed fence runs to the end)
      blocks.push({ t: "pre", lang: lang.slice(0, 20), v: body.join("\n") });
      continue;
    }

    // "Title" over "===" or "---" is a heading.
    if (para.length === 1 && /^ {0,3}(=+|-+)\s*$/.test(line)) {
      const level = line.trim()[0] === "=" ? 1 : 2;
      blocks.push({ t: "h", level, c: parseInline(para[0].trim()) });
      para = [];
      i++;
      continue;
    }

    if (HR.test(line)) { flush(); blocks.push({ t: "hr" }); i++; continue; }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      let title = (heading[2] ?? "").trim();
      // "### 3. Add variety**": a stray closing ** with no opening one.
      if (title.endsWith("**") && (title.match(/\*\*/g) ?? []).length % 2 === 1) title = title.slice(0, -2).trimEnd();
      blocks.push({ t: "h", level: heading[1].length, c: parseInline(title) });
      i++;
      continue;
    }
    const bold = !inItem && para.length === 0 && (blank(lines[i + 1]) || startsBlock(lines, i + 1) || i + 1 >= lines.length)
      ? BOLD_LINE.exec(line) : null;
    if (bold) { blocks.push({ t: "h", level: 4, c: parseInline(bold[1].trim()) }); i++; continue; }

    if (isTableStart(lines, i)) {
      flush();
      const head = cells(line);
      const align: Align[] = cells(lines[i + 1]).map((c) =>
        c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null);
      const width = head.length;
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && !blank(lines[i]) && lines[i].includes("|")) {
        const whole = cells(lines[i]);
        if (width > 1 && whole.length === 1 && NOTE_ROW.test(whole[0])) break;
        const row = whole.slice(0, width);
        i++;
        while (row.length < width) row.push("");
        rows.push(row.map(parseInline));
      }
      blocks.push({ t: "table", align: align.slice(0, width).concat(Array(Math.max(0, width - align.length)).fill(null)), head: head.map(parseInline), rows });
      continue;
    }

    if (QUOTE.test(line)) {
      flush();
      const inner: string[] = [];
      while (i < lines.length && !blank(lines[i])) {
        const q = QUOTE.exec(lines[i]);
        // A line without ">" right after quoted text carries on the quote.
        if (!q && startsBlock(lines, i)) break;
        inner.push(q ? q[1] : lines[i]);
        i++;
      }
      const alert = ALERT.exec(inner[0] ?? "");
      let tone: Tone | undefined;
      if (alert) {
        tone = /warn|caution/i.test(alert[1] ?? alert[2]) ? "warn" : "tip";
        const rest = (alert[3] ?? "").trim();
        if (rest) inner[0] = rest;
        else inner.shift();
      }
      const quote: Block = { t: "quote", blocks: depth > 6 ? [{ t: "p", c: parseInline(inner.join("\n")) }] : parseBlocks(inner, depth + 1) };
      if (tone) quote.tone = tone;
      blocks.push(quote);
      continue;
    }

    const item = ITEM.exec(line);
    if (item && depth <= 6) {
      flush();
      i = parseList(lines, i, depth, blocks);
      continue;
    }

    para.push(unpiped(line));
    i++;
    // A block opener ends the paragraph without a blank line.
    if (i < lines.length && !blank(lines[i]) && startsBlock(lines, i)
      && !/^ {0,3}(=+|-+)\s*$/.test(lines[i])) flush();
  }
  flush();
  return blocks;
}

/** One list from line `start`; returns the index after it. */
function parseList(lines: string[], start: number, depth: number, out: Block[]): number {
  const first = ITEM.exec(lines[start]);
  if (!first) return start + 1;
  const base = first[1].length;
  const ordered = /\d/.test(first[2]);
  const mark = ordered ? first[2].slice(-1) : null;
  const items: ListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m || m[1].length !== base || /\d/.test(m[2]) !== ordered || (mark && m[2].slice(-1) !== mark)) break;
    const body: string[] = [m[3] ?? ""];
    const inner = base + m[2].length + 1;
    i++;
    while (i < lines.length) {
      const line = lines[i];
      if (blank(line)) {
        // Blank lines stay in the list when it carries on after them.
        let j = i;
        while (j < lines.length && blank(lines[j])) j++;
        if (j >= lines.length) { i = j; break; }
        const next = ITEM.exec(lines[j]);
        if (indentOf(lines[j]) >= Math.min(inner, base + 2) && !(next && next[1].length <= base)) {
          for (; i < j; i++) body.push("");
          continue;
        }
        if (next && next[1].length === base) { i = j; }
        break;
      }
      const ind = indentOf(line);
      const sub = ITEM.exec(line);
      if (sub && sub[1].length <= base) break;
      if (ind >= base + 2) { body.push(stripIndent(line, Math.min(ind, inner))); i++; continue; }
      // Lazy continuation of the item's text.
      if (!startsBlock(lines, i)) { body.push(line.trim()); i++; continue; }
      break;
    }
    let task: boolean | null = null;
    const t = TASK.exec(body[0]);
    if (t) { task = t[1] !== " "; body[0] = t[2]; }
    items.push({ task, blocks: parseBlocks(body, depth + 1, true) });
    // Stop when the next line is no longer one of our items.
    const next = i < lines.length ? ITEM.exec(lines[i]) : null;
    if (!next || next[1].length !== base) break;
  }
  out.push({ t: "list", ordered, start: ordered ? Math.min(parseInt(first[2], 10), 1e6) : 1, items });
  return i;
}

/* ── Streaming + clipboard ─────────────────────────────────────────────── */

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * A reply still streaming, made safe to parse: an unfinished `[[` mention at
 * the end is dropped until its `]]` arrives, and an odd `` ` ``, `**` or `~~`
 * on the last line is closed (or dropped when nothing follows it yet), so
 * half a bold word doesn't show its stars. Text inside an open code fence is
 * left alone. Only for the live answer: a finished one is parsed as is.
 */
export function closeOpen(text: string): string {
  let open = false;
  for (const line of text.split("\n")) if (FENCE_LINE.test(line)) open = !open;
  if (open) return text;
  const cut = text.lastIndexOf("\n") + 1;
  const head = text.slice(0, cut);
  let line = text.slice(cut);
  if (FENCE_LINE.test(line)) return text;
  const mention = line.lastIndexOf("[[");
  if (mention >= 0 && line.indexOf("]]", mention) < 0) line = line.slice(0, mention).trimEnd();

  // Markers still open on the line, by where they opened.
  const opened: Array<{ at: number; mark: string }> = [];
  const ticks = [...line.matchAll(/`/g)].map((m) => m.index ?? 0);
  if (ticks.length % 2 === 1) opened.push({ at: ticks[ticks.length - 1], mark: "`" });
  // Code spans hide their stars and tildes.
  const bare = line.replace(/`[^`]*`/g, (m) => "x".repeat(m.length));
  const end = opened.length ? opened[0].at : bare.length;
  for (const mark of ["**", "~~"]) {
    const at: number[] = [];
    for (let i = bare.indexOf(mark); i >= 0 && i < end; i = bare.indexOf(mark, i + 2)) at.push(i);
    if (at.length % 2 === 1) opened.push({ at: at[at.length - 1], mark });
  }
  opened.sort((a, b) => b.at - a.at);
  for (const { at, mark } of opened) {
    // Nothing after the marker yet: hide it rather than close an empty run.
    if (!line.slice(at + mark.length).trim()) line = line.slice(0, at).trimEnd();
    else line = line.trimEnd() + mark;
  }
  return head + line;
}

const MENTION = /\[\[([^[\]\n]{1,80})\]\]/g;

/** A reply as text for the clipboard: `[[id#Name]]` mentions become the
 *  item's name (from `refs` when known); the rest stays Markdown. */
export function plainText(markdown: string, refs?: Record<string, { name: string }>): string {
  return markdown.replace(MENTION, (_m, label: string) => {
    const key = label.trim();
    return refs?.[key]?.name ?? (key.includes("#") ? key.slice(key.indexOf("#") + 1) : key);
  });
}
