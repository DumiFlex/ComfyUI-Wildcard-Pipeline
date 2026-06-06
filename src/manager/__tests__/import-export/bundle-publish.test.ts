import { describe, it, expect, vi } from "vitest";
import {
  buildBundlePublishable,
  buildPublishBody,
  normalizeBundleChild,
} from "@/manager/import-export/single-row-publish";
import type { BundleRow, ModuleRow } from "@/manager/api/types";

// A live library wildcard row, as the module catalog would hold it.
const liveWildcard = {
  id: "wc001abc",
  type: "wildcard",
  name: "starter-mood",
  description: "",
  category_id: null,
  tags: [],
  is_favorite: false,
  payload: {
    var_binding: "mood",
    sub_categories: [],
    options: [{ id: "opt001a", value: "serene", weight: 1, sub_category: null }],
  },
  payload_hash: "h".repeat(64),
  version: 1,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  content_rating: "safe" as const,
} as unknown as ModuleRow;

// The SAME child as stored inside a bundle: WP_Context widget shape --
// name under `meta`, widget-shaped extras, no top-level is_favorite.
const storedWidgetChild: Record<string, unknown> = {
  id: "wc001abc",
  type: "wildcard",
  enabled: true,
  collapsed: false,
  meta: { name: "starter-mood", description: "", category_id: null, tags: [] },
  instance: {},
  payload_hash: "h".repeat(64),
  payload: { stale: "widget shape" },
};

const resolve = (id: string) => (id === liveWildcard.id ? liveWildcard : undefined);

describe("normalizeBundleChild", () => {
  it("resolves a widget-shape child to its live module row shape", () => {
    const out = normalizeBundleChild(storedWidgetChild, resolve);
    // Lifted to top-level + payload taken from the LIVE module (not the
    // stale widget payload).
    expect(out.name).toBe("starter-mood");
    expect(out.is_favorite).toBe(false);
    expect(out).not.toHaveProperty("meta");
    expect(out).not.toHaveProperty("instance");
    expect(out).not.toHaveProperty("enabled");
    expect((out.payload as Record<string, unknown>).options).toBeDefined();
    expect((out.payload as Record<string, unknown>).stale).toBeUndefined();
  });

  it("flattens the snapshot when the source module is absent", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = normalizeBundleChild(storedWidgetChild, () => undefined);
    expect(out.name).toBe("starter-mood"); // lifted from meta
    expect(out.is_favorite).toBe(false);
    expect(out).not.toHaveProperty("meta");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("passes through an already-canonical child", () => {
    const canonical: Record<string, unknown> = {
      id: "fv001abc",
      type: "fixed_values",
      name: "constants",
      description: "",
      category_id: null,
      tags: [],
      is_favorite: false,
      payload: { entries: [{ variable_name: "x", value: "y" }] },
    };
    const out = normalizeBundleChild(canonical, () => undefined);
    expect(out.name).toBe("constants");
    expect(out).not.toHaveProperty("meta");
  });

  it("throws on a nested bundle child", () => {
    expect(() =>
      normalizeBundleChild({ id: "bd1", type: "bundle" }, resolve),
    ).toThrow(/nested bundles/i);
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

  it("produces children that pass strict bundle validation", () => {
    const pub = buildBundlePublishable(bundleRow, resolve);
    // The whole point: the normalized payload survives the same strict
    // validator the publish endpoint runs. Pre-fix, the widget-shape
    // children failed with dozens of name/Unrecognized-key errors.
    expect(() =>
      buildPublishBody({
        payload: pub.payload,
        name: pub.name,
        description: pub.description,
      }),
    ).not.toThrow();
  });
});
