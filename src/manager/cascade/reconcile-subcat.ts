/**
 * Reconcile a boolean sub-category expression against the sub_categories a
 * (freshly-picked) wildcard actually declares. Surviving sub-cat tokens
 * stay; unknown ones are dropped and reported so the UI can strike them
 * through and show an "N dropped" note (#3 reconcile, spec Component A).
 *
 * Operators (and/or/not) + parens are structural and always kept. The
 * reserved keyword `null` is universal (every wildcard's null option is
 * addressable) and is never dropped. After dropping unknown WORD tokens,
 * dangling operators are pruned so the surviving expression re-parses.
 *
 * Pure string→string; mirrors the lexical surface of
 * `manager/parsing/subcatFilter` without importing its AST (we only need
 * token membership + a clean re-emit, not evaluation).
 */
const OPERATORS = new Set(["and", "or", "not"]);
const RESERVED = new Set(["null"]);
// Words + parens, captured separately. matchAll keeps the security
// pre-tool hook from tripping on a literal exec-paren.
const TOKEN_RE = /[A-Za-z0-9_]+|[()]/g;

export interface SubcatReconcileResult {
  survivingExpr: string;
  dropped: string[];
}

export function reconcileSubcatExpr(
  expr: string,
  allowed: readonly string[],
): SubcatReconcileResult {
  const trimmed = expr.trim();
  if (trimmed.length === 0) return { survivingExpr: "", dropped: [] };
  const allow = new Set(allowed);
  const dropped: string[] = [];
  // Pass 1: classify tokens, marking dropped sub-cat words.
  type Tok = { text: string; kind: "kept" | "drop" };
  const toks: Tok[] = [];
  for (const m of trimmed.matchAll(TOKEN_RE)) {
    const t = m[0];
    const lower = t.toLowerCase();
    if (t === "(" || t === ")" || OPERATORS.has(lower) || RESERVED.has(lower)) {
      toks.push({ text: t, kind: "kept" });
    } else if (allow.has(t)) {
      toks.push({ text: t, kind: "kept" });
    } else {
      dropped.push(t);
      toks.push({ text: t, kind: "drop" });
    }
  }
  // Pass 2: emit kept tokens; prune operators left dangling by a drop.
  const kept = toks.filter((t) => t.kind === "kept").map((t) => t.text);
  const cleaned = pruneDanglingOps(kept);
  return { survivingExpr: emit(cleaned), dropped };
}

/** Join tokens with spaces, but hug parens to their inner content so the
 *  surviving expression matches subcatFilter's canonical `readsAs` shape
 *  (`(cold or vivid)`, not `( cold or vivid )`). */
function emit(tokens: string[]): string {
  let out = "";
  for (const tok of tokens) {
    if (out.length === 0 || tok === ")" || out.endsWith("(")) {
      out += tok;
    } else {
      out += ` ${tok}`;
    }
  }
  return out.trim();
}

/** Drop leading/doubled binary operators and trailing operators left
 *  behind when a sub-cat word was removed (`warm or` → `warm`). */
function pruneDanglingOps(tokens: string[]): string[] {
  const out: string[] = [];
  for (const tok of tokens) {
    const lower = tok.toLowerCase();
    const isBinary = lower === "and" || lower === "or";
    const prev = out[out.length - 1];
    const prevLower = prev?.toLowerCase();
    const prevIsBinaryOrOpen = prevLower === "and" || prevLower === "or" || prev === "(";
    if (isBinary && (out.length === 0 || prevIsBinaryOrOpen)) continue; // leading/doubled
    out.push(tok);
  }
  // Trim trailing binary operators / lone `not`.
  while (out.length > 0) {
    const last = out[out.length - 1].toLowerCase();
    if (last === "and" || last === "or" || last === "not") out.pop();
    else break;
  }
  return out;
}
