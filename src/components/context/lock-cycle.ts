import type { ModuleEntry } from "../../widgets/_shared";
import { setFrameOverride, clearFrameOverride, withFrameInstance } from "./frame-overrides";

type Instance = NonNullable<ModuleEntry["instance"]>;

/** The row lock's three states: roll freely, lock the seed (same roll while
 *  nothing else changes), lock the value (always the option the last run
 *  picked, whatever the seed or the rules above it do). */
export type LockState = "off" | "seed" | "value";

/** What a value lock holds: one option id, or a multi-pick row's ids in
 *  pick order. */
export type LockPick = string | readonly string[];

/** The option ids a value lock holds (one for a single pick), or none. */
export function lockedOptionIds(inst: Instance | undefined): string[] {
  if (typeof inst?.locked_option_id === "string" && inst.locked_option_id) return [inst.locked_option_id];
  const ids = inst?.locked_option_ids;
  return Array.isArray(ids) ? ids.filter((i): i is string => typeof i === "string" && !!i) : [];
}

/** `inst`'s value lock as text against `m`'s options (an id when its option
 *  is gone), a multi-pick row's joined by ", ". */
export function lockedText(m: ModuleEntry, inst: Instance | undefined): string {
  const options = (m.payload as { options?: unknown } | undefined)?.options;
  return lockedOptionIds(inst).map((id) => {
    const hit = Array.isArray(options)
      ? options.find((o) => (o as { id?: unknown })?.id === id) as { value?: unknown } | undefined
      : undefined;
    return typeof hit?.value === "string" ? hit.value : id;
  }).join(", ");
}

/** A last-run pick worth locking: a non-empty id or list of ids. */
export function hasPick(pick: LockPick | null | undefined): pick is LockPick {
  return typeof pick === "string" ? !!pick : Array.isArray(pick) && pick.length > 0;
}

export function lockStateOf(inst: Instance | undefined): LockState {
  if (lockedOptionIds(inst).length) return "value";
  if (typeof inst?.locked_seed === "number") return "seed";
  return "off";
}

/** Next state for one click: off → seed → value → off. The value step is
 *  skipped (seed → off) when there is no single last-run pick to lock. */
export function nextLockState(cur: LockState, pick: LockPick | null): LockState {
  if (cur === "off") return "seed";
  if (cur === "seed" && hasPick(pick)) return "value";
  return "off";
}

/** The lock fields each state writes. `seed` keeps the seed it is given;
 *  `value` drops the seed (the option is fixed, the seed no longer matters). */
export function lockFields(state: LockState, seed: number, pick: LockPick | null): LockWant {
  if (state === "seed") return { locked_seed: seed };
  if (state === "value" && hasPick(pick)) return valueLock(pick);
  return {};
}

/** The lock fields a value lock on `pick` writes: `locked_option_id` for one
 *  option, `locked_option_ids` for a multi-pick row's list. */
export function valueLock(pick: LockPick): LockWant {
  return typeof pick === "string" ? { locked_option_id: pick } : { locked_option_ids: [...pick] };
}

/** The lock fields of one state. */
export interface LockWant { locked_seed?: number; locked_option_id?: string; locked_option_ids?: string[] }

export const LOCK_KEYS = ["locked_seed", "locked_option_id", "locked_option_ids"] as const;

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Base instance with its lock fields replaced by `want`. Absent fields are
 *  dropped, never written as `null` (a bundle's modified check tells the two
 *  apart). `_ui.last_locked_seed` remembers the last seed for the next lock. */
export function withBaseLock(inst: Instance, want: LockWant): Instance {
  const next = { ...inst } as Record<string, unknown>;
  for (const k of LOCK_KEYS) delete next[k];
  Object.assign(next, want);
  if (typeof want.locked_seed === "number") {
    next._ui = { ...(inst._ui ?? {}), last_locked_seed: want.locked_seed };
  }
  return next as Instance;
}

/** The instance without its WP Toggles lock mark (`_ui.locked_by`): a hand
 *  click on the lock makes the row the user's again, so the toggle that
 *  locked it no longer unlocks it. */
export function withoutLockOwner(inst: Instance): Instance {
  if (!inst._ui?.locked_by) return inst;
  const { locked_by: _drop, ...ui } = inst._ui;
  void _drop;
  return { ...inst, _ui: ui };
}

/** Frame `k`'s lock fields set to `want`, against the base: a field equal to
 *  the base drops out of the frame's patch, a base lock the frame doesn't
 *  want is overridden with `null`. */
export function withFrameLock(
  module: ModuleEntry, frame: number, want: LockWant,
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
    } else if (same(b, w)) {
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
