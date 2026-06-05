import { describe, it, expect, beforeEach } from "vitest";
import {
  migratePayload,
  registerMigrator,
  _resetRegistryForTests,
} from "@/manager/import-export/migrations";

describe("migratePayload contract", () => {
  beforeEach(() => _resetRegistryForTests());

  it("runs a single forward step on module", () => {
    registerMigrator({
      kind: "module",
      fromVersion: 1,
      migrate: (payload) => ({ ...payload, added_in_v2: true }),
    });
    const out = migratePayload({ id: "m1" }, "module", 1, 2);
    expect(out).toMatchObject({ id: "m1", added_in_v2: true });
  });

  it("chains multiple steps for a longer interval", () => {
    registerMigrator({ kind: "module", fromVersion: 1, migrate: (p) => ({ ...p, v2: true }) });
    registerMigrator({ kind: "module", fromVersion: 2, migrate: (p) => ({ ...p, v3: true }) });
    const out = migratePayload({ id: "m1" }, "module", 1, 3);
    expect(out).toMatchObject({ v2: true, v3: true });
  });

  it("bundle migrator MUST recurse into children — single-version-per-root invariant", () => {
    registerMigrator({
      kind: "module", fromVersion: 1,
      migrate: (payload) => ({ ...payload, nsfw: false }),
    });
    registerMigrator({
      kind: "bundle", fromVersion: 1,
      migrate: (payload, ctx) => ({
        ...payload,
        children: ((payload.children as unknown[]) ?? []).map((child) =>
          ctx.applyModuleStep(child as Record<string, unknown>, 1)
        ),
      }),
    });
    const out = migratePayload(
      { id: "b1", children: [{ id: "wc1", type: "wildcard" }] },
      "bundle", 1, 2,
    );
    const child = (out.children as Record<string, unknown>[])[0];
    expect(child.nsfw).toBe(false);
  });

  it("rejects calling a non-registered migrator", () => {
    expect(() => migratePayload({}, "module", 1, 2))
      .toThrow(/no migrator for module 1->2/);
  });

  it("supports context injection when requires_context is declared", () => {
    registerMigrator({
      kind: "module", fromVersion: 1,
      requiresContext: ["categoryTree"],
      migrate: (payload, ctx) => ({
        ...payload,
        category_path: ctx.categoryTree?.lookup(payload.category_id as string),
      }),
    });
    const ctx = { categoryTree: { lookup: (id: string) => `path/of/${id}` } };
    const out = migratePayload({ id: "m1", category_id: "c1" }, "module", 1, 2, ctx);
    expect(out.category_path).toBe("path/of/c1");
  });

  it("throws when requires_context is declared but missing", () => {
    registerMigrator({
      kind: "module", fromVersion: 1,
      requiresContext: ["categoryTree"],
      migrate: (payload) => payload,
    });
    expect(() => migratePayload({ id: "m1" }, "module", 1, 2))
      .toThrow(/requires context.*categoryTree/);
  });
});
