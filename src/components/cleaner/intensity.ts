/** Mirrors `engine/cleaner/pipeline.INTENSITY_TO_RULES`. Both sides must
 *  stay in sync — the Python pipeline test asserts the exact list, and
 *  this TS file's test does too. */
import type { CleanerNodeConfig, Intensity, RuleId } from "./types";

export const INTENSITY_TO_RULES: Record<Intensity, RuleId[]> = {
  gentle: ["whitespace"],
  balanced: ["whitespace", "dedupe_exact", "wp_dedupe", "null_slot"],
  aggressive: [
    "whitespace",
    "dedupe_exact",
    "wp_dedupe",
    "null_slot",
    "fuzzy_dedupe",
    "dangling_var",
    "reorder",
  ],
};

/** Same canonical order as engine/cleaner/rules/__init__.py:RULE_REGISTRY. */
const REGISTRY_ORDER: RuleId[] = [
  "whitespace",
  "dedupe_exact",
  "wp_dedupe",
  "null_slot",
  "fuzzy_dedupe",
  "dangling_var",
  "blocklist",
  "reorder",
];

/** Final ordered rule list for a given config. Mirrors the Python pipeline. */
export function computeEffectiveRules(config: CleanerNodeConfig): RuleId[] {
  const base = new Set<RuleId>(INTENSITY_TO_RULES[config.intensity]);
  for (const [rid, on] of Object.entries(config.rules_override) as Array<[RuleId, boolean]>) {
    if (on) base.add(rid);
    else base.delete(rid);
  }
  if (config.blocklist.entries.length > 0) base.add("blocklist");
  else base.delete("blocklist");
  return REGISTRY_ORDER.filter((rid) => base.has(rid));
}

/** True when config exactly matches the selected intensity (no overrides,
 *  empty blocklist). Drives the "save button hidden" pristine state. */
export function isPristine(config: CleanerNodeConfig): boolean {
  const hasOverride = Object.keys(config.rules_override).length > 0;
  const hasBlocklist = config.blocklist.entries.length > 0;
  return !hasOverride && !hasBlocklist;
}
