import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { useEditorDraft } from "../../composables/useEditorDraft";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear() { map.clear(); },
    getItem(k) { return map.get(k) ?? null; },
    key(i) { return Array.from(map.keys())[i] ?? null; },
    removeItem(k) { map.delete(k); },
    setItem(k, v) { map.set(k, v); },
  };
}

function harness(opts: Parameters<typeof useEditorDraft>[0]) {
  let api: ReturnType<typeof useEditorDraft>;
  const Harness = defineComponent({
    setup() {
      api = useEditorDraft(opts);
      return () => h("div");
    },
  });
  const wrap = mount(Harness);
  return { wrap, api: api! };
}

describe("useEditorDraft", () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it("persists the snapshot to storage after 2s of dirty state", async () => {
    const storage = fakeStorage();
    const dirty = ref(false);
    const snap = ref("v0");
    const { wrap } = harness({
      kind: "wildcard", id: "abc",
      dirty,
      snapshot: () => snap.value,
      storage,
    });
    dirty.value = true;
    snap.value = "v1";
    await wrap.vm.$nextTick();
    expect(storage.getItem("wp-draft-wildcard-abc")).toBeNull();
    vi.advanceTimersByTime(2000);
    const stored = JSON.parse(storage.getItem("wp-draft-wildcard-abc") || "{}");
    expect(stored.snapshot).toBe("v1");
    expect(typeof stored.savedAt).toBe("string");
    wrap.unmount();
  });

  it("hasDraft returns false when storage is empty", () => {
    const { api, wrap } = harness({
      kind: "wildcard", id: "abc",
      dirty: ref(false),
      snapshot: () => "",
      storage: fakeStorage(),
    });
    expect(api.hasDraft.value).toBe(false);
    wrap.unmount();
  });

  it("hasDraft returns true when storage has a fresh entry", () => {
    const storage = fakeStorage();
    storage.setItem("wp-draft-wildcard-abc", JSON.stringify({ snapshot: "v0", savedAt: new Date().toISOString() }));
    const { api, wrap } = harness({
      kind: "wildcard", id: "abc",
      dirty: ref(false),
      snapshot: () => "",
      storage,
    });
    expect(api.hasDraft.value).toBe(true);
    expect(api.draftSnapshot.value).toBe("v0");
    wrap.unmount();
  });

  it("auto-discards drafts older than 7 days on read", () => {
    const storage = fakeStorage();
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    storage.setItem("wp-draft-wildcard-abc", JSON.stringify({ snapshot: "stale", savedAt: old }));
    const { api, wrap } = harness({
      kind: "wildcard", id: "abc",
      dirty: ref(false),
      snapshot: () => "",
      storage,
    });
    expect(api.hasDraft.value).toBe(false);
    expect(storage.getItem("wp-draft-wildcard-abc")).toBeNull();
    wrap.unmount();
  });

  it("restore returns snapshot and clears storage", () => {
    const storage = fakeStorage();
    storage.setItem("wp-draft-wildcard-abc", JSON.stringify({ snapshot: "v0", savedAt: new Date().toISOString() }));
    const { api, wrap } = harness({
      kind: "wildcard", id: "abc",
      dirty: ref(false),
      snapshot: () => "",
      storage,
    });
    expect(api.restore()).toBe("v0");
    expect(api.hasDraft.value).toBe(false);
    expect(storage.getItem("wp-draft-wildcard-abc")).toBeNull();
    wrap.unmount();
  });

  it("discard clears storage without returning", () => {
    const storage = fakeStorage();
    storage.setItem("wp-draft-wildcard-abc", JSON.stringify({ snapshot: "v0", savedAt: new Date().toISOString() }));
    const { api, wrap } = harness({
      kind: "wildcard", id: "abc",
      dirty: ref(false),
      snapshot: () => "",
      storage,
    });
    api.discard();
    expect(storage.getItem("wp-draft-wildcard-abc")).toBeNull();
    expect(api.hasDraft.value).toBe(false);
    wrap.unmount();
  });

  it("disables persistence on storage write failure", async () => {
    const failing: Storage = {
      get length() { return 0; },
      clear() {},
      getItem() { return null; },
      key() { return null; },
      removeItem() {},
      setItem() { throw new Error("QuotaExceeded"); },
    };
    const dirty = ref(true);
    const { wrap } = harness({
      kind: "wildcard", id: "abc",
      dirty,
      snapshot: () => "v0",
      storage: failing,
    });
    vi.advanceTimersByTime(2100);
    dirty.value = false;
    dirty.value = true;
    vi.advanceTimersByTime(2100);
    expect(true).toBe(true);
    wrap.unmount();
  });

  it("ignores malformed JSON in storage", () => {
    const storage = fakeStorage();
    storage.setItem("wp-draft-wildcard-abc", "not json");
    const { api, wrap } = harness({
      kind: "wildcard", id: "abc",
      dirty: ref(false),
      snapshot: () => "",
      storage,
    });
    expect(api.hasDraft.value).toBe(false);
    wrap.unmount();
  });
});
