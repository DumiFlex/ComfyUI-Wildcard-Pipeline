import { describe, it, expect } from "vitest";
import {
  buildBundlePublishable,
  buildModulePublishable,
  buildPublishBody,
  normalizeBundleChild,
} from "@/manager/import-export/single-row-publish";
import type { BundleRow, ModuleRow } from "@/manager/api/types";

// A bundle child as the engine stores it: WP_Context widget snapshot --
// name under `meta`, payload in widget form, a local `history` sidecar,
// plus widget-only extras. It ships verbatim (history stripped); the
// community treats it opaquely.
const storedWidgetChild: Record<string, unknown> = {
  id: "wc001abc",
  type: "wildcard",
  enabled: true,
  collapsed: false,
  meta: { name: "starter-mood", description: "", category_id: null, tags: [] },
  instance: {},
  payload_hash: "h".repeat(64),
  payload: {
    var_binding: "mood",
    sub_categories: [],
    options: [{ id: "opt001a", value: "serene", weight: 1, sub_categories: [] }],
    history: [{ saved_at: "2026-06-06T00:00:00Z", name: "x", payload: {} }],
  },
};

describe("normalizeBundleChild", () => {
  it("ships the widget snapshot verbatim, preserving meta.name", () => {
    const out = normalizeBundleChild(storedWidgetChild);
    // The whole point of the fix: meta (where the name lives) survives,
    // so an installed bundle round-trips to named children -- not the
    // "(unnamed)" the flatten approach produced.
    expect((out.meta as Record<string, unknown>).name).toBe("starter-mood");
    expect(out.type).toBe("wildcard");
    expect(out.instance).toBeDefined();
  });

  it("strips the local history sidecar from the child payload", () => {
    const out = normalizeBundleChild(storedWidgetChild);
    const payload = out.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("history");
    expect(payload.options).toBeDefined();
  });
});

describe("buildBundlePublishable", () => {
  const bundleRow = {
    id: "bd001abc",
    name: "starter-bundle",
    description: "",
    color: null,
    category_id: null,
    tags: [],
    is_favorite: false,
    children: [storedWidgetChild],
    payload_hash: "b".repeat(64),
    version: 1,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    content_rating: "safe" as const,
  } as unknown as BundleRow;

  it("ships widget children that pass strict bundle validation", () => {
    const pub = buildBundlePublishable(bundleRow);
    // Widget-shaped children (meta/instance/enabled) now validate
    // against the loose bundleV1Child. Pre-fix they failed with dozens
    // of "name Required" + "Unrecognized key" errors.
    expect(() =>
      buildPublishBody({
        payload: pub.payload,
        name: pub.name,
        description: pub.description,
      }),
    ).not.toThrow();
    const child = (pub.payload.children as Record<string, unknown>[])[0];
    expect((child.meta as Record<string, unknown>).name).toBe("starter-mood");
  });
});

describe("buildModulePublishable", () => {
  // A real edited fixed_values row: payload.values (NOT entries) plus a
  // local `history` sidecar that must not be published.
  const editedFixedValues = {
    id: "fv77abcd",
    type: "fixed_values",
    name: "Starter style",
    description: "nice description",
    category_id: null,
    tags: [],
    is_favorite: false,
    payload: {
      values: [{ id: "79243931", name: "style", value: "oil painting" }],
      history: [
        { saved_at: "2026-06-06T06:17:32.383Z", name: "Starter style", payload: {} },
      ],
    },
    payload_hash: "h".repeat(64),
    version: 2,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    content_rating: "safe" as const,
  } as unknown as ModuleRow;

  it("strips the local history sidecar from the published payload", () => {
    const pub = buildModulePublishable(editedFixedValues);
    const inner = pub.payload.payload as Record<string, unknown>;
    expect(inner).not.toHaveProperty("history");
    expect(inner.values).toBeDefined();
  });

  it("a fixed_values row (values shape, history stripped) passes strict validation", () => {
    const pub = buildModulePublishable(editedFixedValues);
    expect(() =>
      buildPublishBody({
        payload: pub.payload,
        name: pub.name,
        description: pub.description,
      }),
    ).not.toThrow();
  });
});

describe("buildModulePublishable — constraint axis-name backfill", () => {
  // The two wildcards the constraint points at, as they appear in the live
  // module catalog (id -> name). Same lookup the ConstraintEditor uses.
  const subjectRow = { id: "subj0001", type: "wildcard", name: "Starter subject" } as unknown as ModuleRow;
  const moodRow = { id: "mood0001", type: "wildcard", name: "Starter mood" } as unknown as ModuleRow;
  const catalog: ModuleRow[] = [subjectRow, moodRow];

  /** A constraint row whose payload carries ids but NO cached names -- the
   *  starter-recipe / never-opened-in-editor case the fix targets. */
  function constraintRow(payload: Record<string, unknown>): ModuleRow {
    return {
      id: "cn000001",
      type: "constraint",
      name: "Starter pairing",
      description: "",
      category_id: null,
      tags: [],
      is_favorite: false,
      payload,
      payload_hash: "h".repeat(64),
      version: 1,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      content_rating: "safe" as const,
    } as unknown as ModuleRow;
  }

  it("backfills source/target names from the catalog when absent", () => {
    const row = constraintRow({
      source_wildcard_id: "subj0001",
      target_wildcard_id: "mood0001",
      matrix: {},
      exceptions: [],
    });
    const pub = buildModulePublishable(row, catalog);
    const inner = pub.payload.payload as Record<string, unknown>;
    expect(inner.source_wildcard_name).toBe("Starter subject");
    expect(inner.target_wildcard_name).toBe("Starter mood");
  });

  it("does NOT overwrite a name that's already cached on the payload", () => {
    const row = constraintRow({
      source_wildcard_id: "subj0001",
      target_wildcard_id: "mood0001",
      source_wildcard_name: "Custom source label",
      target_wildcard_name: "Custom target label",
      matrix: {},
      exceptions: [],
    });
    const pub = buildModulePublishable(row, catalog);
    const inner = pub.payload.payload as Record<string, unknown>;
    expect(inner.source_wildcard_name).toBe("Custom source label");
    expect(inner.target_wildcard_name).toBe("Custom target label");
  });

  it("leaves a name absent when its id is not in the catalog (dangling ref)", () => {
    const row = constraintRow({
      source_wildcard_id: "subj0001",
      target_wildcard_id: "gone9999",
      matrix: {},
      exceptions: [],
    });
    const pub = buildModulePublishable(row, catalog);
    const inner = pub.payload.payload as Record<string, unknown>;
    expect(inner.source_wildcard_name).toBe("Starter subject");
    expect(inner).not.toHaveProperty("target_wildcard_name");
  });

  it("is a no-op for non-constraint payloads", () => {
    const fixedRow = {
      id: "fv000001",
      type: "fixed_values",
      name: "Starter style",
      description: "",
      category_id: null,
      tags: [],
      is_favorite: false,
      payload: { values: [{ id: "v0000001", name: "style", value: "oil painting" }] },
      payload_hash: "h".repeat(64),
      version: 1,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      content_rating: "safe" as const,
    } as unknown as ModuleRow;
    const pub = buildModulePublishable(fixedRow, catalog);
    const inner = pub.payload.payload as Record<string, unknown>;
    expect(inner).not.toHaveProperty("source_wildcard_name");
    expect(inner).not.toHaveProperty("target_wildcard_name");
    expect(inner.values).toBeDefined();
  });

  it("no catalog passed (default) leaves the payload untouched", () => {
    const row = constraintRow({
      source_wildcard_id: "subj0001",
      target_wildcard_id: "mood0001",
      matrix: {},
      exceptions: [],
    });
    const pub = buildModulePublishable(row);
    const inner = pub.payload.payload as Record<string, unknown>;
    expect(inner).not.toHaveProperty("source_wildcard_name");
    expect(inner).not.toHaveProperty("target_wildcard_name");
  });
});

describe("buildModulePublishable — constraint axis-group backfill", () => {
  // The grouping (tag_groups) lives on the WILDCARDS, not the constraint. These
  // are the source/target wildcards as they sit in the live module catalog.
  const moodWc = {
    id: "mood0001", type: "wildcard", name: "mood",
    payload: { var_binding: "mood", tag_groups: { temperament: ["bold", "serene"] } },
  } as unknown as ModuleRow;
  const colorWc = {
    id: "color001", type: "wildcard", name: "color",
    payload: {
      var_binding: "color",
      tag_groups: { saturation: ["vivid", "muted", "pastel"], tone: ["light", "medium", "dark"] },
    },
  } as unknown as ModuleRow;
  // Single-axis wildcard: no tag_groups → nothing to snapshot.
  const flatWc = {
    id: "flat0001", type: "wildcard", name: "flat", payload: { var_binding: "flat" },
  } as unknown as ModuleRow;
  const catalog: ModuleRow[] = [moodWc, colorWc, flatWc];

  function constraintRow(payload: Record<string, unknown>): ModuleRow {
    return {
      id: "cn000002", type: "constraint", name: "Mood x Color",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload, payload_hash: "h".repeat(64), version: 1,
      created_at: "2026-01-01", updated_at: "2026-01-01", content_rating: "safe" as const,
    } as unknown as ModuleRow;
  }

  it("snapshots the source/target wildcards' tag_groups into the published constraint", () => {
    const row = constraintRow({
      source_wildcard_id: "mood0001", target_wildcard_id: "color001", matrix: {}, exceptions: [],
    });
    const inner = buildModulePublishable(row, catalog).payload.payload as Record<string, unknown>;
    expect(inner.source_groups).toEqual({ temperament: ["bold", "serene"] });
    expect(inner.target_groups).toEqual({
      saturation: ["vivid", "muted", "pastel"], tone: ["light", "medium", "dark"],
    });
  });

  it("does NOT overwrite groups already embedded on the payload", () => {
    const row = constraintRow({
      source_wildcard_id: "mood0001", target_wildcard_id: "color001",
      source_groups: { custom: ["x"] }, matrix: {}, exceptions: [],
    });
    const inner = buildModulePublishable(row, catalog).payload.payload as Record<string, unknown>;
    expect(inner.source_groups).toEqual({ custom: ["x"] });
    expect(inner.target_groups).toBeDefined(); // target still backfilled
  });

  it("leaves groups absent for a single-axis wildcard or a dangling ref", () => {
    const row = constraintRow({
      source_wildcard_id: "flat0001", target_wildcard_id: "gone9999", matrix: {}, exceptions: [],
    });
    const inner = buildModulePublishable(row, catalog).payload.payload as Record<string, unknown>;
    expect(inner).not.toHaveProperty("source_groups");
    expect(inner).not.toHaveProperty("target_groups");
  });

  it("a constraint carrying snapshotted groups still passes strict validation", () => {
    const row = constraintRow({
      source_wildcard_id: "mood0001", target_wildcard_id: "color001", matrix: {}, exceptions: [],
    });
    const pub = buildModulePublishable(row, catalog);
    expect(() =>
      buildPublishBody({ payload: pub.payload, name: pub.name, description: pub.description }),
    ).not.toThrow();
  });
});
