/**
 * Strict v1 validator for bundle root.
 *
 * Bundles carry the canonical engine-row shape with `children[]` —
 * each child is itself a v1 module row. Discriminated union on
 * children's `type` field; single-version-per-root invariant.
 */
import { z } from "zod";
import { wildcardV1, fixedValuesV1, combineV1, derivationV1, constraintV1 } from "../module/v1";

export const bundleV1Child = z.discriminatedUnion("type", [
  wildcardV1,
  fixedValuesV1,
  combineV1,
  derivationV1,
  constraintV1,
]);

export const bundleV1 = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  color: z.string().nullable(),
  category_id: z.string().nullable(),
  tags: z.array(z.string()),
  is_favorite: z.boolean(),
  children: z.array(bundleV1Child),
}).strict();
