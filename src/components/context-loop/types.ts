/**
 * Shape of the WP_ContextLoop DOM widget value. Persisted as a JSON
 * string via the `WP_CONTEXT_LOOP_CONFIG` custom widget type. Python
 * side parses with `_parse_config` in `wp_nodes/context_loop.py`; this
 * file is its TS mirror so the SFC and the host glue agree on shape +
 * defaults.
 */

export type LoopStrategy = "sequential" | "hash_index" | "prime_stride";

export interface ContextLoopConfig {
  strategy: LoopStrategy;
  override_seed: boolean;
  iteration_var_name: string;
  bypass: boolean;
  /** When true, `$<iteration_var_name>` is stamped as internal — engine
   *  propagates it across socket boundaries but the PromptAssembler
   *  strips it before render. Lets users reference the iteration index
   *  in Combine / Derivation chains without leaking it into prompts. */
  iteration_internal: boolean;
  /** Same idea for `$<iteration_var_name>_total`. */
  total_internal: boolean;
  /** 0-based iteration index (stringified) -> pinned seed. Unlocked
   *  indices re-derive from base+strategy. Empty by default. */
  seed_locks: Record<string, number>;
  /** 0-based iteration indices to bypass (skip generation + overrides).
   *  Sorted, deduped, non-negative. Out-of-range (>= count) entries are
   *  kept and re-apply if count grows. Empty by default. */
  bypass_frames: number[];
}

const STRATEGIES = new Set<LoopStrategy>(["sequential", "hash_index", "prime_stride"]);

export function emptyContextLoopConfig(): ContextLoopConfig {
  return {
    strategy: "hash_index",
    override_seed: false,
    iteration_var_name: "iteration",
    bypass: false,
    iteration_internal: true,
    total_internal: true,
    seed_locks: {},
    bypass_frames: [],
  };
}

/** Recovery-friendly parse: missing / malformed keys collapse to defaults
 *  instead of throwing. Mirrors the Python `_parse_config` so workflows
 *  with corrupt widget values still load. */
export function parseContextLoopConfig(raw: string | null | undefined): ContextLoopConfig {
  const defaults = emptyContextLoopConfig();
  if (!raw || typeof raw !== "string") return defaults;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaults;
  const obj = parsed as Record<string, unknown>;
  const out: ContextLoopConfig = { ...defaults };
  if (typeof obj.strategy === "string" && STRATEGIES.has(obj.strategy as LoopStrategy)) {
    out.strategy = obj.strategy as LoopStrategy;
  }
  if (typeof obj.override_seed === "boolean") out.override_seed = obj.override_seed;
  if (typeof obj.iteration_var_name === "string" && obj.iteration_var_name.trim()) {
    out.iteration_var_name = obj.iteration_var_name.trim();
  }
  if (typeof obj.bypass === "boolean") out.bypass = obj.bypass;
  if (typeof obj.iteration_internal === "boolean") out.iteration_internal = obj.iteration_internal;
  if (typeof obj.total_internal === "boolean") out.total_internal = obj.total_internal;
  if (obj.seed_locks && typeof obj.seed_locks === "object" && !Array.isArray(obj.seed_locks)) {
    const locks: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj.seed_locks as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) locks[k] = v;
    }
    out.seed_locks = locks;
  }
  if (Array.isArray(obj.bypass_frames)) {
    const frames = new Set<number>();
    for (const x of obj.bypass_frames) {
      const n = Number(x);
      if (Number.isInteger(n) && n >= 0) frames.add(n);
    }
    out.bypass_frames = [...frames].sort((a, b) => a - b);
  }
  return out;
}

export function serializeContextLoopConfig(cfg: ContextLoopConfig): string {
  return JSON.stringify(cfg);
}
