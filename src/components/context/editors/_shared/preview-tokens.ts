/**
 * Surface-aware frontend tokenizer for WP module values + templates.
 *
 * Mirrors the engine grammar in `engine/syntax/tokenize.py`. The two
 * regex sets are kept in lockstep — see `preview-tokens.test.ts`'s
 * parity assertions against engine fixtures.
 *
 * Surface gating per the support matrix:
 *
 *   surface       VAR  REF
 *   wildcard       no   yes
 *   combine        yes  no
 *   fixed_values   no   no
 *   derivation     yes  no
 *   assembler      yes  no
 */

export type Surface =
  | "wildcard"
  | "combine"
  | "fixed_values"
  | "derivation"
  | "assembler";

export interface PreviewToken {
  kind: "text" | "var" | "ref" | "alt" | "repeat" | "escape";
  raw: string;
  invalid?: boolean;
  varName?: string;
  refUuid?: string;
  branches?: string[];
  count?: number;
  separator?: string;
  literal?: "$" | "@";
}

const VAR_VALID_SURFACES = new Set<Surface>(["combine", "derivation", "assembler"]);
const REF_VALID_SURFACES = new Set<Surface>(["wildcard"]);

const VAR_RE = /\$([A-Za-z_][A-Za-z0-9_]*)/y;
// Optional `:subcat[,subcat]` per-call sub-category filter — empty
// filter is equivalent to no filter, sub-categories are stripped of
// whitespace + comma-separated.
// Groups: 1=uuid, 2=optional cached display name, 3=optional subcat
// filter. Consumers below only use m[1] (uuid) — name + subcat are
// preserved verbatim in m[0] for display.
const REF_RE = /@\{([0-9a-f]{8})(?:#([^#:}@{]*))?(?::([^}]*))?\}/y;
const DP_MULTI_RE = /\{(\d+)\$\$([^$]*)\$\$([^}]*)\}/y;
const DP_BRACE_RE = /\{([^{}]*\|[^{}]*)\}/y;

function pushText(out: PreviewToken[], buf: string): void {
  if (buf.length > 0) {
    out.push({ kind: "text", raw: buf });
  }
}

export function tokenize(text: string, surface: Surface): PreviewToken[] {
  const out: PreviewToken[] = [];
  let i = 0;
  let textBuf = "";

  while (i < text.length) {
    const c = text[i];

    if ((c === "$" || c === "@") && text[i + 1] === c) {
      pushText(out, textBuf);
      textBuf = "";
      out.push({ kind: "escape", raw: c + c, literal: c as "$" | "@" });
      i += 2;
      continue;
    }

    if (c === "$") {
      VAR_RE.lastIndex = i;
      const m = VAR_RE.exec(text);
      if (m && m.index === i) {
        pushText(out, textBuf);
        textBuf = "";
        out.push({
          kind: "var",
          raw: m[0],
          varName: m[1],
          invalid: !VAR_VALID_SURFACES.has(surface),
        });
        i += m[0].length;
        continue;
      }
    }

    if (c === "@") {
      REF_RE.lastIndex = i;
      const m = REF_RE.exec(text);
      if (m && m.index === i) {
        pushText(out, textBuf);
        textBuf = "";
        out.push({
          kind: "ref",
          raw: m[0],
          refUuid: m[1],
          invalid: !REF_VALID_SURFACES.has(surface),
        });
        i += m[0].length;
        continue;
      }
    }

    if (c === "{") {
      DP_MULTI_RE.lastIndex = i;
      const m = DP_MULTI_RE.exec(text);
      if (m && m.index === i) {
        pushText(out, textBuf);
        textBuf = "";
        out.push({
          kind: "repeat",
          raw: m[0],
          count: Number.parseInt(m[1], 10),
          separator: m[2],
          branches: m[3].split("|"),
        });
        i += m[0].length;
        continue;
      }

      DP_BRACE_RE.lastIndex = i;
      const mb = DP_BRACE_RE.exec(text);
      if (mb && mb.index === i) {
        pushText(out, textBuf);
        textBuf = "";
        out.push({
          kind: "alt",
          raw: mb[0],
          branches: mb[1].split("|"),
        });
        i += mb[0].length;
        continue;
      }
    }

    textBuf += c;
    i += 1;
  }

  pushText(out, textBuf);
  return out;
}
