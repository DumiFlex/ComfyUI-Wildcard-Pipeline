/**
 * Strict v1 validators per module subtype.
 *
 * See community-web spec
 * docs/superpowers/specs/2026-06-05-schema-versioning-migration-design.md
 * §2 #1 — sister is the authority on structural validity. Each subtype
 * gets its own .strict() Zod schema; the tolerant variant (.strip()) is
 * built at registry lookup time in ../index.ts.
 */
import { z } from "zod";

const moduleRowBase = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  category_id: z.string().nullable(),
  tags: z.array(z.string()),
  is_favorite: z.boolean(),
});

export const wildcardV1 = moduleRowBase.extend({
  type: z.literal("wildcard"),
  payload: z.object({
    // var_binding + sub_categories are engine-optional (wildcard_handler
    // reads them via .get with defaults). `is_null` is a real option
    // field (null-option contract) the original schema omitted -- strip
    // would have dropped it, producing an empty-value option the
    // consumer's engine rejects on install.
    var_binding: z.string().optional(),
    sub_categories: z.array(z.string()).optional(),
    options: z.array(z.object({
      id: z.string(),
      value: z.string(),
      weight: z.number(),
      sub_category: z.string().nullable().optional(),
      is_null: z.boolean().optional(),
    })),
  }),
}).strict();

export const fixedValuesV1 = moduleRowBase.extend({
  type: z.literal("fixed_values"),
  // Real engine shape (engine/modules/fixed_values_handler.py): the
  // payload carries `values: [{id, name, value}]`. The original v1
  // schema guessed `entries: [{variable_name, value}]` and was never
  // exercised against a real fixed_values row, so every publish of one
  // failed strict validation on payload.entries.
  payload: z.object({
    values: z.array(z.object({
      id: z.string(),
      name: z.string(),
      value: z.string(),
    })),
  }),
}).strict();

export const combineV1 = moduleRowBase.extend({
  type: z.literal("combine"),
  payload: z.object({
    template: z.string(),
    output_var: z.string(),
    // engine-optional (combine_handler reads input_vars via .get([]))
    input_vars: z.array(z.string()).optional(),
  }),
}).strict();

export const derivationV1 = moduleRowBase.extend({
  type: z.literal("derivation"),
  payload: z.object({
    rules: z.array(z.object({
      id: z.string(),
      branches: z.array(z.unknown()),
      else: z.unknown(),
    })),
  }),
}).strict();

export const constraintV1 = moduleRowBase.extend({
  type: z.literal("constraint"),
  payload: z.object({
    // engine reads source/target via .get (a freshly-created constraint
    // may not have wired them yet); matrix/exceptions default to {}/[].
    source_wildcard_id: z.string().optional(),
    target_wildcard_id: z.string().optional(),
    exceptions: z.array(z.unknown()).optional(),
    matrix: z.record(z.unknown()).optional(),
  }),
}).strict();
