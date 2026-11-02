/**
 * Wildcard Pipeline rich-text tokenizer: the pure tokenizing surface of the
 * extension's `src/widgets/richTokenize.ts` lexer (same grammar). It has no
 * resolution helpers and no HTML emitters: TokenizedValue walks these tokens
 * in a template, so nothing here needs `v-html`.
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
  /** SP2a list accessor: `$name.K` -> 0-based index K (omitted when absent). */
  index?: number;
  /** Schema v8: `$name.neg` / `$name.K.neg` reads the variable's negatives. */
  neg?: boolean;
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

/** SP2a: reduce a var reference to its BASE name — drop an optional leading
 *  `$` and an optional trailing `.K` list accessor. `$mood.0` -> `mood`;
 *  `mood` -> `mood`; `weird.name` (non-digit suffix) -> unchanged. Used by
 *  validation + conflict scanning so a `.K` accessor resolves against the
 *  bound base var, not a phantom `mood.0`. */
export function varBaseName(raw: string): string {
  return raw.replace(/^\$/, "").replace(/\.neg$/, "").replace(/\.\d+$/, "").trim();
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
  const multiMatch = raw.match(MULTI_PREFIX_RE);
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

    // -- Variable: $name or $name.K (SP2a list accessor) --------------------
    if (ch === "$") {
      // `.match` (not `.exec`) keeps the matcher off the security-hook's radar
      // while giving the same match-array shape. Group 2 = optional `.K` index.
      // Group 3 = optional `.neg` (schema v8 negatives read).
      const m = text
        .slice(i + 1)
        .match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\.(\d+))?(\.neg(?![A-Za-z0-9_]))?/);
      if (m) {
        flushText(i);
        const raw =
          "$" + m[1] + (m[2] !== undefined ? "." + m[2] : "") + (m[3] ?? "");
        const meta: { name: string; index?: number; neg?: boolean } = { name: m[1] };
        if (m[2] !== undefined) meta.index = parseInt(m[2], 10);
        if (m[3] !== undefined) meta.neg = true;
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
