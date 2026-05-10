/**
 * Tiny JSON syntax highlighter — turns a JSON string into HTML with
 * one span per token kind. Intended for debug-viewer rendering only;
 * scope is "well-formed JSON we just produced ourselves" so we don't
 * need to handle malformed input gracefully (caller already
 * try/catch'd before passing).
 *
 * Emits these classes (matching v3 mockup):
 *   .wp-jh-k  → object key (with quotes)
 *   .wp-jh-s  → string value (with quotes)
 *   .wp-jh-n  → number
 *   .wp-jh-b  → boolean / null
 *   .wp-jh-p  → punctuation ({}[]:,)
 *
 * Output is HTML-safe — every value passes through `escapeHtml` first
 * so embedded `<` / `&` / quotes can't break the surrounding pre.
 */

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

/** Match one JSON token plus the whitespace between tokens. The
 *  alternation ordering matters: strings before everything else (so
 *  colons/commas inside strings don't get separately tokenized);
 *  numbers before bareword fallthrough; booleans/null detected as
 *  exact identifier matches. */
const TOKEN_RE =
  /("(?:\\.|[^"\\])*")(\s*:)?|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])|(\s+)/g;

export function highlightJson(json: string): string {
  let out = "";
  let lastIndex = 0;
  for (const m of json.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > lastIndex) {
      out += escapeHtml(json.slice(lastIndex, idx));
    }
    const [whole, str, colonAfter, num, bool, punct, ws] = m;
    if (str !== undefined) {
      const isKey = colonAfter !== undefined;
      if (isKey) {
        out += `<span class="wp-jh-k">${escapeHtml(str)}</span>`;
        out += `<span class="wp-jh-p">${escapeHtml(colonAfter)}</span>`;
      } else {
        out += `<span class="wp-jh-s">${escapeHtml(str)}</span>`;
      }
    } else if (num !== undefined) {
      out += `<span class="wp-jh-n">${escapeHtml(num)}</span>`;
    } else if (bool !== undefined) {
      out += `<span class="wp-jh-b">${escapeHtml(bool)}</span>`;
    } else if (punct !== undefined) {
      out += `<span class="wp-jh-p">${escapeHtml(punct)}</span>`;
    } else if (ws !== undefined) {
      out += ws;
    }
    lastIndex = idx + whole.length;
  }
  if (lastIndex < json.length) {
    out += escapeHtml(json.slice(lastIndex));
  }
  return out;
}
