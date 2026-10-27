/**
 * Plain-language lines for a derivation rule, for the AI review list:
 * "IF $class equals "mage" AND $weapon contains "staff"" / "set $title to
 * "Archmage"". Read-only text; the rule card is still where rules are edited.
 */
import type { DerivationAction, DerivationConditionNode, DerivationRule } from "../api/types";
import { OP_LABELS, type DerivationOp } from "../../components/context/editors/_shared/derivation-ops";
import { clauseActions, isConditionGroup } from "../../extension/derivation-conditions";

const NO_VALUE: ReadonlySet<string> = new Set([
  "exists", "not_exists", "is_set", "is_unset", "is_empty", "is_not_empty",
]);

export function conditionText(node: DerivationConditionNode, nested = false): string {
  if (isConditionGroup(node)) {
    const word = node.match === "any" ? " OR " : " AND ";
    const inner = node.conditions.map((c) => conditionText(c, true)).join(word);
    return nested ? `(${inner})` : inner;
  }
  const op = OP_LABELS[node.op as DerivationOp] ?? node.op;
  return NO_VALUE.has(node.op) ? `$${node.var} ${op}` : `$${node.var} ${op} "${node.value}"`;
}

export function actionText(a: DerivationAction): string {
  switch (a.mode) {
    case "append": return `add "${a.value}" after $${a.target_var}`;
    case "prepend": return `add "${a.value}" before $${a.target_var}`;
    case "negative": return `add "${a.value}" to $${a.target_var}'s negative`;
    case "negative_replace": return `make "${a.value}" $${a.target_var}'s only negative`;
    default: return `set $${a.target_var} to "${a.value}"`;
  }
}

export interface RuleLine { lead: "IF" | "ELSE IF" | "ELSE"; when: string; then: string[] }

export function ruleLines(rule: DerivationRule): RuleLine[] {
  const lines: RuleLine[] = rule.branches.map((b, i) => ({
    lead: i === 0 ? "IF" : "ELSE IF",
    when: conditionText(b.condition),
    then: clauseActions<DerivationAction>(b).map(actionText),
  }));
  if (rule.else) {
    lines.push({ lead: "ELSE", when: "", then: clauseActions<DerivationAction>(rule.else).map(actionText) });
  }
  return lines;
}

/** For a rule the AI changed: which of its lines are new or different
 *  from the rule it replaces (`old`), so the panel can mark them. */
export function changedLines(old: DerivationRule | undefined, rule: DerivationRule): boolean[] {
  const key = (l: RuleLine) => `${l.when}→${l.then.join("|")}`;
  const before = new Set((old ? ruleLines(old) : []).map(key));
  return ruleLines(rule).map((l) => !before.has(key(l)));
}
