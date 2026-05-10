import { describe, it, expect } from "vitest";
import {
  emptyBundleInstance,
  emptyContextValue,
  emptyInjectorRowsValue,
  parseWidgetJsonWithRecovery,
  type BundleInstance,
  type ContextWidgetValue,
  type InjectorRowsValue,
} from "./_shared";

describe("emptyInjectorRowsValue", () => {
  it("returns version 1 + empty rows array", () => {
    expect(emptyInjectorRowsValue()).toEqual({ version: 1, rows: [] });
  });
});

describe("parseWidgetJsonWithRecovery for InjectorRowsValue", () => {
  it("parses well-formed rows", () => {
    const json = JSON.stringify({
      version: 1,
      rows: [
        { _uid: "abc", slot_name: "input_0", binding: "x", enabled: true, internal: false },
      ],
    });
    const parsed = parseWidgetJsonWithRecovery<InjectorRowsValue>(json, emptyInjectorRowsValue());
    expect(parsed.value.rows).toHaveLength(1);
    expect(parsed.value.rows[0].binding).toBe("x");
  });

  it("recovers to empty on malformed JSON", () => {
    const parsed = parseWidgetJsonWithRecovery<InjectorRowsValue>(
      "{not json",
      emptyInjectorRowsValue(),
    );
    expect(parsed.value).toEqual(emptyInjectorRowsValue());
  });
});

describe("emptyBundleInstance", () => {
  it("returns a BundleInstance with sane defaults", () => {
    const b = emptyBundleInstance("lib-abc");
    expect(b._uid).toMatch(/^[0-9a-f]{12}$/);   // newRowUid pattern
    expect(b.library_id).toBe("lib-abc");
    expect(b.start_idx).toBe(0);
    expect(b.end_idx).toBe(0);
    expect(b.enabled).toBe(true);
    expect(b.collapsed).toBe(false);
    expect(b.inserted_at_hash).toBe("");
  });

  it("generates a fresh _uid each call", () => {
    const a = emptyBundleInstance("lib-1");
    const b = emptyBundleInstance("lib-1");
    expect(a._uid).not.toBe(b._uid);
  });
});

describe("emptyContextValue with bundles", () => {
  it("includes empty bundles array", () => {
    const v = emptyContextValue();
    expect(v.version).toBe(1);
    expect(v.modules).toEqual([]);
    expect(v.bundles).toEqual([]);
  });
});

describe("parseWidgetJsonWithRecovery for ContextWidgetValue.bundles", () => {
  it("defaults bundles to [] when missing from workflow JSON (backward compat)", () => {
    const raw = JSON.stringify({ version: 1, modules: [] });
    const parsed = parseWidgetJsonWithRecovery<ContextWidgetValue>(raw, emptyContextValue());
    expect(parsed.error).toBeNull();
    expect(Array.isArray(parsed.value.bundles)).toBe(true);
    expect(parsed.value.bundles).toHaveLength(0);
  });

  it("preserves bundles[] when present in workflow JSON", () => {
    const bundleEntry: BundleInstance = {
      _uid: "abc123def456",
      library_id: "lib-coral",
      start_idx: 0,
      end_idx: 2,
      enabled: true,
      collapsed: false,
      inserted_at_hash: "hash-1",
    };
    const raw = JSON.stringify({
      version: 1,
      modules: [],
      bundles: [bundleEntry],
    });
    const parsed = parseWidgetJsonWithRecovery<ContextWidgetValue>(raw, emptyContextValue());
    const bundles = parsed.value.bundles ?? [];
    expect(bundles).toHaveLength(1);
    expect(bundles[0]).toEqual(bundleEntry);
  });
});
