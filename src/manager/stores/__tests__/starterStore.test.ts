import { setActivePinia, createPinia } from "pinia";
import { describe, expect, it, beforeEach } from "vitest";
import { useStarterStore } from "../starterStore";

const STORAGE_KEY = "wp-starter-set-v1";

describe("useStarterStore", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("starts empty", () => {
    const s = useStarterStore();
    expect(s.idFor("subject")).toBeUndefined();
    expect(s.has("subject")).toBe(false);
    expect(s.moduleSlotsComplete).toBe(false);
  });

  it("record + idFor + has round-trip", () => {
    const s = useStarterStore();
    s.record("subject", "aaaa1111");
    expect(s.idFor("subject")).toBe("aaaa1111");
    expect(s.has("subject")).toBe(true);
    expect(s.has("mood")).toBe(false);
  });

  it("record overwrites an existing id", () => {
    const s = useStarterStore();
    s.record("subject", "aaaa1111");
    s.record("subject", "bbbb2222");
    expect(s.idFor("subject")).toBe("bbbb2222");
  });

  it("clear(slot) forgets one slot; clear() forgets all", () => {
    const s = useStarterStore();
    s.record("subject", "a");
    s.record("mood", "b");
    s.clear("subject");
    expect(s.has("subject")).toBe(false);
    expect(s.has("mood")).toBe(true);
    s.clear();
    expect(s.has("mood")).toBe(false);
  });

  it("moduleSlotsComplete flips true only when all six module slots are set", () => {
    const s = useStarterStore();
    const slots = ["subject", "mood", "style", "scene", "accent", "pairing"] as const;
    slots.forEach((slot, i) => {
      s.record(slot, `id${i}`);
      const expected = i === slots.length - 1;
      expect(s.moduleSlotsComplete).toBe(expected);
    });
    // template / bundle are NOT prerequisites — recording them doesn't change it.
    s.clear("subject");
    expect(s.moduleSlotsComplete).toBe(false);
    s.record("template", "t1");
    s.record("bundle", "x1");
    expect(s.moduleSlotsComplete).toBe(false);
  });

  it("persists to localStorage on write", () => {
    const s = useStarterStore();
    s.record("subject", "aaaa1111");
    s.record("bundle", "bbbb2222");
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    expect(stored).toMatchObject({ subject: "aaaa1111", bundle: "bbbb2222" });
  });

  it("reads localStorage on init", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ subject: "a", mood: "b" }));
    setActivePinia(createPinia());
    const s = useStarterStore();
    expect(s.idFor("subject")).toBe("a");
    expect(s.idFor("mood")).toBe("b");
  });

  it("ignores a non-object localStorage blob", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify("not an object"));
    setActivePinia(createPinia());
    const s = useStarterStore();
    expect(s.idFor("subject")).toBeUndefined();
  });

  it("ignores an array localStorage blob", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["a", "b"]));
    setActivePinia(createPinia());
    const s = useStarterStore();
    expect(s.idFor("subject")).toBeUndefined();
  });

  it("rejects the whole blob when a known key carries a non-string value", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ subject: "ok", mood: 42 }),
    );
    setActivePinia(createPinia());
    const s = useStarterStore();
    // The guard fails on `mood: 42` (a known key with a non-string value),
    // so the entire blob degrades to empty rather than partially loading.
    expect(s.idFor("subject")).toBeUndefined();
    expect(s.idFor("mood")).toBeUndefined();
  });

  it("keeps valid ids while ignoring unknown keys", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ subject: "ok", bogus: "x" }),
    );
    setActivePinia(createPinia());
    const s = useStarterStore();
    expect(s.idFor("subject")).toBe("ok");
  });

  it("survives a corrupt (unparseable) localStorage value", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    setActivePinia(createPinia());
    const s = useStarterStore();
    expect(s.idFor("subject")).toBeUndefined();
  });
});
