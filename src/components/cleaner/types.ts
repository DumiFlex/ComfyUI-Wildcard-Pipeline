/** Canonical rule ids. Must stay in sync with engine/cleaner/types.py:RuleId. */
export type RuleId =
  | "empty_groups"
  | "merge_weights"
  | "lora_spacing"
  | "whitespace"
  | "punctuation"
  | "dedupe_exact"
  | "fuzzy_dedupe"
  | "blocklist";

export type Intensity = "gentle" | "balanced" | "aggressive";
export type Mode = "tags" | "text";
export type BlocklistKind = "list" | "regex";

/** Persisted on the node's widget JSON. */
export interface CleanerNodeConfig {
  mode: Mode;
  intensity: Intensity;
  /** Sparse — only rules diverging from the intensity default. */
  rules_override: Partial<Record<RuleId, boolean>>;
  blocklist: { kind: BlocklistKind; entries: string[] };
  /** Send-to-negative: the rule list's "neg" column. Sparse like
   *  `rules_override`, against `INTENSITY_TO_NEG_RULES`. Absent on
   *  workflows saved before the column existed. */
  negative_rules_override?: Partial<Record<RuleId, boolean>>;
  /** Drop negative tags the cleaned prompt also contains. Off (absent) by
   *  default; stored only when on. */
  drop_prompt_overlap?: boolean;
}

export type RuleStats = Record<string, unknown>;
export type RunReport = Partial<Record<RuleId, RuleStats>>;

/** `wp_cleaner_negative_report`: the negative column's per-rule stats plus
 *  the tags the negative shares with the prompt (present only when some
 *  do). */
export type NegativeRunReport = RunReport & {
  prompt_overlap?: { tags: string[]; dropped: boolean };
};

export function emptyCleanerConfig(): CleanerNodeConfig {
  return {
    mode: "tags",
    intensity: "balanced",
    rules_override: {},
    blocklist: { kind: "list", entries: [] },
  };
}
