// Mirror of engine/syntax/subcat_filter.py — keep behavior identical.
// Shared fixture: tests/fixtures/subcat_filter_cases.json (parity-tested both ways).
//
// Grammar (precedence not > and > or; or/and n-ary, flattened):
//   expr := or ; or := and (("or"|",") and)* ; and := unary ("and" unary)*
//   unary := ("not" | "!") unary | atom ; atom := SUBCAT | VAR | "(" or ")"
//   VAR := "$" ident  (schema v11: reads a variable at run time, `bindVars`)
export type Ast =
  | { tag: string }
  | { var: string }
  | { op: "not"; x: Ast }
  | { op: "and" | "or"; kids: Ast[] };

export class ParseError extends Error {}

export const RESERVED = new Set(["and", "or", "not", "null"]);
const NAME_RE = /^[^\s()!,#:}@{$]+$/u;
// group1 = a real token; group2 = any stray non-space char => error.
const VAR_RE = /^\$[A-Za-z_][A-Za-z0-9_]*$/u;
const TOKEN_RE = /(\(|\)|,|!|\$[A-Za-z_][A-Za-z0-9_]*|[^\s()!,#:}@{$]+)|(\S)/gu;

export function parse(s: string): Ast | null {
  const toks: string[] = [];
  for (const m of s.matchAll(TOKEN_RE)) {
    if (m[2] !== undefined) throw new ParseError(`unexpected character '${m[2]}'`);
    // `!warm` is read as `not warm`. Mirrors Python `_tokenize`.
    toks.push(m[1] === "!" ? "not" : m[1]);
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
    if (VAR_RE.test(t)) return { var: t.slice(1) };
    return { tag: t };
  };

  const ast = pOr();
  if (pos < toks.length) throw new ParseError(`unexpected token '${toks[pos]}' (missing an operator?)`);
  return ast;
}

/** A `$var` term that was never bound (see `bindVars`) is left out, as if
 *  it were not written. Mirror of Python `matches`. */
export function matches(ast: Ast | null, tags: Set<string>): boolean {
  if (!ast) return true;
  if ("var" in ast) return true;
  if ("tag" in ast) return tags.has(ast.tag);
  if (ast.op === "not") {
    if (hasVar(ast.x)) return matches(dropVars(ast), tags);
    return !matches(ast.x, tags);
  }
  if (ast.kids.some((k) => "var" in k)) return matches(dropVars(ast), tags);
  if (ast.op === "and") return ast.kids.every((k) => matches(k, tags));
  return ast.kids.some((k) => matches(k, tags));
}

export function readsAs(ast: Ast | null): string {
  if (!ast) return "";
  if ("var" in ast) return `$${ast.var}`;
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
    if ("var" in n) return;
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

function hasVar(n: Ast): boolean {
  if ("var" in n) return true;
  if ("tag" in n) return false;
  if (n.op === "not") return hasVar(n.x);
  return n.kids.some(hasVar);
}

/** The expression without its `$var` terms: a `not` or a group left empty
 *  goes too, a one-child group becomes that child. Mirror of Python
 *  `drop_vars`; what a filter narrows before the run. */
export function dropVars(n: Ast | null): Ast | null {
  if (!n || "var" in n) return null;
  if ("tag" in n) return n;
  if (n.op === "not") {
    const x = dropVars(n.x);
    return x ? { op: "not", x } : null;
  }
  const kids = n.kids.map(dropVars).filter((k): k is Ast => k !== null);
  if (kids.length === 0) return null;
  return kids.length === 1 ? kids[0] : { op: n.op, kids };
}

/** Distinct `$name` terms of a parsed expression, in order (no `$`). */
export function variables(ast: Ast | null): string[] {
  const out: string[] = [];
  const walk = (n: Ast | null): void => {
    if (!n) return;
    if ("var" in n) {
      if (!out.includes(n.var)) out.push(n.var);
      return;
    }
    if ("tag" in n) return;
    if (n.op === "not") { walk(n.x); return; }
    n.kids.forEach(walk);
  };
  walk(ast);
  return out;
}

/** `variables` of an expression string; [] when empty or malformed. */
export function exprVariables(expr: unknown): string[] {
  if (typeof expr !== "string" || !expr.includes("$")) return [];
  try {
    return variables(parse(expr));
  } catch {
    return [];
  }
}

/** How a variable's value is compared with tags: trimmed, lower case, runs
 *  of spaces as one `_`. Mirror of Python `tag_key`. */
export function tagKey(value: string): string {
  return value.trim().toLowerCase().split(/\s+/u).filter(Boolean).join("_");
}

export interface BindNote {
  variable: string;
  value: string;
  reason: "unset" | "no_tag";
}

/** Replace every `$name` term with a plain tag expression for one run
 *  (schema v11). Mirror of Python `bind` (engine/syntax/subcat_filter.py),
 *  held by tests/fixtures/subcat_filter_bind_cases.json. A term keeps the
 *  options tagged with one of the values, plus options with no tag of the
 *  value's group; an unset variable or a value that is no tag here leaves
 *  the term out and adds a note. */
export function bindVars(
  ast: Ast | null,
  lookup: (name: string) => readonly string[] | null | undefined,
  tags: readonly string[],
  tagGroups?: Readonly<Record<string, readonly string[]>> | null,
): { ast: Ast | null; notes: BindNote[] } {
  const notes: BindNote[] = [];
  if (!ast) return { ast: null, notes };
  const byKey = new Map<string, string>();
  for (const t of tags) if (!byKey.has(tagKey(t))) byKey.set(tagKey(t), t);
  const groups = Object.values(tagGroups ?? {}).map((g) => [...g]);
  const cache = new Map<string, Ast>();
  const term = (name: string): Ast => {
    const got = cache.get(name);
    if (got) return got;
    const values = (lookup(name) ?? []).map(String).filter((v) => v.trim());
    const hit = [
      ...new Set(values.map((v) => byKey.get(tagKey(v))).filter((t): t is string => !!t)),
    ];
    let node: Ast;
    if (hit.length === 0) {
      notes.push({
        variable: name,
        value: values.join(", "),
        reason: values.length ? "no_tag" : "unset",
      });
      node = { var: name };
    } else {
      const kids: Ast[] = hit.map((t) => ({ tag: t }));
      const axis: string[] = [];
      for (const g of groups) {
        if (!hit.some((t) => g.includes(t))) continue;
        for (const m of g) if (!axis.includes(m)) axis.push(m);
      }
      if (axis.length) kids.push({ op: "not", x: { op: "or", kids: axis.map((m) => ({ tag: m })) } });
      node = kids.length === 1 ? kids[0] : { op: "or", kids };
    }
    cache.set(name, node);
    return node;
  };
  const walk = (n: Ast): Ast => {
    if ("var" in n) return term(n.var);
    if ("tag" in n) return n;
    if (n.op === "not") return { op: "not", x: walk(n.x) };
    return { op: n.op, kids: n.kids.map(walk) };
  };
  return { ast: dropVars(walk(ast)), notes };
}

/** A run's raw variable value as the list `bindVars` compares: a list var's
 *  items, a string as itself (empty → unset). Mirror of Python `values_of`. */
export function valuesOf(raw: unknown): string[] {
  if (raw == null) return [];
  if (typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)) {
    return (raw as { items: unknown[] }).items.map(String);
  }
  const text = String(raw);
  return text.trim() ? [text] : [];
}

interface TaggedPayload {
  sub_categories?: readonly string[] | null;
  tag_groups?: Readonly<Record<string, readonly string[]>> | null;
  options?: ReadonlyArray<{ sub_categories?: readonly string[] | null }> | null;
}

/** Every tag a wildcard declares or puts on an option. Mirror of Python
 *  `wildcard_tags`. */
export function wildcardTags(payload: TaggedPayload | null | undefined): string[] {
  const out = new Set<string>(payload?.sub_categories ?? []);
  for (const o of payload?.options ?? []) for (const t of o.sub_categories ?? []) out.add(t);
  return [...out];
}

/** `expr` with its `$name` terms bound to the values `get` returns, written
 *  back as a plain tag expression (what the engine filters by this run).
 *  A filter without variables, or one that doesn't parse, comes back as is. */
export function bindFilterForRun(
  expr: string,
  get: (name: string) => unknown,
  payload: TaggedPayload | null | undefined,
): string {
  if (!expr.includes("$")) return expr;
  let ast: Ast | null;
  try {
    ast = parse(expr);
  } catch {
    return expr;
  }
  if (variables(ast).length === 0) return expr;
  const bound = bindVars(ast, (n) => valuesOf(get(n)), wildcardTags(payload), payload?.tag_groups);
  return readsAs(bound.ast);
}
