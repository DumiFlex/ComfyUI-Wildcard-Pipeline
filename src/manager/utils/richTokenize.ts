/**
 * Wildcard Pipeline rich-text tokenizer.
 *
 * Translated faithfully from the React reference at
 * docs/design-handoff/wildcardpipeline/project/rich-input.jsx (function
 * `tokenizeRich`). Recognises the following syntactic surface:
 *
 *   $varname                     subject placeholder (var)
 *   @wildcard_name               nested wildcard reference (ref)
 *   $$ / @@                      literal-escape sequences
 *   {a|b|c}                      inline-choice block (dp-brace + dp-pipe)
 *   {N$$sep$$a|b|c}              multi-select with optional separator
 *   {N::term}                    weighted option inside a brace block
 *   N#$var / N#@ref / N#{...}    quantifier prefix
 *   # comment to end of line     greyed-out comment line
 *
 * The tokenizer returns tokens covering the entire input contiguously
 * (consumers can rely on `tokens[0].start === 0` and the final token's
 * `end === text.length`). When a brace block contains nested syntax, sub-
 * tokens are emitted with absolute indices so a flat consumer can render
 * them in order without recursion.
 */

export type TokenKind =
  | "text"
  | "var"
  | "ref"
  | "dp-brace"
  | "dp-pipe"
  | "dp-multi"
  | "dp-weight"
  | "quantifier"
  | "comment"
  | "escape";

export interface TokenMeta {
  name?: string;
  weight?: number;
  count?: number;
  range?: string;
  sep?: string | null;
}

export interface RichToken {
  kind: TokenKind;
  start: number;
  end: number;
  raw: string;
  meta?: TokenMeta;
}

/**
 * Walk `text` once and emit a flat list of {@link RichToken}s.
 *
 * Mirrors the original React implementation exactly so downstream
 * mirror-rendering code can rely on identical token boundaries.
 */
export function tokenizeRich(text: string): RichToken[] {
  const out: RichToken[] = [];
  if (!text) return out;
  const N = text.length;
  let i = 0;

  while (i < N) {
    const ch = text[i];

    // Comment: `#` at line start (or after whitespace) through end of line.
    if (ch === "#" && (i === 0 || /\s/.test(text[i - 1]))) {
      let j = i;
      while (j < N && text[j] !== "\n") j++;
      out.push({ kind: "comment", raw: text.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }

    // Quantifier prefix `\d+#` followed by `$` or `{`.
    if (ch >= "0" && ch <= "9") {
      const m = text.slice(i).match(/^(\d+)#(?=[$@{])/);
      if (m) {
        out.push({
          kind: "quantifier",
          raw: m[0],
          start: i,
          end: i + m[0].length,
          meta: { count: Number(m[1]) },
        });
        i += m[0].length;
        continue;
      }
      // fall through — bare digits become plain text.
    }

    // Dynamic prompt block `{ ... }`.
    if (ch === "{") {
      let depth = 1;
      let j = i + 1;
      while (j < N && depth > 0) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
        if (depth > 0) j++;
      }
      if (depth === 0) {
        const inner = text.slice(i + 1, j);
        const fullEnd = j + 1;
        const multi = inner.match(/^(-?\d+(?:-\d+)?)\$\$(?:([^$]*)\$\$)?/);
        const headerLen = multi ? multi[0].length : 0;
        const headerStart = i + 1;
        const headerEnd = headerStart + headerLen;

        out.push({ kind: "dp-brace", raw: "{", start: i, end: i + 1 });
        if (multi) {
          out.push({
            kind: "dp-multi",
            raw: multi[0],
            start: headerStart,
            end: headerEnd,
            meta: { range: multi[1], sep: multi[2] || null },
          });
        }

        let k = headerEnd;
        let optStart = k;
        let innerDepth = 0;
        const flushOption = (endIdx: number): void => {
          if (endIdx <= optStart) return;
          const segText = text.slice(optStart, endIdx);
          const w = segText.match(/^(\d+(?:\.\d+)?)::/);
          if (w) {
            out.push({
              kind: "dp-weight",
              raw: w[0],
              start: optStart,
              end: optStart + w[0].length,
              meta: { weight: Number(w[1]) },
            });
            const subTokens = tokenizeRich(segText.slice(w[0].length));
            const offset = optStart + w[0].length;
            for (const t of subTokens) {
              out.push({ ...t, start: t.start + offset, end: t.end + offset });
            }
          } else {
            const subTokens = tokenizeRich(segText);
            for (const t of subTokens) {
              out.push({ ...t, start: t.start + optStart, end: t.end + optStart });
            }
          }
        };
        while (k < j) {
          if (text[k] === "{") innerDepth++;
          else if (text[k] === "}") innerDepth--;
          else if (text[k] === "|" && innerDepth === 0) {
            flushOption(k);
            out.push({ kind: "dp-pipe", raw: "|", start: k, end: k + 1 });
            optStart = k + 1;
          }
          k++;
        }
        flushOption(j);
        out.push({ kind: "dp-brace", raw: "}", start: j, end: fullEnd });
        i = fullEnd;
        continue;
      }
      // Unmatched brace — fall through, treat as plain text.
    }

    // `$$` literal escape.
    if (ch === "$" && text[i + 1] === "$") {
      out.push({ kind: "escape", raw: "$$", start: i, end: i + 2 });
      i += 2;
      continue;
    }
    // `@@` literal escape.
    if (ch === "@" && text[i + 1] === "@") {
      out.push({ kind: "escape", raw: "@@", start: i, end: i + 2 });
      i += 2;
      continue;
    }
    // `$varname` token.
    if (ch === "$") {
      const m = text.slice(i + 1).match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (m) {
        const raw = "$" + m[1];
        out.push({
          kind: "var",
          raw,
          start: i,
          end: i + raw.length,
          meta: { name: m[1] },
        });
        i += raw.length;
        continue;
      }
    }
    // `@varname` nested wildcard reference.
    if (ch === "@") {
      const m = text.slice(i + 1).match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (m) {
        const raw = "@" + m[1];
        out.push({
          kind: "ref",
          raw,
          start: i,
          end: i + raw.length,
          meta: { name: m[1] },
        });
        i += raw.length;
        continue;
      }
    }

    // Plain text run — accumulate until the next character that *could* start
    // a special token. Always advance at least one character to guarantee
    // forward progress.
    let j = i + 1;
    while (j < N) {
      const c = text[j];
      if (c === "$" || c === "@" || c === "{") break;
      if (c === "#" && (j === 0 || /\s/.test(text[j - 1]))) break;
      if (c >= "0" && c <= "9" && /^\d+#[$@{]/.test(text.slice(j))) break;
      j++;
    }
    out.push({ kind: "text", raw: text.slice(i, j), start: i, end: j });
    i = j;
  }
  return out;
}

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c] ?? c);
}

/**
 * Render a list of {@link RichToken}s to a flat HTML string.
 *
 * Each token becomes a `<span class="wp-rt-{kind}" data-idx="{i}">…</span>`,
 * with content escaped against `<>&"'`. The `data-idx` attribute is the
 * source index inside the token array — useful for caret-split logic that
 * needs to locate the originating token from a DOM node.
 *
 * The output is intentionally pre-escaped so the consuming Vue mirror can
 * use `v-html` safely (no user-controlled HTML survives the escape pass).
 */
export function mirrorHtmlWithIdx(tokens: RichToken[]): string {
  let html = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    html += `<span class="wp-rt-${t.kind}" data-idx="${i}">${escapeHtml(t.raw)}</span>`;
  }
  // Trailing zero-width span keeps the mirror's height in sync when the value
  // ends with a newline (textareas reserve a line of space; our pre-wrap text
  // does not, unless a glyph follows the final \n).
  html += `<span class="wp-rt-tail">​</span>`;
  return html;
}
