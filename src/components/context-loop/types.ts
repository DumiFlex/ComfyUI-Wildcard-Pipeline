/**
 * Shape of the WP_ContextLoop DOM widget value. Persisted as a JSON
 * string via the `WP_CONTEXT_LOOP_CONFIG` custom widget type. Python
 * side parses with `_parse_config` in `wp_nodes/context_loop.py`; this
 * file is its TS mirror so the SFC and the host glue agree on shape +
 * defaults.
 */

export type LoopStrategy = "sequential" | "hash_index" | "prime_stride";

/** One swept wildcard: a downstream wildcard instance (`_uid`) and the
 *  option ids the sweep walks. `label` is display-only, kept so an axis
 *  whose wildcard has since been removed still reads as something. */
export interface SweepAxis {
  uid: string;
  option_ids: string[];
  label?: string;
}

/** Sweep mode: run every combination of the axes' options, one frame each,
 *  capped at `limit`. Python mirror: `engine/sweep.py:parse_sweep`. */
export interface SweepConfig {
  enabled: boolean;
  limit: number;
  /** Roll every unswept module on the frame-0 seed so only the swept
   *  wildcards change from frame to frame. */
  hold_others: boolean;
  axes: SweepAxis[];
}

export const SWEEP_DEFAULT_LIMIT = 64;
export const SWEEP_MAX_LIMIT = 999;

export function emptySweepConfig(): SweepConfig {
  return { enabled: false, limit: SWEEP_DEFAULT_LIMIT, hold_others: true, axes: [] };
}

/** Recovery-friendly parse, identical to the Python `parse_sweep`: axes
 *  without a uid or option ids are dropped, a repeated uid keeps its first
 *  axis, option ids are deduped in order. */
export function parseSweep(raw: unknown): SweepConfig {
  const out = emptySweepConfig();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  out.enabled = obj.enabled === true;
  if (typeof obj.limit === "number" && Number.isInteger(obj.limit)) {
    out.limit = Math.min(SWEEP_MAX_LIMIT, Math.max(1, obj.limit));
  }
  if (typeof obj.hold_others === "boolean") out.hold_others = obj.hold_others;
  const seen = new Set<string>();
  for (const a of Array.isArray(obj.axes) ? obj.axes : []) {
    if (!a || typeof a !== "object" || Array.isArray(a)) continue;
    const axis = a as Record<string, unknown>;
    const uid = axis.uid;
    if (typeof uid !== "string" || !uid || seen.has(uid)) continue;
    const ids: string[] = [];
    for (const id of Array.isArray(axis.option_ids) ? axis.option_ids : []) {
      if (typeof id === "string" && id && !ids.includes(id)) ids.push(id);
    }
    // An axis with nothing ticked is kept (cleared to pick a few by hand)
    // but sweeps nothing: see `liveAxes`.
    seen.add(uid);
    const clean: SweepAxis = { uid, option_ids: ids };
    if (typeof axis.label === "string" && axis.label) clean.label = axis.label;
    out.axes.push(clean);
  }
  return out;
}

/** The axes with at least one option ticked; only these sweep. */
export function liveAxes(axes: readonly SweepAxis[]): SweepAxis[] {
  return axes.filter((a) => a.option_ids.length > 0);
}

/** Combinations before the limit (1 with no axes). */
export function sweepTotal(axes: readonly SweepAxis[]): number {
  return liveAxes(axes).reduce((n, a) => n * a.option_ids.length, 1);
}

/** Frames the loop emits for this sweep, or null when the sweep is off,
 *  has no axes, or the whole loop is bypassed (the Python node then
 *  falls back to `count`). */
export function sweepFrameCount(cfg: ContextLoopConfig): number | null {
  const s = cfg.sweep;
  if (!s.enabled || !liveAxes(s.axes).length || cfg.bypass) return null;
  return Math.min(sweepTotal(s.axes), s.limit);
}

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
  /** Sweep mode; see `SweepConfig`. Off by default. */
  sweep: SweepConfig;
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
    sweep: emptySweepConfig(),
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
      // Type-guard before accepting — do NOT coerce. Mirrors the Python
      // `_parse_config` (which rejects non-int via isinstance), so both
      // parsers degrade corrupt widget JSON identically (`true`, `"3"`,
      // `null` are dropped on both sides, not coerced to 1/3/0).
      if (typeof x !== "number" || !Number.isInteger(x) || x < 0) continue;
      frames.add(x);
    }
    out.bypass_frames = [...frames].sort((a, b) => a - b);
  }
  out.sweep = parseSweep(obj.sweep);
  return out;
}

export function serializeContextLoopConfig(cfg: ContextLoopConfig): string {
  return JSON.stringify(cfg);
}
