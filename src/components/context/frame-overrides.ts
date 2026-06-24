import type { ModuleEntry } from "../../widgets/_shared";

type Instance = NonNullable<ModuleEntry["instance"]>;
type IterationOverrides = NonNullable<ModuleEntry["iteration_overrides"]>;

/** Effective module at frame `k`: base instance overlaid with the frame's
 *  override patch. Returns the same reference when there's nothing to overlay. */
export function withFrameInstance(module: ModuleEntry, frame: number | null): ModuleEntry {
  if (frame == null) return module;
  const patch = module.iteration_overrides?.[String(frame)];
  if (!patch) return module;
  return { ...module, instance: { ...(module.instance ?? {}), ...patch } };
}

/** Changed override fields between base and edited instances, scoped to `fields`.
 *  Per-field JSON compare (values are small + JSON-able). Accepts loose
 *  Record type so callers can pass plain object literals without casting. */
export function diffInstance(
  base: Record<string, unknown> | Instance | undefined,
  edited: Record<string, unknown> | Instance | undefined,
  fields: readonly string[],
): Record<string, unknown> {
  const b = (base ?? {}) as Record<string, unknown>;
  const e = (edited ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (JSON.stringify(b[f]) !== JSON.stringify(e[f])) out[f] = e[f];
  }
  return out;
}

/** Merge `patch` into the module's frame override (clone). Empty result drops
 *  the frame key; empty map drops `iteration_overrides` entirely. */
export function setFrameOverride(
  module: ModuleEntry, frame: number, patch: Record<string, unknown>,
): ModuleEntry {
  const map: IterationOverrides = { ...(module.iteration_overrides ?? {}) };
  const key = String(frame);
  const merged = { ...(map[key] ?? {}), ...patch } as Partial<Instance>;
  if (Object.keys(merged).length === 0) {
    delete map[key];
  } else {
    map[key] = merged;
  }
  const out: ModuleEntry = { ...module, iteration_overrides: map };
  if (Object.keys(map).length === 0) delete out.iteration_overrides;
  return out;
}

/** Remove a frame's override entirely (clone). */
export function clearFrameOverride(module: ModuleEntry, frame: number): ModuleEntry {
  if (!module.iteration_overrides) return module;
  const map: IterationOverrides = { ...module.iteration_overrides };
  delete map[String(frame)];
  const out: ModuleEntry = { ...module, iteration_overrides: map };
  if (Object.keys(map).length === 0) delete out.iteration_overrides;
  return out;
}

/** Toggle locked_seed for ONE frame (the row quick-lock when a frame is active).
 *  Locks with `fallback` if currently unlocked at that frame; otherwise unlocks —
 *  writing an explicit `null` when the BASE is locked (to override it on this frame)
 *  or dropping the frame's locked_seed when the base is already unlocked. */
export function toggleFrameLock(module: ModuleEntry, frame: number, fallback: number): ModuleEntry {
  const eff = withFrameInstance(module, frame).instance ?? {};
  const baseLocked = typeof module.instance?.locked_seed === "number";
  if (typeof eff.locked_seed === "number") {
    if (baseLocked) return setFrameOverride(module, frame, { locked_seed: null });
    const rest = { ...(module.iteration_overrides?.[String(frame)] ?? {}) } as Record<string, unknown>;
    delete rest.locked_seed;
    let next = clearFrameOverride(module, frame);
    if (Object.keys(rest).length) next = setFrameOverride(next, frame, rest);
    return next;
  }
  return setFrameOverride(module, frame, { locked_seed: fallback });
}

/** Per-frame enabled state at frame `k`: the explicit `frame_enabled[k]`
 *  override if present, else the legacy `disabled_frames` blocklist folded in
 *  (a listed frame reads as `false`), else `undefined` — meaning "no override,
 *  use base `enabled`". */
export function frameEnabledAt(module: ModuleEntry, k: number): boolean | undefined {
  const fe = module.frame_enabled?.[String(k)];
  if (typeof fe === "boolean") return fe;
  if ((module.disabled_frames ?? []).includes(k)) return false;
  return undefined;
}

/** Effective enabled state in the current view: `frame_enabled[k] ?? base
 *  enabled` when a frame is active, base `enabled` otherwise. */
export function effectiveEnabled(module: ModuleEntry, frame: number | null): boolean {
  const base = module.enabled !== false;
  if (frame == null) return base;
  return frameEnabledAt(module, frame) ?? base;
}

/** Per-frame enable override vs base at `frame`: "on" (forced on while base
 *  off), "off" (forced off while base on), or null (no frame active / no
 *  override / equals base). Drives the on-#k / off-#k row badge. */
export function frameEnableOverride(
  module: ModuleEntry, frame: number | null,
): "on" | "off" | null {
  if (frame == null) return null;
  const fe = frameEnabledAt(module, frame);
  if (fe == null) return null;
  const base = module.enabled !== false;
  if (fe === base) return null;
  return fe ? "on" : "off";
}

/** Toggle a module's per-frame enable state for ONE frame (the row checkbox when
 *  a frame is active). Sets `frame_enabled[frame]` to the opposite of the current
 *  effective state — symmetric, so a base-off module turns ON for the frame and a
 *  base-on module turns OFF. Migrates any legacy `disabled_frames` into the map,
 *  then drops entries that match base so only real overrides persist. Base
 *  `enabled` is never touched. */
export function toggleFrameEnabled(module: ModuleEntry, frame: number): ModuleEntry {
  const base = module.enabled !== false;
  const next = !(frameEnabledAt(module, frame) ?? base);
  const map: Record<string, boolean> = { ...(module.frame_enabled ?? {}) };
  for (const df of module.disabled_frames ?? []) map[String(df)] = false;
  map[String(frame)] = next;
  for (const key of Object.keys(map)) {
    if (map[key] === base) delete map[key];
  }
  const out: ModuleEntry = { ...module };
  delete out.disabled_frames;
  if (Object.keys(map).length === 0) delete out.frame_enabled;
  else out.frame_enabled = map;
  return out;
}
