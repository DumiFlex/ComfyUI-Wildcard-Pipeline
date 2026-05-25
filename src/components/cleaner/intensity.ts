/** Mirrors `engine/cleaner/pipeline.INTENSITY_TO_RULES`. Both sides must
 *  stay in sync — the Python pipeline test asserts the exact list, and
 *  this TS file's test does too. */
import type { CleanerNodeConfig, Intensity, RuleId } from "./types";

export const INTENSITY_TO_RULES: Record<Intensity, RuleId[]> = {
  gentle: ["whitespace"],
  balanced: [
    "whitespace",
    "punctuation",
    "dedupe_exact",
    "wp_dedupe",
    "null_slot",
  ],
  aggressive: [
    "whitespace",
    "punctuation",
    "dedupe_exact",
    "wp_dedupe",
    "null_slot",
    "fuzzy_dedupe",
    "dangling_var",
  ],
};

/** Same canonical order as engine/cleaner/rules/__init__.py:RULE_REGISTRY. */
const REGISTRY_ORDER: RuleId[] = [
  "whitespace",
  "punctuation",
  "dedupe_exact",
  "wp_dedupe",
  "null_slot",
  "fuzzy_dedupe",
  "dangling_var",
  "blocklist",
];

/** Final ordered rule list for a given config. Mirrors the Python
 *  pipeline.run() resolution. Blocklist precedence:
 *   1. Explicit override (true|false) wins — user can toggle the rule
 *      off even with entries present, or on with no entries.
 *   2. No override + entries non-empty → auto-enable.
 *   3. No override + entries empty → off. */
export function computeEffectiveRules(config: CleanerNodeConfig): RuleId[] {
  const base = new Set<RuleId>(INTENSITY_TO_RULES[config.intensity]);
  for (const [rid, on] of Object.entries(config.rules_override) as Array<[RuleId, boolean]>) {
    if (on) base.add(rid);
    else base.delete(rid);
  }
  if (!("blocklist" in config.rules_override)) {
    if (config.blocklist.entries.length > 0) base.add("blocklist");
    else base.delete("blocklist");
  }
  return REGISTRY_ORDER.filter((rid) => base.has(rid));
}

/** True when no rule override diverges from the intensity baseline.
 *  Blocklist entries on their own do NOT count as "modification" —
 *  they're data, not a toggle. The CUSTOM badge appears only when the
 *  user explicitly flipped a rule away from its baseline. */
export function isPristine(config: CleanerNodeConfig): boolean {
  const defaults = new Set(INTENSITY_TO_RULES[config.intensity]);
  const hasEntries = config.blocklist.entries.length > 0;
  for (const [rid, on] of Object.entries(config.rules_override) as Array<[RuleId, boolean]>) {
    const baseline = defaults.has(rid) || (rid === "blocklist" && hasEntries);
    if (on !== baseline) return false;
  }
  return true;
}
