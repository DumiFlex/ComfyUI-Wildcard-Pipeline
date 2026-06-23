import type { SeedListStrategy } from "./types";

export interface SeriesParams { base: number; count: number; strategy: SeedListStrategy }
export interface OverrideFlags { override_seed: boolean; override_count: boolean; override_strategy: boolean }

/** Mirror of wp_nodes/seed_list.py::_resolve_config for the modal preview:
 *  an override flag pulls from the wired loop ONLY when a loop is present;
 *  otherwise the local widget value wins. */
export function resolveSeedListPreview(
  local: SeriesParams,
  flags: OverrideFlags,
  loop: SeriesParams | null,
): { baseSeed: number; count: number; strategy: SeedListStrategy } {
  return {
    baseSeed: flags.override_seed && loop ? loop.base : local.base,
    count: flags.override_count && loop ? loop.count : local.count,
    strategy: flags.override_strategy && loop ? loop.strategy : local.strategy,
  };
}
