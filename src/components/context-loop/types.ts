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

/** Drop seed locks and bypassed frames at or past `count`, so raising the
 *  count again starts those frames fresh. Returns `cfg` when nothing changed. */
export function keepFramesWithin(cfg: ContextLoopConfig, count: number): ContextLoopConfig {
  const locks = Object.entries(cfg.seed_locks).filter(([k]) => Number(k) < count);
  const bypass = cfg.bypass_frames.filter((i) => i < count);
  if (locks.length === Object.keys(cfg.seed_locks).length && bypass.length === cfg.bypass_frames.length) return cfg;
  return { ...cfg, seed_locks: Object.fromEntries(locks), bypass_frames: bypass };
}

/** Each frame's combination as a key, in run order (mirrors `sweep_frames`). */
function sweepCombos(cfg: ContextLoopConfig): string[] | null {
  const frames = sweepFrameCount(cfg);
  if (frames === null) return null;
  let combos = [""];
  for (const a of liveAxes(cfg.sweep.axes)) {
    combos = combos.flatMap((c) => a.option_ids.map((id) => `${c}${a.uid}=${id};`));
  }
  return combos.slice(0, frames);
}

/** After a sweep edit, keep each seed lock / bypass on the combination it
 *  was set for: it moves with that combination, or goes when the
 *  combination no longer runs. Without a sweep on both sides, frames past
 *  the new frame count are dropped. */
export function remapSweepFrames(prev: ContextLoopConfig, next: ContextLoopConfig, count: number): ContextLoopConfig {
  const before = sweepCombos(prev);
  const after = sweepCombos(next);
  if (!before || !after) return keepFramesWithin(next, after?.length ?? count);
  const at = new Map(after.map((c, i) => [c, i]));
  const move = (i: number): number | undefined => {
    const c = before[i];
    return c === undefined ? undefined : at.get(c);
  };
  const locks: Record<string, number> = {};
  for (const [k, seed] of Object.entries(next.seed_locks)) {
    const to = move(Number(k));
    if (to !== undefined) locks[String(to)] = seed;
  }
  const bypass = next.bypass_frames.map(move).filter((i): i is number => i !== undefined);
  return { ...next, seed_locks: locks, bypass_frames: [...new Set(bypass)].sort((a, b) => a - b) };
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
   *  Sorted, deduped, non-negative. Lowering the count drops entries past
   *  it, and a sweep change moves them with their combination
   *  (`keepFramesWithin`, `remapSweepFrames`). Empty by default. */
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
