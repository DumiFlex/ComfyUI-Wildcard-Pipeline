/** Canonical rule ids. Must stay in sync with engine/cleaner/types.py:RuleId. */
export type RuleId =
  | "whitespace"
  | "dedupe_exact"
  | "wp_dedupe"
  | "null_slot"
  | "fuzzy_dedupe"
  | "dangling_var"
  | "blocklist"
  | "reorder";

export type Intensity = "gentle" | "balanced" | "aggressive";
export type Mode = "tags" | "text";
export type BlocklistKind = "list" | "regex";

/** Persisted on `node.properties.wp_cleaner_config` (widget JSON). */
export interface CleanerNodeConfig {
  mode: Mode;
  intensity: Intensity;
  /** Sparse — only rules diverging from the intensity default. */
  rules_override: Partial<Record<RuleId, boolean>>;
  blocklist: { kind: BlocklistKind; entries: string[] };
  preset_ref?: { id: string; name: string; payload_hash: string };
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
