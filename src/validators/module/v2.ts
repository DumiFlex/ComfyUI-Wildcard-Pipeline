/**
 * Strict v2 module validators (SP1 multi-tag).
 *
 * Only `wildcard` changes shape v1 -> v2: option `sub_category` becomes
 * `sub_categories: string[]`, plus an optional `tag_groups` axis map.
 * The other subtypes are unchanged, re-exported from v1 so the registry
 * has a complete `:2` row. Inner payloads stay non-`.strict()` (lenient,
 * mirroring v1 — the engine is the per-field authority on install).
 */
import { z } from "zod";

import { combineV1, constraintV1, derivationV1, fixedValuesV1, moduleRowBase } from "./v1";

export const wildcardV2 = moduleRowBase.extend({
  type: z.literal("wildcard"),
  payload: z.object({
    var_binding: z.string().optional(),
    sub_categories: z.array(z.string()).optional(),
    tag_groups: z.record(z.string(), z.array(z.string())).optional(),
    options: z.array(z.object({
      id: z.string(),
      value: z.string(),
      weight: z.number(),
      sub_categories: z.array(z.string()).optional(),
      is_null: z.boolean().optional(),
    })),
  }),
}).strict();

// Unchanged shapes for v2 (SP1 only touches the wildcard subtype).
export const fixedValuesV2 = fixedValuesV1;
export const combineV2 = combineV1;
export const derivationV2 = derivationV1;
export const constraintV2 = constraintV1;
