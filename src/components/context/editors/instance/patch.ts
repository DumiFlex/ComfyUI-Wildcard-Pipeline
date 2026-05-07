/**
 * Mutation invariant: instance fields are immutable values. Top-level
 * fields swap via `patchInstance(field, value)`. Nested record/array
 * fields (e.g. `option_weights`) only mutate via `patchInstanceMapEntry`.
 * Direct in-place mutation is forbidden.
 *
 * See: docs/superpowers/specs/2026-05-07-instance-overrides-modal-design.md §5.2
 */
import type { ModuleEntry } from "../../../../widgets/_shared";

type Instance = NonNullable<ModuleEntry["instance"]>;
type MapField = "option_weights";   // currently the only nested record field

/** Shallow-merge `field: value` into `module.instance`. Returns a Partial<ModuleEntry>
 *  patch to emit upward — caller passes through Vue update event. */
export function patchInstance<K extends keyof Instance>(
  module: ModuleEntry,
  field: K,
  value: Instance[K] | null,
): Partial<ModuleEntry> {
  const next: Instance = {
    ...(module.instance ?? {}),
    [field]: value,
  };
  return { instance: next };
}

/** Mutate one entry inside a nested record (option_weights today; future
 *  fields land here too). Null value deletes the key from the map. */
export function patchInstanceMapEntry(
  module: ModuleEntry,
  field: MapField,
  key: string,
  value: number | null,
): Partial<ModuleEntry> {
  const current = (module.instance?.[field] ?? null) as Record<string, number> | null;
  const nextMap: Record<string, number> = { ...(current ?? {}) };
  if (value === null) {
    delete nextMap[key];
  } else {
    nextMap[key] = value;
  }
  const nextInstance: Instance = {
    ...(module.instance ?? {}),
    [field]: nextMap,
  };
  return { instance: nextInstance };
}
