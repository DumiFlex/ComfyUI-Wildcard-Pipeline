/**
 * Cascade a sub-category rename/delete through a boolean filter expression.
 *
 * A sub-category is a leaf `tag` in the parsed AST (see subcatFilter.ts).
 * Rename rewrites the matching tag, preserving structure; delete drops it
 * and collapses the now-childless operator (an `and`/`or` with one
 * surviving child becomes that child; a fully-emptied expression becomes
 * `""` = no filter). The result is re-serialized via `readsAs` so the
 * stored expression stays canonical.
 *
 * Mirror of the Python `_map_tags` helper in engine/cascade/fixers.py.
 */
import { parse, readsAs, type Ast } from "../parsing/subcatFilter";

function mapTags(n: Ast, fn: (t: string) => string | null): Ast | null {
  if ("tag" in n) {
    const v = fn(n.tag);
    return v === null ? null : { tag: v };
  }
  if (n.op === "not") {
    const x = mapTags(n.x, fn);
    return x ? { op: "not", x } : null;
  }
  const kids = n.kids.map((k) => mapTags(k, fn)).filter((k): k is Ast => k !== null);
  if (kids.length === 0) return null;
  return kids.length === 1 ? kids[0] : { op: n.op, kids };
}

/**
 * Collect the distinct sub-category tags referenced by a filter expression.
 * Used by the reverse-dependency index so a rename/delete of any single tag
 * finds every ref whose boolean filter mentions it. Negated tags count — a
 * `not warm` filter still depends on `warm`. A malformed expression yields no
 * tags (the index simply won't link it; the validator surfaces the error).
 */
export function collectTags(expr: string): string[] {
  let ast: Ast | null;
  try {
    ast = parse(expr);
  } catch {
    return [];
  }
  if (!ast) return [];
  const out = new Set<string>();
  const walk = (n: Ast): void => {
    if ("tag" in n) {
      out.add(n.tag);
      return;
    }
    if (n.op === "not") {
      walk(n.x);
      return;
    }
    n.kids.forEach(walk);
  };
  walk(ast);
  return [...out];
}

export function renameSubcatInExpr(expr: string, from: string, to: string): string {
  const ast = parse(expr);
  if (!ast) return "";
  return readsAs(mapTags(ast, (t) => (t === from ? to : t)));
}

export function removeSubcatFromExpr(expr: string, name: string): string {
  const ast = parse(expr);
  if (!ast) return "";
  return readsAs(mapTags(ast, (t) => (t === name ? null : t)));
}
