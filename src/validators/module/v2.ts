/**
 * Strict v2 module validators (SP1 multi-tag + tag axes).
 *
 * `wildcard` changes shape v1 -> v2: option `sub_category` becomes
 * `sub_categories: string[]`, plus an optional `tag_groups` axis map and its
 * per-group `tag_group_kinds` ("classify" | "accepts"). `tag_group_kinds` is
 * additive — absence means every group is classify (v1 behaviour) — so it is
 * listed here (not left to the lenient strip) precisely so an exported/shared
 * ACCEPTS axis survives the round-trip instead of silently degrading to
 * classify. The constraint's optional `target_select` reach selector lives in
 * v1 for the same reason. Other subtypes re-export v1 so the registry has a
 * complete `:2` row. Inner payloads stay non-`.strict()` (lenient, mirroring
 * v1 — the engine is the per-field authority on install).
 */
import { z } from "zod";

import { combineV1, constraintV1, derivationV1, fixedValuesV1, moduleRowBase } from "./v1";

export const wildcardV2 = moduleRowBase.extend({
  type: z.literal("wildcard"),
  payload: z.object({
    var_binding: z.string().optional(),
    sub_categories: z.array(z.string()).optional(),
    tag_groups: z.record(z.string(), z.array(z.string())).optional(),
    tag_group_kinds: z.record(z.string(), z.enum(["classify", "accepts"])).optional(),
    options: z.array(z.object({
      id: z.string(),
      value: z.string(),
      weight: z.number(),
      sub_categories: z.array(z.string()).optional(),
      is_null: z.boolean().optional(),
      // Send-to-negative (catalog v8, additive): listed so a shared option's
      // negative survives the strict round-trip instead of being stripped.
      negative: z.string().optional(),
      // Fallback (catalog v9, additive): the one option used only when
      // nothing else is left to pick. Kept so the strict round-trip
      // doesn't turn it back into an ordinary option.
      fallback: z.boolean().optional(),
    })),
  }),
}).strict();

// v8 send-to-negative adds an optional `negative` to fixed values and to the
// combine payload; otherwise the v1 shapes carry over unchanged.
export const fixedValuesV2 = fixedValuesV1.extend({
  payload: z.object({
    values: z.array(z.object({
      id: z.string(),
      name: z.string(),
      value: z.string(),
      negative: z.string().optional(),
    })),
  }),
}).strict();
export const combineV2 = combineV1.extend({
  payload: z.object({
    template: z.string(),
    output_var: z.string(),
    input_vars: z.array(z.string()).optional(),
    negative: z.string().optional(),
  }),
}).strict();
export const derivationV2 = derivationV1;
export const constraintV2 = constraintV1;
