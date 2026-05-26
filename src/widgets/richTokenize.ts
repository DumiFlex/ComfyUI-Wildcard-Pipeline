/**
 * Wildcard Pipeline rich-text tokenizer.
 *
 * Recognises the following syntactic surface (locked grammar, Tasks 3-7):
 *
 *   $varname                     subject placeholder (var)
 *   @{8hex}                      nested wildcard reference by UUID (ref)
 *   $$ / @@                      literal-escape sequences (escape)
 *   {a|b|c}                      inline-choice block (dp-brace, single token)
 *   {N$$sep$$a|b|c}              multi-select with optional separator (dp-multi)
 *
 * Single-token emission for brace blocks: `{a|b|c}` produces ONE `dp-brace`
 * token whose `meta.branches` lists the raw branch strings. This mirrors the
 * Python tokenizer exactly and is the contract the corpus (tests/fixtures/
 * syntax-corpus.json) locks in.
 *
 * Lossless invariant: joining all `.raw` fields reproduces the input exactly.
 *
 * REMOVED (legacy syntax no longer supported):
 *   @name short-form ref         - use @{8hex} UUID form instead
 *   N#$var / N#@ref / N#{...}    quantifier prefix
 *   # comment to end of line     greyed-out comment line
 *   dp-pipe / dp-weight          sub-tokens inside brace blocks
 *
 * Note: `dp-pipe` and `dp-weight` remain in the TokenKind union for backwards
 * compatibility with any consumers that reference the type, but the tokenizer
 * no longer emits them.
 */

export type TokenKind =
  | "text"
  | "var"
  | "ref"
  | "dp-brace"
  | "dp-pipe"    // retained in type only; not emitted by tokenizeRich
  | "dp-multi"
  | "dp-weight"  // retained in type only; not emitted by tokenizeRich
  | "escape";
// REMOVED: "comment", "quantifier" - dropped in locked grammar (Tasks 3-5)

export interface TokenMeta {
  // var tokens
  name?: string;
  // ref tokens
  uuid?: string;
  sub_categories?: string[];
  // escape tokens
  literal?: string;
  // dp-brace / dp-multi tokens
  branches?: string[];
  // dp-multi tokens
  count?: number;
  sep?: string;
  // dp-weight tokens (type kept for compat; not emitted)
  weight?: number;
  range?: string;
}

export interface RichToken {
  kind: TokenKind;
  start: number;
  end: number;
  raw: string;
  meta?: TokenMeta;
}

// ---------------------------------------------------------------------------
// Internal helpers (mirrors Python engine/syntax/tokenize.py)
// ---------------------------------------------------------------------------

/**
 * Split `s` on `|` at brace-depth zero only. Nested `{a|b}` stays intact.
 * Mirrors Python `_split_top_level_pipes`.
 */
function splitTopLevelPipes(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let idx = 0; idx < s.length; idx++) {
    const c = s[idx];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "|" && depth === 0) {
      parts.push(s.slice(last, idx));
      last = idx + 1;
    }
  }
  parts.push(s.slice(last));
  return parts;
}

// Multi-pick prefix: {N$$sep$$ - N is one or more digits, sep can be empty.
// Applied against the whole raw block including the leading `{`.
const MULTI_PREFIX_RE = /^\{(\d+)\$\$([\s\S]*?)\$\$/;

/**
 * Try to scan a `{...}` block starting at `text[start]` (must be `{`).
 *
 * Returns `[endIndex, branches, count | null, sep | null]` on success, or
 * `null` if the block is malformed (unclosed, or no top-level pipes for a
 * plain pick). Mirrors Python `_scan_brace_block`.
 */
function scanBraceBlock(
  text: string,
  start: number,
): [number, string[], number | null, string | null] | null {
  const n = text.length;
  if (start >= n || text[start] !== "{") return null;

  // Walk to the matching `}` tracking depth.
  let i = start + 1;
  let depth = 1;
  while (i < n && depth > 0) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    if (depth > 0) i++;
  }
  if (depth !== 0) return null; // unclosed

  const bodyStart = start + 1;
  const bodyEnd = i; // index of closing `}`
  const endIndex = i + 1;
  const body = text.slice(bodyStart, bodyEnd);

  // Detect multi-pick prefix: {N$$sep$$...
  const raw = text.slice(start, endIndex);
  const multiMatch = MULTI_PREFIX_RE.exec(raw);
  if (multiMatch) {
    const count = parseInt(multiMatch[1], 10);
    const sep = multiMatch[2];
    // Prefix length excluding the leading `{`
    const prefixLen = multiMatch[0].length - 1;
    const rest = body.slice(prefixLen);
    const branches = splitTopLevelPipes(rest);
    return [endIndex, branches, count, sep];
  }

  // Plain pick: must contain at least one top-level `|`
  const branches = splitTopLevelPipes(body);
  if (branches.length < 2) return null; // fall back to literal text

  return [endIndex, branches, null, null];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Walk `text` once and emit a flat list of {@link RichToken}s.
 *
 * Token shapes mirror the Python tokenizer (`engine/syntax/tokenize.py`) so
 * the corpus contract holds across both languages.
 */
export function tokenizeRich(text: string): RichToken[] {
  const out: RichToken[] = [];
  if (!text) return out;

  const N = text.length;
  let i = 0;
  // Accumulated start of current literal-text run (null = no run in progress)
  let textStart: number | null = null;

  function flushText(endAt: number): void {
    if (textStart === null) return;
    if (endAt > textStart) {
      out.push({
        kind: "text",
        raw: text.slice(textStart, endAt),
        start: textStart,
        end: endAt,
        meta: {},
      });
    }
    textStart = null;
  }

  while (i < N) {
    const ch = text[i];

    // -- Escape sequences: $$ -> literal $, @@ -> literal @ ----------------
    if (ch === "$" && i + 1 < N && text[i + 1] === "$") {
      flushText(i);
      out.push({ kind: "escape", raw: "$$", start: i, end: i + 2, meta: { literal: "$" } });
      i += 2;
      continue;
    }
    if (ch === "@" && i + 1 < N && text[i + 1] === "@") {
      flushText(i);
      out.push({ kind: "escape", raw: "@@", start: i, end: i + 2, meta: { literal: "@" } });
      i += 2;
      continue;
    }

    // -- Variable: $name ----------------------------------------------------
    if (ch === "$") {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(text.slice(i + 1));
      if (m) {
        flushText(i);
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
      // Lone $ or $ not followed by ident -- fall through to text accumulation
    }

    // -- Ref: @{8hex} or @{8hex:subcat[,subcat]} ----------------------------
    // Optional `:subcat,subcat` filter restricts the nested wildcard's
    // pick to options whose `sub_category` is in the list. Keeps one
    // library wildcard reusable while letting each call site narrow
    // surgically (e.g. `@{color:warm}` vs `@{color:cool}` referencing
    // the same `color` wildcard). Empty filter → no filter.
    if (ch === "@") {
      // Groups: 1=uuid, 2=optional `#name` cache, 3=optional subcat filter.
      const refMatch = text.slice(i).match(/^@\{([0-9a-f]{8})(?:#([^#:}@{]*))?(?::([^}]*))?\}/);
      if (refMatch) {
        flushText(i);
        const filterRaw = refMatch[3];
        const subCategories =
          typeof filterRaw === "string"
            ? filterRaw.split(",").map((s) => s.trim()).filter(Boolean)
            : [];
        const meta: { uuid: string; name?: string; sub_categories?: string[] } = { uuid: refMatch[1] };
        if (refMatch[2]) meta.name = refMatch[2];
        if (subCategories.length > 0) meta.sub_categories = subCategories;
        out.push({
          kind: "ref",
          raw: refMatch[0],
          start: i,
          end: i + refMatch[0].length,
          meta,
        });
        i += refMatch[0].length;
        continue;
      }
      // Not a ref -- fall through to text accumulation
    }

    // -- Brace block: {a|b|c} or {N$$sep$$a|b|c} ---------------------------
    if (ch === "{") {
      const scanned = scanBraceBlock(text, i);
      if (scanned !== null) {
        const [endIndex, branches, count, sep] = scanned;
        flushText(i);
        if (count === null) {
          out.push({
            kind: "dp-brace",
            raw: text.slice(i, endIndex),
            start: i,
            end: endIndex,
            meta: { branches },
          });
        } else {
          out.push({
            kind: "dp-multi",
            raw: text.slice(i, endIndex),
            start: i,
            end: endIndex,
            meta: { count, sep: sep ?? "", branches },
          });
        }
        i = endIndex;
        continue;
      }
      // Malformed brace -- fall through to literal text
    }

    // -- Default: accumulate literal text ------------------------------------
    if (textStart === null) textStart = i;
    i++;
  }

  flushText(N);
  return out;
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

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
 * Each token becomes a `<span class="wp-rt-{kind}" data-idx="{i}">...</span>`,
 * with content escaped against `<>&"'`. The `data-idx` attribute is the
 * source index inside the token array -- useful for caret-split logic that
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
  html += '<span class="wp-rt-tail">&#x200B;</span>';
  return html;
}

/**
 * Render `text` as HTML with colored sub-spans for inline syntax tokens
 * (`{a|b|c}`, `{2$$,$$a|b|c}`, `$$`, `@@`).
 *
 * Used by `RichTextInput`'s text-atom render path so brace blocks and
 * escapes get the same visual chrome as the read-only preview while
 * still living inside the editor's `wp-rt__text` host span. Output is
 * HTML-escaped so v-html consumption stays safe.
 *
 * Caret invariant: every token contributes one `<span>` whose
 * `textContent` exactly equals the token's `raw`. Sum across all
 * sub-spans equals the original `text` — caret math that walks text
 * node descendants stays correct.
 *
 * `text` tokens are wrapped in a `wp-rt-text` span (rather than emitted
 * raw) so every position inside the atom has a stable element parent —
 * matches how the read-only preview renders.
 *
 * `collapsedKind` lets callers neutralise a token kind that the host
 * surface treats as literal text — e.g. wildcard option editors collapse
 * `$var` back into text, so re-tokenising would otherwise re-color them
 * as vars. Tokens matching `collapsedKind` render with the plain
 * `wp-rt-text` class.
 */
export function inlineTokenHtml(
  text: string,
  collapsedKinds?: ReadonlyArray<"var" | "ref"> | "var" | "ref",
): string {
  if (!text) return "";
  const tokens = tokenizeRich(text);
  const collapsedSet = collapsedKinds == null
    ? null
    : new Set(typeof collapsedKinds === "string" ? [collapsedKinds] : collapsedKinds);
  // Fast path: a single plain-text token → emit raw text so the host
  // span's `firstChild` stays a text node (no DOM shape change versus
  // pre-coloring). Keeps caret-math callers that walk `.firstChild`
  // happy for the common case (un-decorated text atoms).
  if (tokens.length === 1 && tokens[0].kind === "text") {
    return escapeHtml(tokens[0].raw);
  }
  // Inline tokens stay editable (deliberate: brace blocks like
  // `{a|b|c}` are user-edited inline, not atomic chips). We add bare
  // ZWSP text nodes on the EDGES of sub-spans that would otherwise
  // sit at the boundary of the host text span with no neighboring
  // plain text — clicking visually past such a sub-span otherwise
  // lands the caret at element offset 0/1 of `wp-rt__text` and the
  // legacy fallback drops typing in front of the block.
  // No ZWSP is emitted where a plain-text token already provides the
  // caret landing — keeps `host.textContent` free of ZWSPs in the
  // common case (`$$cost` → no padding between `$$` escape and
  // `cost` text). Read paths strip ZWSPs (`readHostAsText` +
  // `replace(ZWSP_RE, "")`) so any pad never reaches `modelValue`.
  const isText = (idx: number): boolean => {
    if (idx < 0 || idx >= tokens.length) return false;
    const t = tokens[idx];
    if (t.kind === "text") return true;
    if (!collapsedSet) return false;
    return t.kind === "var" || t.kind === "ref"
      ? collapsedSet.has(t.kind)
      : false;
  };
  let html = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (isText(i)) {
      html += escapeHtml(t.raw);
    } else {
      if (!isText(i - 1)) html += "&#x200B;";
      html += `<span class="wp-rt-${t.kind}">${escapeHtml(t.raw)}</span>`;
      if (!isText(i + 1)) html += "&#x200B;";
    }
  }
  return html;
}