/**
 * Derivation condition trees — pure helpers shared by the engine mirrors
 * (static preview, conflict scanner, validators) and both rule editors.
 *
 * A branch `condition` is either ONE test (`{var, op, value}`) or a GROUP
 * (`{match: "all" | "any", conditions: [...]}`) whose members are tests or
 * further groups. "all" is AND, "any" is OR. A branch with a single test keeps
 * the plain shape it always had, so only branches that actually combine tests
 * need schema v7. Mirrors `engine/modules/derivation_handler.py`.
 */

export type ConditionMatch = "all" | "any";

export interface ConditionTest {
  var: string;
  op: string;
  value: string;
}

export interface ConditionGroup<L = ConditionTest> {
  match: ConditionMatch;
  conditions: ConditionNode<L>[];
}

export type ConditionNode<L = ConditionTest> = L | ConditionGroup<L>;

/** Deepest group the editors let a user build (a branch-level group counts as
 *  one). The engine accepts more; this keeps a dense rule row readable. */
export const MAX_EDITOR_GROUP_DEPTH = 3;

export function isConditionGroup(node: unknown): node is ConditionGroup<unknown> {
  return !!node && typeof node === "object" && !Array.isArray(node)
    && "conditions" in node;
}

/** Every single test in `node`, depth-first. The position in this list is the
 *  test's override index (see `conditionOverrideKey`). Tolerant of junk. */
export function conditionLeaves<L = ConditionTest>(node: unknown): L[] {
  if (isConditionGroup(node)) {
    const kids = Array.isArray(node.conditions) ? node.conditions : [];
    return kids.flatMap((c) => conditionLeaves<L>(c));
  }
  return node && typeof node === "object" && !Array.isArray(node) ? [node as L] : [];
}

/** Key into `condition_value_overrides[rule_id]` for one test of a branch. The
 *  first test keeps the bare branch index it always had; later tests append
 *  `.K`. Byte-identical to the engine's `condition_override_key`. */
export function conditionOverrideKey(branchIndex: number, leafIndex: number): string {
  return leafIndex === 0 ? String(branchIndex) : `${branchIndex}.${leafIndex}`;
}

/** Evaluate a condition tree with a caller-supplied test matcher. */
export function evalConditionTree<L>(
  node: unknown,
  matchTest: (test: L) => boolean,
): boolean {
  if (isConditionGroup(node)) {
    const kids = Array.isArray(node.conditions) ? node.conditions : [];
    return node.match === "any"
      ? kids.some((c) => evalConditionTree(c, matchTest))
      : kids.every((c) => evalConditionTree(c, matchTest));
  }
  if (!node || typeof node !== "object") return false;
  return matchTest(node as L);
}

/** Collapse redundant nesting so what the editor saves stays the simplest
 *  equivalent shape: a group of one member becomes that member (a lone test
 *  goes back to the plain v2 shape), and empty groups vanish. */
export function simplifyCondition<L>(node: ConditionNode<L>): ConditionNode<L> {
  if (!isConditionGroup(node)) return node;
  const g = node as ConditionGroup<L>;
  const kids = g.conditions
    .map((c) => simplifyCondition(c))
    .filter((c) => !isConditionGroup(c) || (c as ConditionGroup<L>).conditions.length > 0);
  if (kids.length === 1) return kids[0];
  return { match: g.match === "any" ? "any" : "all", conditions: kids };
}

/** Short connector word for display. */
export function matchWord(match: unknown): "AND" | "OR" {
  return match === "any" ? "OR" : "AND";
}
