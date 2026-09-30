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
 *  goes back to the plain v2 shape), empty groups vanish, and a group inside a
 *  group with the same connector merges into it (`a AND (b AND c)` is
 *  `a AND b AND c`). Test order, and so every override key, is unchanged. */
export function simplifyCondition<L>(node: ConditionNode<L>): ConditionNode<L> {
  if (!isConditionGroup(node)) return node;
  const g = node as ConditionGroup<L>;
  const match: ConditionMatch = g.match === "any" ? "any" : "all";
  const kids = g.conditions
    .map((c) => simplifyCondition(c))
    .filter((c) => !isConditionGroup(c) || (c as ConditionGroup<L>).conditions.length > 0)
    .flatMap((c) =>
      isConditionGroup(c) && (c as ConditionGroup<L>).match === match
        ? (c as ConditionGroup<L>).conditions
        : [c]);
  if (kids.length === 1) return kids[0];
  return { match, conditions: kids };
}

/** Engine cap on group nesting (`_MAX_CONDITION_DEPTH` in the handler). */
const ENGINE_MAX_GROUP_DEPTH = 8;

function groupDepth(node: unknown): number {
  if (!isConditionGroup(node)) return 0;
  const kids = Array.isArray(node.conditions) ? node.conditions : [];
  return 1 + Math.max(0, ...kids.map(groupDepth));
}

/**
 * Flip ONE connector of a group: the one in front of member `index`. Every
 * connector of a group is the same word, so the members are regrouped the
 * way the mixed row reads, with AND binding tighter than OR:
 *
 * - `a AND b AND c`, second connector to OR → `(a AND b) OR c`
 * - `a OR b OR c`, second connector to AND → `a OR (b AND c)`
 *
 * Flipping the same connector back undoes it. Test order (and so every
 * override key) is kept. Returns the group unchanged when the index has no
 * connector or the result would nest past the engine's cap.
 */
export function flipConnector<L>(group: ConditionGroup<L>, index: number): ConditionNode<L> {
  const kids = group.conditions;
  if (index < 1 || index >= kids.length) return group;
  let next: ConditionNode<L>;
  if (group.match === "any") {
    // OR → AND: the two members around this connector become one AND run.
    next = {
      match: "any",
      conditions: [
        ...kids.slice(0, index - 1),
        { match: "all", conditions: [kids[index - 1], kids[index]] },
        ...kids.slice(index + 1),
      ],
    };
  } else {
    // AND → OR: split the AND run at this connector.
    next = {
      match: "any",
      conditions: [
        { match: "all", conditions: kids.slice(0, index) },
        { match: "all", conditions: kids.slice(index) },
      ],
    };
  }
  next = simplifyCondition(next);
  return groupDepth(next) > ENGINE_MAX_GROUP_DEPTH ? group : next;
}

/** Short connector word for display. */
export function matchWord(match: unknown): "AND" | "OR" {
  return match === "any" ? "OR" : "AND";
}

/** Every action a branch or `else` clause runs, in order: its `action`, then
 *  its `extra_actions` (THEN ... AND ..., schema v8). Tolerant of junk.
 *  Mirrors the engine's `clause_actions`. */
export function clauseActions<A = { target_var?: string; mode?: string; value?: string }>(
  clause: unknown,
): A[] {
  if (!clause || typeof clause !== "object") return [];
  const c = clause as { action?: unknown; extra_actions?: unknown };
  const all = [c.action, ...(Array.isArray(c.extra_actions) ? c.extra_actions : [])];
  return all.filter((a): a is A => !!a && typeof a === "object" && !Array.isArray(a));
}

/** `clause` with its actions replaced by `actions` (first → `action`, the
 *  rest → `extra_actions`, dropped when there are none so a one-action branch
 *  keeps the plain shape it always had). */
export function withClauseActions<C extends { action: A; extra_actions?: A[] }, A>(
  clause: C,
  actions: readonly A[],
): C {
  const [first, ...rest] = actions;
  const next = { ...clause, action: first ?? clause.action };
  if (rest.length > 0) next.extra_actions = [...rest];
  else delete next.extra_actions;
  return next;
}

/** Key into `action_value_overrides[rule_id]` for one action of a branch
 *  (`branch` is the index or `"else"`). The first action keeps the bare key it
 *  always had; later ones append `.K`. Byte-identical to the engine's
 *  `action_override_key`. */
export function actionOverrideKey(branch: number | "else", actionIndex: number): string {
  return actionIndex === 0 ? String(branch) : `${branch}.${actionIndex}`;
}

/** Every distinct variable a derivation can write: each action of each branch
 *  and of the else clause (THEN ... AND ...). Which branch fires isn't
 *  knowable statically, so all of them count. */
export function derivationTargets(payload: unknown): string[] {
  const rules = (payload as { rules?: unknown } | null)?.rules;
  const out: string[] = [];
  if (!Array.isArray(rules)) return out;
  for (const rule of rules as Array<{ branches?: unknown; else?: unknown }>) {
    const clauses = [...(Array.isArray(rule?.branches) ? rule.branches : []), rule?.else];
    for (const clause of clauses) {
      for (const a of clauseActions<{ target_var?: string }>(clause)) {
        const name = (a.target_var ?? "").replace(/^\$/, "").trim();
        if (name && !out.includes(name)) out.push(name);
      }
    }
  }
  return out;
}
