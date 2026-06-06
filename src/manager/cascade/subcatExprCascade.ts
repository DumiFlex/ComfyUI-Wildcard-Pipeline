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
