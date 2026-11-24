/**
 * WP Toggles lock setting — frontend only, like mute / bypass.
 *
 * A toggle with `lock` ("seed" | "value") and `lock_targets` locks those
 * rows of WP Context nodes while it is on (after `needs` / Pick one) and
 * lets go of them when it goes off. Targets are wireless: a Context's
 * codename (`node-codename.ts`) + the row's `_uid`.
 *
 * Switching on captures the last run: a value lock takes the option the row
 * picked (every pick of a multi-pick row; falling back to its seed when it
 * has no pick, e.g. a fixed value), a seed lock the seed it rolled. A run with
 * several frames gets the other frames' picks / seeds as frame overrides.
 * With a frame picked in the Loop's Edit frame (and the row's Context under
 * that Loop), it locks that frame only, from that frame's pick or seed, and
 * marks `_ui.locked_frame`; switching off then lets go of that frame alone.
 * Each row it locks is marked `_ui.locked_by = owner`, and switching off
 * unlocks only rows with that mark: a row locked by hand (or by another
 * toggle) is left alone both ways, and a hand click on the lock drops the
 * mark, so the row is the user's again.
 *
 * Pure data: the canvas glue (`widgets/toggle-lock-canvas.ts`) finds the
 * nodes, reads the last run and writes the values back.
 */
import type { ContextWidgetValue, ModuleEntry } from "../widgets/_shared";
import { LOCK_KEYS, hasPick, lockStateAt, lockStateOf, valueLock, withBaseLock, withFrameLock, type LockPick, type LockWant } from "../components/context/lock-cycle";
import { SEED_LOCKABLE_KINDS } from "../components/context/module-state";
import { effectiveToggles, toggleRows, type LockTarget, type ToggleLock, type TogglesConfig } from "./toggles";

type Instance = NonNullable<ModuleEntry["instance"]>;

/** The `_ui.locked_by` mark of one toggle: its node and its id. */
export const lockOwner = (nodeId: string | number, toggleId: string): string => `toggles:${nodeId}:${toggleId}`;

/** A row's target key (what the picker stores as `uid`). */
export const rowKey = (m: ModuleEntry): string => m._uid ?? m.id;

export const targetKey = (t: LockTarget): string => `${t.node}|${t.uid}`;

/** What the last run of one Context left behind (from its UI payload). */
export interface LastRun {
  /** Row → the seed it rolled (`module_seeds`). */
  seeds: Record<string, number>;
  /** The chain seed, for a row `seeds` doesn't list. */
  chainSeed: number | null;
  /** Row → the option it picked (`module_picks`, the first frame); a
   *  multi-pick row's ids. */
  picks: Record<string, LockPick>;
  /** Frame → row → option(s), one entry per frame run. */
  framePicks: ReadonlyMap<number, Record<string, LockPick>>;
  /** Frame → the seed the node ran that frame with. */
  frameSeeds: ReadonlyMap<number, number>;
}

export const emptyRun = (): LastRun => ({ seeds: {}, chainSeed: null, picks: {}, framePicks: new Map(), frameSeeds: new Map() });

export interface LockResult {
  value: ContextWidgetValue;
  /** Rows it locked. */
  locked: number;
  /** Rows it left alone: locked by hand or by another toggle. */
  kept: number;
  /** Rows with nothing to lock yet (no run, no seed). */
  noRun: number;
}

function markedBy(inst: Instance | undefined, owner: string): boolean {
  return inst?._ui?.locked_by === owner;
}

/** Instance with `_ui.locked_by` set to `owner` (and `locked_frame` to
 * `frame`), or both dropped (`null`). */
function withOwner(inst: Instance, owner: string | null, frame: number | null = null): Instance {
  const ui = { ...(inst._ui ?? {}) };
  if (owner) ui.locked_by = owner;
  else delete ui.locked_by;
  if (owner && frame != null) ui.locked_frame = frame;
  else delete ui.locked_frame;
  const next = { ...inst, _ui: ui };
  if (!Object.keys(ui).length) delete (next as { _ui?: unknown })._ui;
  return next;
}

/** The base's own lock fields. */
function baseLock(inst: Instance | undefined): LockWant {
  const out: Record<string, unknown> = {};
  for (const k of LOCK_KEYS) if (inst?.[k] != null) out[k] = inst[k];
  return out as LockWant;
}

/** One row unlocked: base lock gone, frame lock fields gone, mark gone. A
 *  row locked on one frame only lets go of that frame. */
function released(m: ModuleEntry): ModuleEntry {
  const only = m.instance?._ui?.locked_frame;
  if (typeof only === "number") {
    // The frame goes back to the base: its own lock fields drop out.
    const next = withFrameLock(m, only, baseLock(m.instance));
    return { ...next, instance: withOwner(next.instance ?? {}, null) };
  }
  const inst = withOwner(withBaseLock(m.instance ?? {}, {}), null);
  let next: ModuleEntry = { ...m, instance: inst };
  for (const k of Object.keys(m.iteration_overrides ?? {})) {
    const frame = Number(k);
    if (Number.isInteger(frame)) next = withFrameLock(next, frame, {});
  }
  if (next.iteration_overrides && !Object.keys(next.iteration_overrides).length) {
    const { iteration_overrides: _drop, ...rest } = next;
    void _drop;
    next = rest;
  }
  return next;
}

/** One frame of a row locked from that frame of `run`, or null when that
 *  frame has no run yet. */
function lockedOnFrame(m: ModuleEntry, mode: ToggleLock, owner: string, run: LastRun, frame: number): ModuleEntry | null {
  const key = rowKey(m);
  const got = mode === "value" && m.type === "wildcard" ? run.framePicks.get(frame)?.[key] : undefined;
  const pick = hasPick(got) ? got : null;
  const seed = run.frameSeeds.get(frame) ?? null;
  if (!pick && seed == null) return null;
  const next = withFrameLock(m, frame, pick ? valueLock(pick) : { locked_seed: seed ?? 0 });
  return { ...next, instance: withOwner(next.instance ?? {}, owner, frame) };
}

/** One row locked from `run`, or null when there is nothing to lock it to. */
function locked(m: ModuleEntry, mode: ToggleLock, owner: string, run: LastRun, frame: number | null = null): ModuleEntry | null {
  if (frame != null) return lockedOnFrame(m, mode, owner, run, frame);
  const key = rowKey(m);
  const canPick = m.type === "wildcard";
  const got = mode === "value" && canPick ? run.picks[key] : undefined;
  const pick = hasPick(got) ? got : null;
  const lastSeed = m.instance?._ui?.last_locked_seed;
  const seed = run.seeds[key] ?? run.chainSeed ?? (typeof lastSeed === "number" ? lastSeed : null);
  if (!pick && seed == null) return null;
  const base = pick ? valueLock(pick) : { locked_seed: seed ?? 0 };
  let next: ModuleEntry = { ...m, instance: withOwner(withBaseLock(m.instance ?? {}, base), owner) };
  // Several frames ran: each frame keeps what it had.
  if (pick && run.framePicks.size > 1) {
    for (const [frame, picks] of run.framePicks) {
      const p = picks[key];
      if (hasPick(p)) next = withFrameLock(next, frame, valueLock(p));
    }
  } else if (!pick && run.frameSeeds.size > 1) {
    for (const [frame, s] of run.frameSeeds) next = withFrameLock(next, frame, { locked_seed: s });
  }
  return next;
}

/** Lock the rows `uids` of one Context for `owner`. A row already marked by
 *  `owner` is locked afresh (the mode may have changed). With `frame`, only
 *  that loop frame is locked (and checked for a lock of its own). */
export function lockRows(
  value: ContextWidgetValue,
  uids: ReadonlySet<string>,
  mode: ToggleLock,
  owner: string,
  run: LastRun,
  frame: number | null = null,
): LockResult {
  let lockedN = 0;
  let kept = 0;
  let noRun = 0;
  const modules = value.modules.map((m) => {
    if (!uids.has(rowKey(m))) return m;
    const mine = markedBy(m.instance, owner);
    const state = frame == null ? lockStateOf(m.instance) : lockStateAt(m, frame);
    if (!mine && (state !== "off" || m.instance?._ui?.locked_by)) {
      kept++;
      return m;
    }
    const next = locked(mine ? released(m) : m, mode, owner, run, frame);
    if (!next) {
      noRun++;
      return m;
    }
    lockedN++;
    return next;
  });
  return { value: lockedN ? { ...value, modules } : value, locked: lockedN, kept, noRun };
}

/** Unlock the rows `owner` locked (all of them, or only `uids`). */
export function releaseRows(
  value: ContextWidgetValue,
  owner: string,
  uids?: ReadonlySet<string>,
): { value: ContextWidgetValue; released: number } {
  let n = 0;
  const modules = value.modules.map((m) => {
    if (!markedBy(m.instance, owner) || (uids && !uids.has(rowKey(m)))) return m;
    n++;
    return released(m);
  });
  return { value: n ? { ...value, modules } : value, released: n };
}

/** What one toggle has to do after a config change. */
export interface LockAction {
  toggleId: string;
  release: LockTarget[];
  lock: LockTarget[];
  mode: ToggleLock;
}

interface Active { mode: ToggleLock; targets: LockTarget[] }

function activeLocks(cfg: TogglesConfig | null): Map<string, Active> {
  const out = new Map<string, Active>();
  if (!cfg) return out;
  const eff = effectiveToggles(cfg);
  for (const t of toggleRows(cfg)) {
    if (t.lock && t.lock_targets?.length && eff.get(t.id)) out.set(t.id, { mode: t.lock, targets: t.lock_targets });
  }
  return out;
}

/**
 * The locks to take and let go of between two configs. A toggle that goes
 * on locks its targets, one that goes off (or is removed, or loses its lock
 * setting) lets go of them; while it stays on, added targets are locked and
 * removed ones let go, and a changed mode locks every target afresh.
 */
export function lockPlan(prev: TogglesConfig | null, next: TogglesConfig): LockAction[] {
  const was = activeLocks(prev);
  const now = activeLocks(next);
  const out: LockAction[] = [];
  for (const id of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(id);
    const b = now.get(id);
    let release: LockTarget[] = [];
    let lock: LockTarget[] = [];
    if (a && !b) release = a.targets;
    else if (!a && b) lock = b.targets;
    else if (a && b) {
      if (a.mode !== b.mode) {
        release = a.targets;
        lock = b.targets;
      } else {
        const keep = new Set(b.targets.map(targetKey));
        const had = new Set(a.targets.map(targetKey));
        release = a.targets.filter((t) => !keep.has(targetKey(t)));
        lock = b.targets.filter((t) => !had.has(targetKey(t)));
      }
    }
    if (release.length || lock.length) out.push({ toggleId: id, release, lock, mode: b?.mode ?? a?.mode ?? "seed" });
  }
  return out;
}

/** `cfg` with each toggle's `lock_frame` set from `frames` (toggle id → the
 *  frame its lock went on with, or null for every frame), and dropped for a
 *  toggle that no longer locks (off, or no lock setting). */
export function withLockFrames(cfg: TogglesConfig, frames: ReadonlyMap<string, number | null>): TogglesConfig {
  const live = activeLocks(cfg);
  let changed = false;
  const rows = cfg.rows.map((r) => {
    if (r.kind !== "toggle") return r;
    const want = live.has(r.id) ? (frames.has(r.id) ? frames.get(r.id) ?? null : r.lock_frame ?? null) : null;
    if ((r.lock_frame ?? null) === want) return r;
    changed = true;
    const next = { ...r };
    if (want == null) delete next.lock_frame;
    else next.lock_frame = want;
    return next;
  });
  return changed ? { ...cfg, rows } : cfg;
}

/** A row the lock picker offers. */
export interface LockChoice extends LockTarget {
  /** `codename · node title · row name`. */
  label: string;
  /** The row is a wildcard (it can lock its value). */
  wildcard: boolean;
  /** The row's module kind (`wildcard`, `derivation` …), for its icon. */
  kind: string;
}

/** Whether a row can take `mode`: any seeded kind locks its seed (a
 *  constraint has none), only a wildcard locks its value. */
export function canLock(c: Pick<LockChoice, "kind">, mode: ToggleLock): boolean {
  return mode === "value" ? c.kind === "wildcard" : SEED_LOCKABLE_KINDS.has(c.kind);
}

/** Targets `mode` can't lock (a derivation picked for Lock value, a row
 *  that is no longer a seeded kind). Missing rows aren't counted here. */
export function unfitTargets(
  targets: readonly LockTarget[] | undefined,
  choices: readonly LockChoice[],
  mode: ToggleLock,
): LockTarget[] {
  if (!targets?.length) return [];
  const byKey = new Map(choices.map((c) => [targetKey(c), c]));
  return targets.filter((t) => {
    const c = byKey.get(targetKey(t));
    return !!c && !canLock(c, mode);
  });
}

/** A toggle's targets that no Context on the canvas has (node or row gone). */
export function missingTargets(targets: readonly LockTarget[] | undefined, choices: readonly LockChoice[]): LockTarget[] {
  if (!targets?.length) return [];
  const have = new Set(choices.map(targetKey));
  return targets.filter((t) => !have.has(targetKey(t)));
}

/** Toggle id → its missing targets, for every toggle with a lock. */
export function missingByToggle(cfg: TogglesConfig, choices: readonly LockChoice[]): Map<string, LockTarget[]> {
  const out = new Map<string, LockTarget[]>();
  for (const t of toggleRows(cfg)) {
    if (!t.lock) continue;
    const gone = missingTargets(t.lock_targets, choices);
    if (gone.length) out.set(t.id, gone);
  }
  return out;
}

/** `cfg` with every missing target dropped (the node's "Remove missing
 *  targets" action). */
export function withoutMissingTargets(cfg: TogglesConfig, choices: readonly LockChoice[]): TogglesConfig {
  const have = new Set(choices.map(targetKey));
  const rows = cfg.rows.map((r) => {
    if (r.kind !== "toggle" || !r.lock_targets?.length) return r;
    const kept = r.lock_targets.filter((t) => have.has(targetKey(t)));
    if (kept.length === r.lock_targets.length) return r;
    const next = { ...r, lock_targets: kept };
    if (!kept.length) delete (next as { lock_targets?: unknown }).lock_targets;
    return next;
  });
  return { ...cfg, rows };
}

/** The choices one Context offers: each row that has a seed to lock
 *  (constraints have none), labelled. */
export function contextChoices(codename: string, title: string, value: ContextWidgetValue): LockChoice[] {
  return value.modules.filter((m) => SEED_LOCKABLE_KINDS.has(m.type)).map((m) => ({
    node: codename,
    uid: rowKey(m),
    label: `${codename} · ${title} · ${m.meta?.name || m.id}`,
    wildcard: m.type === "wildcard",
    kind: m.type,
  }));
}
