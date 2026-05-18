import { setActivePinia, createPinia } from "pinia";
import { describe, expect, it, beforeEach } from "vitest";
import { useRecentStore } from "../../stores/recentStore";

describe("useRecentStore", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("starts empty", () => {
    const r = useRecentStore();
    expect(r.items.length).toBe(0);
  });

  it("push adds to front, dedups, caps at 6", () => {
    const r = useRecentStore();
    r.push({ id: "a", kind: "wildcard", name: "A" });
    r.push({ id: "b", kind: "wildcard", name: "B" });
    r.push({ id: "a", kind: "wildcard", name: "A" }); // dedup → moves to front
    expect(r.items.map((i) => i.id)).toEqual(["a", "b"]);

    // Fill past cap
    for (let i = 0; i < 10; i++) r.push({ id: `x${i}`, kind: "wildcard", name: `X${i}` });
    expect(r.items.length).toBe(6);
  });

  it("persists to localStorage", () => {
    const r = useRecentStore();
    r.push({ id: "a", kind: "wildcard", name: "A" });
    const stored = JSON.parse(localStorage.getItem("wp-recent-items") || "[]");
    expect(stored).toEqual([{ id: "a", kind: "wildcard", name: "A" }]);
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
});
