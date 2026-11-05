import { afterEach, describe, expect, it } from "vitest";
import {
  dropSavedExampleFlags,
  isExampleBundleNotInLibrary,
  isExampleNotInLibrary,
} from "./library-status";
import { bundleHashes, hashes } from "./drift-store";
import type { BundleInstance, ContextWidgetValue, ModuleEntry } from "../../widgets/_shared";

function row(over: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "aaaa0001",
    _uid: "row-1",
    type: "wildcard",
    enabled: true,
    meta: { name: "Hero" },
    entries: [],
    payload_hash: "h1",
    example: true,
    ...over,
  };
}

function bundle(over: Partial<BundleInstance> = {}): BundleInstance {
  return {
    _uid: "bundle-1",
    library_id: "bbbb0001",
    start_idx: 0,
    end_idx: 0,
    enabled: true,
    collapsed: false,
    inserted_at_hash: "",
    name: "Character",
    color: null,
    example: true,
    ...over,
  };
}

afterEach(() => {
  hashes.value = null;
  bundleHashes.value = null;
});

describe("isExampleNotInLibrary", () => {
  it("is false before the first library poll", () => {
    expect(isExampleNotInLibrary(row())).toBe(false);
  });

  it("is true for an example row the library lacks", () => {
    hashes.value = {};
    expect(isExampleNotInLibrary(row())).toBe(true);
  });

  it("is false once the library holds the row", () => {
    hashes.value = { aaaa0001: { type: "wildcard", payload_hash: "h1" } };
    expect(isExampleNotInLibrary(row())).toBe(false);
  });

  it("is false for a missing row without the flag", () => {
    hashes.value = {};
    expect(isExampleNotInLibrary(row({ example: undefined }))).toBe(false);
  });
});

describe("isExampleBundleNotInLibrary", () => {
  it("is false before the first library poll", () => {
    expect(isExampleBundleNotInLibrary(bundle())).toBe(false);
  });

  it("is true for an example bundle the library lacks", () => {
    bundleHashes.value = {};
    expect(isExampleBundleNotInLibrary(bundle())).toBe(true);
  });

  it("is false once the library holds the bundle", () => {
    bundleHashes.value = { bbbb0001: "bh" };
    expect(isExampleBundleNotInLibrary(bundle())).toBe(false);
  });

  it("is false for a missing bundle without the flag", () => {
    bundleHashes.value = {};
    expect(isExampleBundleNotInLibrary(bundle({ example: undefined }))).toBe(false);
  });
});

describe("dropSavedExampleFlags", () => {
  const value = (): ContextWidgetValue => ({
    version: 1,
    modules: [row(), row({ id: "aaaa0002", _uid: "row-2" })],
    bundles: [bundle()],
  });

  it("returns null before either poll lands", () => {
    expect(dropSavedExampleFlags(value())).toBeNull();
    hashes.value = { aaaa0001: { type: "wildcard", payload_hash: "h1" } };
    expect(dropSavedExampleFlags(value())).toBeNull();
  });

  it("returns null when nothing has been saved", () => {
    hashes.value = {};
    bundleHashes.value = {};
    expect(dropSavedExampleFlags(value())).toBeNull();
  });

  it("drops the flag only from saved rows and bundles", () => {
    hashes.value = { aaaa0001: { type: "wildcard", payload_hash: "h1" } };
    bundleHashes.value = { bbbb0001: "bh" };
    const next = dropSavedExampleFlags(value());
    expect(next).not.toBeNull();
    expect(next?.modules[0]).not.toHaveProperty("example");
    expect(next?.modules[1].example).toBe(true);
    expect(next?.bundles?.[0]).not.toHaveProperty("example");
  });

  it("drops the flag from a row the library holds with other content (it reads as drift)", () => {
    hashes.value = { aaaa0001: { type: "wildcard", payload_hash: "other" } };
    bundleHashes.value = {};
    const next = dropSavedExampleFlags(value());
    expect(next?.modules[0]).not.toHaveProperty("example");
  });
});
