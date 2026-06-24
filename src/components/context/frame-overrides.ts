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
