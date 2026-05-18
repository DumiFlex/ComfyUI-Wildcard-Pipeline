import { describe, expect, it, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import {
  makeModuleStoreAdapter,
  makeMixedKindAdapter,
  makeBundleStoreAdapter,
} from "../../composables/bulkAdapters";
import { useModuleStore } from "../../stores/moduleStore";
import { useBundleStore } from "../../stores/bundleStore";
import type { ModuleRow, BundleRow } from "../../api/types";

function makeModule(over: Partial<ModuleRow> = {}): ModuleRow {
  return {
    id: over.id ?? "m1",
    name: over.name ?? "M",
    description: over.description ?? "",
    type: over.type ?? "wildcard",
    is_favorite: over.is_favorite ?? false,
    tags: over.tags ?? [],
    category_id: over.category_id ?? null,
    payload: over.payload ?? {},
    updated_at: over.updated_at ?? "2026-01-01T00:00:00Z",
    created_at: over.created_at ?? "2026-01-01T00:00:00Z",
  } as ModuleRow;
}

function makeBundle(over: Partial<BundleRow> = {}): BundleRow {
  return {
    id: over.id ?? "b1",
    name: over.name ?? "B",
    description: over.description ?? "",
    color: over.color ?? null,
    category_id: over.category_id ?? null,
    is_favorite: over.is_favorite ?? false,
    tags: over.tags ?? [],
    children: over.children ?? [],
    payload_hash: over.payload_hash ?? "h",
    version: over.version ?? 1,
    updated_at: over.updated_at ?? "2026-01-01T00:00:00Z",
    created_at: over.created_at ?? "2026-01-01T00:00:00Z",
  };
}

describe("makeModuleStoreAdapter", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("setFavorite counts skipped items as ok (idempotent — they're already in target state)", async () => {
    const store = useModuleStore();
    const toggle = vi.spyOn(store, "toggleFavorite").mockResolvedValue(makeModule());
    const adapter = makeModuleStoreAdapter(store);
    const items = [makeModule({ id: "a", is_favorite: true }), makeModule({ id: "b", is_favorite: false })];
    const res = await adapter.setFavorite(items, true);
    expect(res.ok).toBe(2);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledWith("b");
  });

  it("setFavorite reports failed items with reason", async () => {
    const store = useModuleStore();
    vi.spyOn(store, "toggleFavorite").mockRejectedValueOnce(new Error("boom"));
    const adapter = makeModuleStoreAdapter(store);
    const res = await adapter.setFavorite([makeModule({ id: "a" })], true);
    expect(res.ok).toBe(0);
    expect(res.failed).toBe(1);
    expect(res.errors[0]).toEqual({ id: "a", reason: "boom" });
  });

  it("addTag is idempotent — items already carrying the tag count as ok without API call", async () => {
    const store = useModuleStore();
    const update = vi.spyOn(store, "update").mockResolvedValue(makeModule());
    const adapter = makeModuleStoreAdapter(store);
    const items = [makeModule({ id: "a", tags: ["red"] }), makeModule({ id: "b", tags: [] })];
    const res = await adapter.addTag(items, "red");
    expect(res.ok).toBe(2);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("b", { tags: ["red"] });
  });

  it("removeTag is idempotent — items missing the tag count as ok without API call", async () => {
    const store = useModuleStore();
    const update = vi.spyOn(store, "update").mockResolvedValue(makeModule());
    const adapter = makeModuleStoreAdapter(store);
    const items = [makeModule({ id: "a", tags: ["red"] }), makeModule({ id: "b", tags: [] })];
    const res = await adapter.removeTag(items, "red");
    expect(res.ok).toBe(2);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("a", { tags: [] });
  });

  it("setCategory sets all items even when value matches", async () => {
    const store = useModuleStore();
    const update = vi.spyOn(store, "update").mockResolvedValue(makeModule());
    const adapter = makeModuleStoreAdapter(store);
    const items = [makeModule({ id: "a", category_id: "c1" }), makeModule({ id: "b", category_id: null })];
    const res = await adapter.setCategory(items, "c2");
    expect(res.ok).toBe(2);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("setFavorite reads fresh state from store, not stale input refs (defeats undo staleness)", async () => {
    const store = useModuleStore();
    // Store holds the LIVE row showing is_favorite=true (post-original-op state).
    store.items = [makeModule({ id: "a", is_favorite: true })];
    const toggle = vi.spyOn(store, "toggleFavorite").mockResolvedValue(makeModule());
    const adapter = makeModuleStoreAdapter(store);
    // Caller passes the STALE pre-mutation ref where is_favorite=false.
    const stale = [makeModule({ id: "a", is_favorite: false })];
    // Undo wants to set back to false. Without fresh-lookup the adapter would
    // see stale.is_favorite=false, filter target=empty, silently no-op.
    const res = await adapter.setFavorite(stale, false);
    expect(toggle).toHaveBeenCalledWith("a");
    expect(res.ok).toBe(1);
  });

  it("addTag reads fresh tags from store, not stale input refs", async () => {
    const store = useModuleStore();
    // Live state: tag already added by prior op.
    store.items = [makeModule({ id: "a", tags: ["red"] })];
    vi.spyOn(store, "update").mockResolvedValue(makeModule());
    const adapter = makeModuleStoreAdapter(store);
    // Caller's stale ref still says no tags — addTag should skip (live has it).
    const stale = [makeModule({ id: "a", tags: [] })];
    const res = await adapter.addTag(stale, "red");
    expect(store.update).not.toHaveBeenCalled();
    expect(res.ok).toBe(1);
  });

  it("delete calls store.remove for each item", async () => {
    const store = useModuleStore();
    const remove = vi.spyOn(store, "remove").mockResolvedValue(undefined);
    const adapter = makeModuleStoreAdapter(store);
    const res = await adapter.delete([makeModule({ id: "a" }), makeModule({ id: "b" })]);
    expect(res.ok).toBe(2);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("duplicate returns new IDs in input order", async () => {
    const store = useModuleStore();
    const spy = vi.spyOn(store, "duplicate");
    spy.mockResolvedValueOnce(makeModule({ id: "a-copy" }));
    spy.mockResolvedValueOnce(makeModule({ id: "b-copy" }));
    const adapter = makeModuleStoreAdapter(store);
    const res = await adapter.duplicate([makeModule({ id: "a" }), makeModule({ id: "b" })]);
    expect(res.ok).toBe(2);
    expect(res.created).toEqual(["a-copy", "b-copy"]);
  });
});

describe("makeBundleStoreAdapter", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("delete works", async () => {
    const store = useBundleStore();
    const remove = vi.spyOn(store, "remove").mockResolvedValue(undefined);
    const adapter = makeBundleStoreAdapter(store);
    const res = await adapter.delete([makeBundle({ id: "b1" })]);
    expect(res.ok).toBe(1);
    expect(remove).toHaveBeenCalledWith("b1");
  });

  it("setCategory always reports skipped — bundles have no category", async () => {
    const store = useBundleStore();
    const adapter = makeBundleStoreAdapter(store);
    const res = await adapter.setCategory([makeBundle({ id: "b1" })], "c1");
    expect(res.ok).toBe(0);
    expect(res.failed).toBe(1);
    expect(res.errors[0].reason).toBe("bundles have no category");
  });
});

describe("makeMixedKindAdapter", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("routes modules and bundles to their respective stores", async () => {
    const moduleStore = useModuleStore();
    const bundleStore = useBundleStore();
    const moduleRemove = vi.spyOn(moduleStore, "remove").mockResolvedValue(undefined);
    const bundleRemove = vi.spyOn(bundleStore, "remove").mockResolvedValue(undefined);
    const adapter = makeMixedKindAdapter({ moduleStore, bundleStore });
    const res = await adapter.delete([makeModule({ id: "m1" }), makeBundle({ id: "b1" })]);
    expect(res.ok).toBe(2);
    expect(moduleRemove).toHaveBeenCalledWith("m1");
    expect(bundleRemove).toHaveBeenCalledWith("b1");
  });

  it("setCategory skips bundles in mixed batch and reports their count", async () => {
    const moduleStore = useModuleStore();
    const bundleStore = useBundleStore();
    vi.spyOn(moduleStore, "update").mockResolvedValue(makeModule());
    const adapter = makeMixedKindAdapter({ moduleStore, bundleStore });
    const res = await adapter.setCategory(
      [makeModule({ id: "m1" }), makeBundle({ id: "b1" })],
      "c1",
    );
    expect(res.ok).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.errors[0]).toEqual({ id: "b1", reason: "bundles have no category" });
  });
});
