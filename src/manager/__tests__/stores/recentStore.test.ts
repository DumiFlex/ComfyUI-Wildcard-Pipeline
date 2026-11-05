import { setActivePinia, createPinia } from "pinia";
import { describe, expect, it, beforeEach } from "vitest";
import { nextTick } from "vue";
import { useRecentStore } from "../../stores/recentStore";
import { markDeleted } from "../../composables/useLibraryChanged";

describe("useRecentStore", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("starts empty", () => {
    const r = useRecentStore();
    expect(r.items.length).toBe(0);
  });

  it("push adds to front, dedups, caps at 10", () => {
    const r = useRecentStore();
    r.push({ id: "a", kind: "wildcard", name: "A" });
    r.push({ id: "b", kind: "wildcard", name: "B" });
    r.push({ id: "a", kind: "wildcard", name: "A" }); // dedup → moves to front
    expect(r.items.map((i) => i.id)).toEqual(["a", "b"]);

    // Fill past cap
    for (let i = 0; i < 15; i++) r.push({ id: `x${i}`, kind: "wildcard", name: `X${i}` });
    expect(r.items.length).toBe(10);
  });

  it("persists to localStorage with openedAt stamp", () => {
    const r = useRecentStore();
    r.push({ id: "a", kind: "wildcard", name: "A" });
    const stored = JSON.parse(localStorage.getItem("wp-recent-items") || "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: "a", kind: "wildcard", name: "A" });
    expect(typeof stored[0].openedAt).toBe("string");
    expect(Number.isFinite(Date.parse(stored[0].openedAt))).toBe(true);
  });

  it("reads localStorage on init", () => {
    localStorage.setItem("wp-recent-items", JSON.stringify([
      { id: "a", kind: "wildcard", name: "A" },
    ]));
    setActivePinia(createPinia());
    const r = useRecentStore();
    expect(r.items.length).toBe(1);
    expect(r.items[0].id).toBe("a");
  });

  it("recentIds returns module:/bundle: prefixed ids in order", () => {
    const r = useRecentStore();
    r.push({ id: "a", kind: "wildcard", name: "A" });
    r.push({ id: "b", kind: "bundle", name: "B" });
    expect(r.recentIds).toEqual([`bundle:b`, `module:a`]);
  });

  it("ignores malformed localStorage entries", () => {
    localStorage.setItem("wp-recent-items", JSON.stringify("not an array"));
    setActivePinia(createPinia());
    const r = useRecentStore();
    expect(r.items).toEqual([]);
  });

  it("drops an entry when its row is deleted", async () => {
    const r = useRecentStore();
    r.push({ id: "gone0001", kind: "wildcard", name: "A" });
    r.push({ id: "kept0001", kind: "bundle", name: "B" });
    markDeleted(["gone0001"]);
    await nextTick();
    expect(r.items.map((i) => i.id)).toEqual(["kept0001"]);
    expect(JSON.parse(localStorage.getItem("wp-recent-items") ?? "[]")).toHaveLength(1);
  });

  it("prune keeps only entries still in the library", () => {
    const r = useRecentStore();
    r.push({ id: "a", kind: "wildcard", name: "A" });
    r.push({ id: "b", kind: "bundle", name: "B" });
    r.prune(new Set(["b"]));
    expect(r.items.map((i) => i.id)).toEqual(["b"]);
  });
});
