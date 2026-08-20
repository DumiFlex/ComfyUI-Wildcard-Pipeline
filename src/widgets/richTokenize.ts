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
  /** SP2a list accessor: `$name.K` -> 0-based index K (omitted when absent).
   *  With an axis it selects the pick: `$name.0.AXIS`. */
  index?: number;
  /** Tag-axis accessor: `$name.AXIS` -> the tag rolled for that `accepts`
   *  group at pick time (omitted when absent). */
  axis?: string;
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
  /** SP2b: count range — `min`==`max` for a fixed `{N$$}`, `min<max` for a
   *  `{N-M$$}` range. `independent` is the `~` flag (repeats allowed). */
  min?: number;
  max?: number;
  independent?: boolean;
  // dp-weight tokens (type kept for compat; not emitted)
  weight?: number;
  range?: string;
}

/** Reduce a var reference to its BASE name — drop an optional leading `$` and
 *  any accessor: a `.K` pick index, a `.AXIS` tag-axis read, or both in either
 *  order. `$mood.0` -> `mood`; `$outfit.SHOES` -> `outfit`;
 *  `$outfit.0.SHOES` -> `outfit`; `mood` -> `mood`.
 *
 *  Mirrors the accessor grammar in `engine/syntax/tokenize.py:_VAR_RE`. Used by
 *  validation, conflict scanning and the editor's chip lookup, so a reference
 *  with an accessor resolves against the bound base var rather than a phantom
 *  `outfit.SHOES` — which is what made an axis read render as inert text
 *  instead of a chip. */
export function varBaseName(raw: string): string {
  return varAccessorParts(raw).base;
}

/** Split a var reference into base + accessor parts using the ONE canonical
 *  grammar (index-first `$o.0.SHOES` and axis-first `$o.SHOES.0` both parse).
 *  Every surface that needs "which axis / which index" must go through this —
 *  the inline renderer used to hand-roll a `.replace(/\.\d+$/,"")` that only
 *  stripped a TRAILING index, so `$outfit.0.SHOES` yielded axis "0.SHOES",
 *  matched no declared axis, and painted a valid reference with the
 *  unknown-axis warning. Mirrors `engine/syntax/tokenize.py:_VAR_RE`. */
export function varAccessorParts(
  raw: string,
): { base: string; index?: number; axis?: string } {
  const bare = raw.replace(/^\$/, "").trim();
  const m = bare.match(
    /^([A-Za-z_][A-Za-z0-9_]*)(?:\.(?:(\d+)(?:\.([A-Za-z_][A-Za-z0-9_]*))?|([A-Za-z_][A-Za-z0-9_]*)(?:\.(\d+))?))?$/,
  );
  if (!m) return { base: bare };
  const index = m[2] ?? m[5];
  const axis = m[3] ?? m[4];
  return {
    base: m[1],
    ...(index !== undefined ? { index: parseInt(index, 10) } : {}),
    ...(axis !== undefined ? { axis } : {}),
  };
}

/** SP2a: a resolved variable value as a TS preview surface sees it — a plain
 *  string, or a list value `{items, sep}` mirroring the engine ListVar (the
 *  /wp/api/preview/resolve endpoint emits the structured form for a
 *  multi-pick var). */
export interface ListVarValue {
  items: string[];
  sep: string;
}
export type ResolvedValue = string | ListVarValue;

/** True when `v` is the structured list-value shape (vs a plain string). */
export function isListVarValue(v: unknown): v is ListVarValue {
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray((v as { items?: unknown }).items)
  );
}

/** SP2a: render a resolved var value to a string, honoring an optional `.K`
 *  list accessor — the TS mirror of engine `deref_var_value`
 *  (engine/syntax/types.py). ListVar: bare -> `items.join(sep)`; `.K` ->
 *  `items[K]` or "" when out of range. A plain string behaves as a 1-element
 *  list (`.0` == itself, `.K` > 0 == ""). null/undefined -> "". */
export function applyVarAccessor(
  value: ResolvedValue | null | undefined,
  index: number | undefined,
): string {
  if (value == null) return "";
  if (isListVarValue(value)) {
    if (index != null) {
      return index >= 0 && index < value.items.length ? value.items[index] : "";
    }
    return value.items.join(value.sep);
  }
  if (index != null) return index === 0 ? value : "";
  return value;
}

export interface RichToken {
  kind: TokenKind;
  start: number;
  end: number;
  raw: string;
  meta?: TokenMeta;
}

/** Peeled view of a nested ref's `:`-filter body. */
export interface RefFilterParts {
  /** Boolean sub-category expression, with the `!null` marker removed. */
  expr: string;
  /** True when the body carried the trailing `!null` exclude-null marker. */
  excludeNull: boolean;
}

/**
 * Peel a trailing `!null` exclude marker off a ref's raw `:`-body, returning
 * the pure boolean expression + the exclude-null flag:
 *   `"warm or intense!null"` → `{ expr: "warm or intense", excludeNull: true }`
 *   `"warm or cool"`         → `{ expr: "warm or cool",   excludeNull: false }`
 *
 * Sub-category names and the boolean expression never contain `!` (see the
 * grammar in `subcatFilter.ts`), so the only `!` in a serialized body is the
 * null marker. Single source for the peel that RefChip, the canvas OptionRow,
 * and RichTextInput's editor model all need — keeps them from re-deriving it
 * (and drifting) independently.
 */
export function splitRefFilter(body: string): RefFilterParts {
  const bang = body.lastIndexOf("!");
  if (bang >= 0) {
    return { expr: body.slice(0, bang).trim(), excludeNull: body.slice(bang + 1) === "null" };
  }
  return { expr: body.trim(), excludeNull: false };
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

// Multi-pick prefix: {N$$sep$$ or {N-M~$$sep$$ — group 1 is the count (fixed
// `N` or a `N-M` range), group 2 is the optional `~` independent flag (absent
// = unique), group 3 is the separator. Applied against the whole raw block
// including the leading `{`. SP2b.
const MULTI_PREFIX_RE = /^\{(\d+(?:-\d+)?)(~?)\$\$([\s\S]*?)\$\$/;

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
): [number, string[], [number, number, boolean] | null, string | null] | null {
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
    const countRaw = multiMatch[1];                 // "N" or "N-M"
    const independent = multiMatch[2] === "~";      // SP2b: repeats allowed
    const sep = multiMatch[3];
    // Prefix length excluding the leading `{`
    const prefixLen = multiMatch[0].length - 1;
    const rest = body.slice(prefixLen);
    const branches = splitTopLevelPipes(rest);
    const [lo, hi] = countRaw.includes("-")
      ? countRaw.split("-")
      : [countRaw, countRaw];
    let cmin = parseInt(lo, 10);
    let cmax = parseInt(hi, 10);
    if (cmin > cmax) { const t = cmin; cmin = cmax; cmax = t; }
    return [endIndex, branches, [cmin, cmax, independent], sep];
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

    // -- Variable: $name, plus at most one pick index and one axis ----------
    // Either order — `$o.0.SHOES` and `$o.SHOES.0` name the same value. Two
    // mirrored alternatives, so `.0.1` / `.SHOES.BELTS` do not match their
    // second segment and the tail stays literal text. Mirrors
    // `engine/syntax/tokenize.py:_VAR_RE`; both are locked to
    // `tests/fixtures/syntax-corpus.json`.
    //   1 name · 2 index-first · 3 axis-after-index · 4 axis-first · 5 index-after-axis
    if (ch === "$") {
      // `.match` (not `.exec`) keeps the matcher off the security-hook's radar
      // while giving the same match-array shape.
      const m = text.slice(i + 1).match(
        /^([A-Za-z_][A-Za-z0-9_]*)(?:\.(?:(\d+)(?:\.([A-Za-z_][A-Za-z0-9_]*))?|([A-Za-z_][A-Za-z0-9_]*)(?:\.(\d+))?))?/,
      );
      if (m) {
        flushText(i);
        // Normalise both spellings here, so nothing downstream learns which
        // order was written.
        const idx = m[2] ?? m[5];
        const axis = m[3] ?? m[4];
        const raw = "$" + m[1]
          + (m[2] !== undefined ? "." + m[2] : "")
          + (axis !== undefined ? "." + axis : "")
          + (m[5] !== undefined ? "." + m[5] : "");
        const meta: { name: string; index?: number; axis?: string } = { name: m[1] };
        if (idx !== undefined) meta.index = parseInt(idx, 10);
        if (axis !== undefined) meta.axis = axis;
        out.push({
          kind: "var",
          raw,
          start: i,
          end: i + raw.length,
          meta,
        });
        i += raw.length;
        continue;
      }
      // Lone $ or $ not followed by ident -- fall through to text accumulation
    }

    // -- Ref: @{8hex} or @{8hex#name:expr!null} -----------------------------
    // Optional `:expr` is an SP1 boolean sub-category filter (`warm or
    // intense`, `not cool`, parens; comma = or) with an optional trailing
    // `!null` exclude-null marker. The lexer does NOT parse the grammar — it
    // just captures the raw `:`-body, comma-split into `sub_categories` for
    // legacy callers. Downstream (RichTextInput, validateModule) rejoins on
    // `,`, peels `!null`, and hands the rest to the shared subcat-filter
    // parser. Keeps one library wildcard reusable while each call site
    // narrows surgically (e.g. `@{color:warm}` vs `@{color:cool or warm}`).
    // Empty filter → no filter.
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
          const [cmin, cmax, independent] = count;
          out.push({
            kind: "dp-multi",
            raw: text.slice(i, endIndex),
            start: i,
            end: endIndex,
            // `count` kept == max for back-compat; min/max carry the range,
            // independent carries the `~` flag (SP2b). Mirrors the Python meta.
            meta: { min: cmin, max: cmax, independent, count: cmax, sep: sep ?? "", branches },
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

export function escapeHtml(s: string): string {
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
/**
 * `<lora:…>` and `embedding:…` runs inside otherwise-plain text.
 *
 * Deliberately NOT a tokenizer kind. `tokenizeRich` is shared with the
 * engine-parity resolver and the atomic editor model, and neither has any
 * business knowing about ComfyUI prompt syntax — this is a rendering concern
 * and it stays in the renderer.
 *
 * `embedding:` ends at whitespace or a comma; a LoRA ends at its own `>`.
 */
const MODEL_SYNTAX_RE = /<lora:[^>]*>?|embedding:[^\s,]+/gi;

/** Fixed per kind, unlike `$var` which hashes its name into eight buckets.
 *  There are exactly two of these and they mean the same thing every time, so
 *  a stable colour is something you learn once. Matches the popover's own
 *  section icons.
 *
 *  Coloured INLINE rather than from a stylesheet, for two reasons that each
 *  independently decide it. The SPA's `rich-text.css` is not loaded on the
 *  canvas at all — the canvas has its own `rich-text-canvas.css` carrying a
 *  "keep in sync" note — so a rule would have to be written twice. And these
 *  spans are produced through `v-html`, so they never receive the `data-v-*`
 *  scope attribute that a rule inside a `<style scoped>` block requires,
 *  which is why the first attempt rendered plain `#ddd` on both hosts. One
 *  declaration here covers every host and cannot fall out of sync. */
export function modelSyntaxHtml(text: string): string {
  let out = "";
  let last = 0;
  MODEL_SYNTAX_RE.lastIndex = 0;
  for (let m = MODEL_SYNTAX_RE.exec(text); m; m = MODEL_SYNTAX_RE.exec(text)) {
    out += escapeHtml(text.slice(last, m.index));
    const isLora = m[0][0] === "<";
    const cls = isLora ? "wp-rt-lora" : "wp-rt-embedding";
    const tone = isLora ? "var(--wp-var-6)" : "var(--wp-var-7)";
    out += `<span class="${cls}" style="color:${tone}">${escapeHtml(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return last === 0 ? escapeHtml(text) : out + escapeHtml(text.slice(last));
}

export function inlineTokenHtml(
  text: string,
  collapsedKinds?: ReadonlyArray<"var" | "ref"> | "var" | "ref",
  /**
   * Extra HTML attributes for a `var` sub-span, keyed off the bare name.
   *
   * Exists for the prompt-template surface, which renders `$name` as coloured
   * EDITABLE TEXT rather than as a chip. Per-variable colour cannot come from a
   * class: `.wp-rt .wp-rt-var` in `rich-text.css` already sets a colour at
   * higher specificity than the global `.var-N` palette classes, so the hook
   * returns an inline `style` instead — which wins without either stylesheet
   * needing to know about the other.
   *
   * Returns a string spliced straight into the tag, so it must be
   * caller-escaped. Only ever invoked for `var` tokens.
   */
  varAttrs?: (name: string) => string,
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
    return modelSyntaxHtml(tokens[0].raw);
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
      html += modelSyntaxHtml(t.raw);
    } else {
      if (!isText(i - 1)) html += "&#x200B;";
      const attrs = t.kind === "var" && varAttrs
        ? varAttrs(t.raw.replace(/^\$/, ""))
        : "";
      // A var carrying an accessor renders as one atom with two readings: the
      // name keeps the variable colouring, the `.AXIS` / `.K` tail gets its own
      // span so it can take the group's hue. Still ONE `.wp-rt-var`, so caret
      // math and deletion continue to treat the reference as a single unit.
      const accessorAt = t.kind === "var" ? t.raw.indexOf(".") : -1;
      if (accessorAt > 0) {
        // Split index from axis so the pick index stays neutral and only the
        // axis carries the accent — mirrors the settled chip. Rebuilt from the
        // parsed parts rather than sliced raw so `.0.SHOES` and `.SHOES.0`
        // both land the index in the neutral span and the axis in the accent
        // span, regardless of the order the user typed.
        const parts = varAccessorParts(t.raw);
        const idxHtml = parts.index != null
          ? `<span class="wp-rt-var__index">.${parts.index}</span>`
          : "";
        const axisHtml = parts.axis
          ? `<span class="wp-rt-var__accessor">.${escapeHtml(parts.axis)}</span>`
          : "";
        // Fallback: an accessor the grammar did not recognise stays one plain
        // tail span rather than vanishing.
        const tail = idxHtml || axisHtml
          ? idxHtml + axisHtml
          : `<span class="wp-rt-var__accessor">${escapeHtml(t.raw.slice(accessorAt))}</span>`;
        html += `<span class="wp-rt-${t.kind}"${attrs}>`
          + `${escapeHtml("$" + parts.base)}`
          + tail
          + `</span>`;
      } else {
        html += `<span class="wp-rt-${t.kind}"${attrs}>${escapeHtml(t.raw)}</span>`;
      }
      if (!isText(i + 1)) html += "&#x200B;";
    }
  }
  return html;
}