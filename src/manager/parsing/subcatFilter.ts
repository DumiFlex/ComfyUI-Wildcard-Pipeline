// Mirror of engine/syntax/subcat_filter.py — keep behavior identical.
// Shared fixture: tests/fixtures/subcat_filter_cases.json (parity-tested both ways).
//
// Grammar (precedence not > and > or; or/and n-ary, flattened):
//   expr := or ; or := and (("or"|",") and)* ; and := unary ("and" unary)*
//   unary := "not" unary | atom ; atom := SUBCAT | "(" or ")"
export type Ast =
  | { tag: string }
  | { op: "not"; x: Ast }
  | { op: "and" | "or"; kids: Ast[] };

export class ParseError extends Error {}

export const RESERVED = new Set(["and", "or", "not", "null"]);
const NAME_RE = /^[^\s()!,#:}@{$]+$/u;
// group1 = a real token; group2 = any stray non-space char => error.
const TOKEN_RE = /(\(|\)|,|[^\s()!,#:}@{$]+)|(\S)/gu;

export function parse(s: string): Ast | null {
  const toks: string[] = [];
  for (const m of s.matchAll(TOKEN_RE)) {
    if (m[2] !== undefined) throw new ParseError(`unexpected character '${m[2]}'`);
    toks.push(m[1]);
  }
  if (toks.length === 0) return null;
  let pos = 0;
  const peek = (): string | undefined => toks[pos];
  const eat = (): string => toks[pos++];

  const pOr = (): Ast => {
    const k = [pAnd()];
    while (peek() === "or" || peek() === ",") { eat(); k.push(pAnd()); }
    return k.length === 1 ? k[0] : { op: "or", kids: k };
  };
  const pAnd = (): Ast => {
    const k = [pUnary()];
    while (peek() === "and") { eat(); k.push(pUnary()); }
    return k.length === 1 ? k[0] : { op: "and", kids: k };
  };
  const pUnary = (): Ast => {
    if (peek() === "not") { eat(); return { op: "not", x: pUnary() }; }
    return pAtom();
  };
  const pAtom = (): Ast => {
    const t = peek();
    if (t === "(") {
      eat();
      const inner = pOr();
      if (peek() !== ")") throw new ParseError("missing closing paren )");
      eat();
      return inner;
    }
    if (t === undefined) throw new ParseError("expression incomplete (missing a term)");
    if (["and", "or", "not", ")", ","].includes(t)) {
      throw new ParseError(`unexpected token '${t}' (missing an operator/term?)`);
    }
    eat();
    return { tag: t };
  };

  const ast = pOr();
  if (pos < toks.length) throw new ParseError(`unexpected token '${toks[pos]}' (missing an operator?)`);
  return ast;
}

export function matches(ast: Ast | null, tags: Set<string>): boolean {
  if (!ast) return true;
  if ("tag" in ast) return tags.has(ast.tag);
  if (ast.op === "not") return !matches(ast.x, tags);
  if (ast.op === "and") return ast.kids.every((k) => matches(k, tags));
  return ast.kids.some((k) => matches(k, tags));
}

export function readsAs(ast: Ast | null): string {
  if (!ast) return "";
  if ("tag" in ast) return ast.tag;
  if (ast.op === "not") {
    const c = ast.x;
    const inner = readsAs(c);
    return "op" in c && (c.op === "and" || c.op === "or") ? `not (${inner})` : `not ${inner}`;
  }
  return ast.kids
    .map((k) => {
      const inner = readsAs(k);
      return "op" in k && (k.op === "and" || k.op === "or") && k.op !== ast.op ? `(${inner})` : inner;
    })
    .join(` ${ast.op} `);
}

export function validateSubcatName(name: string): string | null {
  if (!name) return "name is empty";
  if (RESERVED.has(name.toLowerCase())) return `reserved word: '${name}'`;
  if (/\s/u.test(name)) return "name must not contain whitespace";
  if (!NAME_RE.test(name)) {
    const bad = [...name].find((c) => "()!,#:}@{$".includes(c));
    return `disallowed character: '${bad}'`;
  }
  return null;
}

export function validateExpression(s: string, known: Set<string>): string | null {
  let ast: Ast | null;
  try {
    ast = parse(s);
  } catch (e) {
    return (e as Error).message;
  }
  if (!ast) return null;
  const seen = new Set<string>();
  const walk = (n: Ast): void => {
    if ("tag" in n) { seen.add(n.tag); return; }
    if (n.op === "not") { walk(n.x); return; }
    n.kids.forEach(walk);
  };
  walk(ast);
  for (const t of seen) {
    if (RESERVED.has(t.toLowerCase())) return `reserved word used as a term: '${t}'`;
    if (!known.has(t)) return `Unknown sub-category: '${t}'`;
  }
  return null;
}
