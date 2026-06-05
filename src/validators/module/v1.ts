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
    var_binding: z.string(),
    sub_categories: z.array(z.string()),
    options: z.array(z.object({
      id: z.string(),
      value: z.string(),
      weight: z.number(),
      sub_category: z.string().nullable(),
    })),
  }),
}).strict();

export const fixedValuesV1 = moduleRowBase.extend({
  type: z.literal("fixed_values"),
  payload: z.object({
    entries: z.array(z.object({
      variable_name: z.string(),
      value: z.string(),
    })),
  }),
}).strict();

export const combineV1 = moduleRowBase.extend({
  type: z.literal("combine"),
  payload: z.object({
    template: z.string(),
    output_var: z.string(),
    input_vars: z.array(z.string()),
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
    source_wildcard_id: z.string(),
    target_wildcard_id: z.string(),
    exceptions: z.array(z.unknown()),
    matrix: z.record(z.unknown()),
  }),
}).strict();
