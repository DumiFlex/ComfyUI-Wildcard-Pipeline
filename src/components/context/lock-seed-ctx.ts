import type { InjectionKey } from "vue";
import type { ModuleEntry } from "../../widgets/_shared";

/**
 * Resolves the seed to pin when the user locks a module's seed — the seed the
 * module ACTUALLY rolled: frame #k's captured seed when an iteration frame is
 * active, else the module's last-run seed. Provided by ContextWidget (which
 * owns the frame cursor + the run-seed readers) and injected by
 * SeedLockControls, which lives deep inside the per-kind edit modal. Returns
 * null when unavailable (cold start, no run yet) → the control falls back to
 * its remembered seed, then a fresh random.
 */
export type LockSeedResolver = (module: ModuleEntry) => number | null;

export const LockSeedKey: InjectionKey<LockSeedResolver> = Symbol("wpLockSeed");
