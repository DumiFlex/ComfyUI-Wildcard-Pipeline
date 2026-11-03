import { describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import {
  MAX_RELOADS,
  RELOAD_KEY,
  RELOAD_WINDOW_MS,
  clearReloads,
  installChunkRecovery,
  isChunkLoadError,
  takeReloadSlot,
} from "../chunk-reload";

function memoryStore(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  };
}

describe("isChunkLoadError", () => {
  it("knows the Chrome, Firefox and Safari messages", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: http://x/wp/assets/a.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module: http://x/wp/assets/a.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Unable to preload CSS for /wp/assets/a.css"))).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isChunkLoadError(new Error("boom"))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe("takeReloadSlot", () => {
  it("allows a few reloads per window, then stops", () => {
    const store = memoryStore();
    for (let i = 0; i < MAX_RELOADS; i++) expect(takeReloadSlot(store, 1000)).toBe(true);
    expect(takeReloadSlot(store, 1000)).toBe(false);
    expect(takeReloadSlot(store, 1000 + RELOAD_WINDOW_MS)).toBe(true);
  });

  it("starts fresh after clearReloads and survives junk", () => {
    const store = memoryStore();
    store.setItem(RELOAD_KEY, "not json");
    expect(takeReloadSlot(store, 0)).toBe(false);
    clearReloads(store);
    expect(takeReloadSlot(store, 0)).toBe(true);
    expect(takeReloadSlot(undefined)).toBe(false);
  });
});

describe("installChunkRecovery", () => {
  it("reloads to the asked-for route when its chunk is gone", async () => {
    sessionStorage.clear();
    const router = createRouter({
      history: createMemoryHistory("/wp/"),
      routes: [
        { path: "/", component: { render: () => null } },
        {
          path: "/settings/:section?",
          component: () => Promise.reject(new TypeError("error loading dynamically imported module: /wp/assets/Settings-old.js")),
        },
      ],
    });
    const go = vi.fn();
    installChunkRecovery(router, go);
    await router.push("/");
    await router.push("/settings/library").catch(() => undefined);
    expect(go).toHaveBeenCalledTimes(1);
    expect(go.mock.calls[0]?.[0]).toBe("/wp/settings/library");
  });

  it("leaves other navigation errors alone", async () => {
    sessionStorage.clear();
    const router = createRouter({
      history: createMemoryHistory("/wp/"),
      routes: [
        { path: "/", component: { render: () => null } },
        { path: "/bad", component: () => Promise.reject(new Error("boom")) },
      ],
    });
    const go = vi.fn();
    installChunkRecovery(router, go);
    await router.push("/");
    await router.push("/bad").catch(() => undefined);
    expect(go).not.toHaveBeenCalled();
  });
});
