/**
 * Shape of the WP_SeedList DOM widget value. Persisted as a JSON
 * string via the `WP_SEED_LIST_CONFIG` custom widget type. Python
 * side parses with `_parse_config` in `wp_nodes/seed_list.py`; this
 * file is its TS mirror so the SFC and the host glue agree on shape +
 * defaults.
 */

export type SeedListStrategy = "hash_index" | "sequential" | "prime_stride";

export interface SeedListConfig {
  strategy: SeedListStrategy;
  /** Take `base_seed` from the wired loop_config. Independent of
   *  count + strategy so the user can mix sources (e.g. loop's
   *  count/strategy + own base seed for the sampler). */
  override_seed: boolean;
  /** Take `count` from the wired loop_config. */
  override_count: boolean;
  /** Take `strategy` from the wired loop_config. */
  override_strategy: boolean;
}

const STRATEGIES = new Set<SeedListStrategy>(["hash_index", "sequential", "prime_stride"]);

export function emptySeedListConfig(): SeedListConfig {
  return {
    strategy: "hash_index",
    override_seed: false,
    override_count: false,
    override_strategy: false,
  };
}

/** Recovery-friendly parse: missing / malformed keys collapse to
 *  defaults instead of throwing. Mirrors the Python `_parse_config`
 *  so workflows with corrupt widget values still load.
 *
 *  Legacy migration: workflows saved before the split carry a single
 *  `override_config` boolean. When neither of the new keys is present,
 *  mirror that legacy flag to both new fields so the post-split shape
 *  matches the pre-split UX (one toggle → both fields).
 */
export function parseSeedListConfig(raw: string | null | undefined): SeedListConfig {
  const defaults = emptySeedListConfig();
  if (!raw || typeof raw !== "string") return defaults;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaults;
  const obj = parsed as Record<string, unknown>;
  const out: SeedListConfig = { ...defaults };
  if (typeof obj.strategy === "string" && STRATEGIES.has(obj.strategy as SeedListStrategy)) {
    out.strategy = obj.strategy as SeedListStrategy;
  }
  if (typeof obj.override_seed === "boolean") out.override_seed = obj.override_seed;

  const hasNewCount = typeof obj.override_count === "boolean";
  const hasNewStrategy = typeof obj.override_strategy === "boolean";
  if (hasNewCount) out.override_count = obj.override_count as boolean;
  if (hasNewStrategy) out.override_strategy = obj.override_strategy as boolean;

  // Legacy fallback: pre-split workflows only carried `override_config`.
  // Apply it to whichever new field the user hasn't explicitly set yet.
  if (typeof obj.override_config === "boolean") {
    const legacy = obj.override_config;
    if (!hasNewCount) out.override_count = legacy;
    if (!hasNewStrategy) out.override_strategy = legacy;
  }
  return out;
}

export function serializeSeedListConfig(cfg: SeedListConfig): string {
  return JSON.stringify(cfg);
}
