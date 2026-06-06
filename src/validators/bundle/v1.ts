/**
 * Strict v1 validator for bundle root.
 *
 * A bundle child is NOT a standalone module row -- it is the engine's
 * frozen WIDGET snapshot of a module at bundle-creation time
 * (`{id, type, meta:{name,...}, payload, instance, enabled, collapsed}`)
 * or, for nested bundles, a reference (`{id, type:"bundle", name?,
 * color?, children?}`). The original schema modeled children as flat
 * module rows, which (a) rejected the real snapshot shape on publish
 * and (b) lost the name (it lives under `meta`, not top-level), so an
 * installed bundle round-tripped to "(unnamed)" children.
 *
 * We validate children loosely: require `id` + `type`, enumerate the
 * known snapshot/ref fields so tolerant-mode `.strip()` keeps them
 * (dropping only genuinely-unknown future fields), and treat `payload`
 * opaquely. The engine re-validates each child's payload on install --
 * the community is the transport, not the per-subtype authority for
 * snapshots-with-overrides.
 */
import { z } from "zod";

export const bundleV1Child = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  // Leaf snapshot fields.
  meta: z.record(z.unknown()).optional(),
  payload: z.record(z.unknown()).optional(),
  instance: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
  collapsed: z.boolean().optional(),
  payload_hash: z.string().optional(),
  // Nested-bundle reference fields.
  name: z.string().optional(),
  color: z.string().nullable().optional(),
  children: z.array(z.unknown()).optional(),
});

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
