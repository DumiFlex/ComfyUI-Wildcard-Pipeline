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
    options: [{ id: "opt001a", value: "serene", weight: 1, sub_category: null }],
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
