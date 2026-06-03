import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useStaleStore } from "../staleStore";

describe("staleStore", () => {
  beforeEach(() => { setActivePinia(createPinia()); });

  it("starts not stale", () => {
    const store = useStaleStore();
    expect(store.isStale).toBe(false);
  });

  it("markStale flips the flag", () => {
    const store = useStaleStore();
    store.markStale();
    expect(store.isStale).toBe(true);
  });

  it("reload calls window.location.reload", () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: reloadMock },
    });
    const store = useStaleStore();
    store.reload();
    expect(reloadMock).toHaveBeenCalled();
  });
});
