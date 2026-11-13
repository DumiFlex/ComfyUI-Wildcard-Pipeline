/**
 * A template split the way the engine tokenizer reads it
 * (`engine/syntax/tokenize.py`): `$$` prints one `$`, `@@` one `@`, and
 * `$name` (with its `.K` / `.AXIS` accessor) is a variable read and
 * `@{8hex…}` a library reference.
 *
 * A `{…}` pick (a closed block with a top-level `|`, or a `{N$$…}`
 * multi-pick) is one `pick` piece kept as written: its own `$$`
 * (`{2$$, $$a|b}`) is grammar, not an escape, and the Assembler prints a
 * pick unrolled. A brace that is no pick (`{ $$5 }`, an unclosed `{`) is
 * plain text, so its escapes and variables work as anywhere else.
 */
export type TemplatePiece =
  | { kind: "text"; text: string }
  | { kind: "var"; raw: string; name: string }
  | { kind: "ref"; raw: string; uuid: string }
  | { kind: "pick"; raw: string };

// Same accessor grammar as the Assembler preview: `$x`, `$x.0`, `$x.AXIS`,
// `$x.0.AXIS`, `$x.AXIS.0`. Sticky: matched only where the walk stands.
const VAR_AT =
  /\$([A-Za-z_][A-Za-z0-9_]*)(?:\.(?:\d+(?:\.[A-Za-z_][A-Za-z0-9_]*)?|[A-Za-z_][A-Za-z0-9_]*(?:\.\d+)?))?/y;
// Same as the engine's `_REF_RE`, sticky.
const REF_AT = /@\{([0-9a-f]{8})(?:#([^#:}@{!]*))?(?::((?:[^}!]|!(?!null\}))*))?(?:!([^}]*))?\}/y;
const MULTI_PREFIX = /^\d+(?:-\d+)?~?\$\$/;
// `$name` reads inside a pick, `$$` skipped (chips and missing checks).
const PICK_VAR = /(?<!\$)\$([A-Za-z_][A-Za-z0-9_]*)/g;

/** End index (past the `}`) of the pick opening at `start`, else null. */
function pickEnd(text: string, start: number): number | null {
  let depth = 0;
  let pipe = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        const body = text.slice(start + 1, i);
        return pipe || MULTI_PREFIX.test(body) ? i + 1 : null;
      }
    } else if (c === "|" && depth === 1) pipe = true;
  }
  return null;
}

export function templatePieces(template: string): TemplatePiece[] {
  const out: TemplatePiece[] = [];
  const text = template ?? "";
  let buf = "";
  let i = 0;
  const flush = (): void => {
    if (buf) out.push({ kind: "text", text: buf });
    buf = "";
  };
  while (i < text.length) {
    const ch = text[i];
    if ((ch === "$" || ch === "@") && text[i + 1] === ch) {
      buf += ch;
      i += 2;
      continue;
    }
    if (ch === "@") {
      REF_AT.lastIndex = i;
      const m = REF_AT.exec(text);
      if (m) {
        flush();
        out.push({ kind: "ref", raw: m[0], uuid: m[1] });
        i += m[0].length;
        continue;
      }
    }
    if (ch === "{") {
      const end = pickEnd(text, i);
      if (end !== null) {
        flush();
        out.push({ kind: "pick", raw: text.slice(i, end) });
        i = end;
        continue;
      }
    }
    if (ch === "$") {
      VAR_AT.lastIndex = i;
      const m = VAR_AT.exec(text);
      if (m) {
        flush();
        out.push({ kind: "var", raw: m[0], name: m[1] });
        i += m[0].length;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

/** `text` as the engine prints its plain parts: `$$` → `$`, `@@` → `@`;
 *  variables, references and picks are kept as written. */
export function unescapeTemplate(text: string): string {
  return templatePieces(text)
    .map((p) => (p.kind === "text" ? p.text : p.raw))
    .join("");
}

/** The `$var` reads of a template, escapes skipped; names inside a pick
 *  count too (bare, since a pick is printed as written). */
export function templateVarReads(template: string): Array<{ raw: string; name: string }> {
  const out: Array<{ raw: string; name: string }> = [];
  for (const p of templatePieces(template)) {
    if (p.kind === "var") out.push({ raw: p.raw, name: p.name });
    else if (p.kind === "pick") {
      for (const m of p.raw.matchAll(PICK_VAR)) out.push({ raw: m[0], name: m[1] });
    }
  }
  return out;
}
