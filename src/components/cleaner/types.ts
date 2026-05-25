/** Canonical rule ids. Must stay in sync with engine/cleaner/types.py:RuleId. */
export type RuleId =
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
}

export type RuleStats = Record<string, unknown>;
export type RunReport = Partial<Record<RuleId, RuleStats>>;

export function emptyCleanerConfig(): CleanerNodeConfig {
  return {
    mode: "tags",
    intensity: "balanced",
    rules_override: {},
    blocklist: { kind: "list", entries: [] },
  };
}
