/**
 * Shared types for the conflict-row sub-components rendered inside
 * `ConflictModal.vue`. Lives in a plain `.ts` module — see
 * `../conflict-types.ts` for the rationale, summarised: `vue-tsc`
 * resolves named-type imports from `*.vue` files, but plain `tsc` and
 * IDE diagnostic engines reading `src/env.d.ts` only see the SFC's
 * default export. Co-locating sub-component types here keeps both
 * worlds happy (the "Task 18 type-export trap").
 *
 * `ChainStep.id` is the entity-id field — NOT `uuid`. The entire TS
 * import-export surface aligned to `id` in commit `9cf37c7` (Task 17);
 * `chain` entries follow the same convention so the tier-3 chain can
 * be derived from `(entity-blob).id` lookups directly.
 */

/**
 * One link in a tier-3 nesting chain. Renders as a row inside
 * `Tier3ChainViz`'s expanded body, with depth-proportional left
 * padding (idx * 16px) and a `└ contains: ` prefix on every step
 * after the outer bundle.
 */
export interface ChainStep {
  /** Human-readable bundle / module name shown in the row. */
  name: string;
  /** Entity id (8-hex short UUID). Used as the `v-for :key`. */
  id: string;
}
