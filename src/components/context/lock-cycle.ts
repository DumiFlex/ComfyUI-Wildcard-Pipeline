import type { ModuleEntry } from "../../widgets/_shared";
import { setFrameOverride, clearFrameOverride, withFrameInstance } from "./frame-overrides";

type Instance = NonNullable<ModuleEntry["instance"]>;

/** The row lock's three states: roll freely, lock the seed (same roll while
 *  nothing else changes), lock the value (always the option the last run
 *  picked, whatever the seed or the rules above it do). */
export type LockState = "off" | "seed" | "value";

export function lockStateOf(inst: Instance | undefined): LockState {
  if (typeof inst?.locked_option_id === "string" && inst.locked_option_id) return "value";
  if (typeof inst?.locked_seed === "number") return "seed";
  return "off";
}

/** Next state for one click: off → seed → value → off. The value step is
 *  skipped (seed → off) when there is no single last-run pick to lock. */
export function nextLockState(cur: LockState, pick: string | null): LockState {
  if (cur === "off") return "seed";
  if (cur === "seed" && pick) return "value";
  return "off";
}

/** The lock fields each state writes. `seed` keeps the seed it is given;
 *  `value` drops the seed (the option is fixed, the seed no longer matters). */
export function lockFields(
  state: LockState, seed: number, pick: string | null,
): { locked_seed?: number; locked_option_id?: string } {
  if (state === "seed") return { locked_seed: seed };
  if (state === "value" && pick) return { locked_option_id: pick };
  return {};
}

const LOCK_KEYS = ["locked_seed", "locked_option_id"] as const;

/** Base instance with its lock fields replaced by `want`. Absent fields are
 *  dropped, never written as `null` (a bundle's modified check tells the two
 *  apart). `_ui.last_locked_seed` remembers the last seed for the next lock. */
export function withBaseLock(
  inst: Instance, want: { locked_seed?: number; locked_option_id?: string },
): Instance {
  const next = { ...inst } as Record<string, unknown>;
  for (const k of LOCK_KEYS) delete next[k];
  Object.assign(next, want);
  if (typeof want.locked_seed === "number") {
    next._ui = { ...(inst._ui ?? {}), last_locked_seed: want.locked_seed };
  }
  return next as Instance;
}

/** Frame `k`'s lock fields set to `want`, against the base: a field equal to
 *  the base drops out of the frame's patch, a base lock the frame doesn't
 *  want is overridden with `null`. */
export function withFrameLock(
  module: ModuleEntry, frame: number,
  want: { locked_seed?: number; locked_option_id?: string },
): ModuleEntry {
  const base = (module.instance ?? {}) as Record<string, unknown>;
  const patch = { ...(module.iteration_overrides?.[String(frame)] ?? {}) } as Record<string, unknown>;
  for (const k of LOCK_KEYS) {
    const w = want[k];
    const b = base[k];
    const baseSet = b !== undefined && b !== null;
    if (w === undefined) {
      if (baseSet) patch[k] = null;
      else delete patch[k];
    } else if (b === w) {
      delete patch[k];
    } else {
      patch[k] = w;
    }
  }
  let next = clearFrameOverride(module, frame);
  if (Object.keys(patch).length) next = setFrameOverride(next, frame, patch);
  return next;
}

/** The lock state at frame `k` (or the base when no frame is active). */
export function lockStateAt(module: ModuleEntry, frame: number | null): LockState {
  return lockStateOf(withFrameInstance(module, frame).instance);
}
