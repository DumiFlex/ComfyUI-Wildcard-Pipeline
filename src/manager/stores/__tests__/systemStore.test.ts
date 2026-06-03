import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSystemStore } from "../systemStore";

describe("systemStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts with canRestart = null", () => {
    const store = useSystemStore();
    expect(store.canRestart).toBeNull();
    expect(store.restarting).toBe(false);
  });

  it("detectRestartCapability sets canRestart=true on 2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const store = useSystemStore();
    await store.detectRestartCapability();
    expect(fetchMock).toHaveBeenCalledWith("/manager/reboot", { method: "HEAD" });
    expect(store.canRestart).toBe(true);
  });

  it("detectRestartCapability treats 405 as Manager present", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("", { status: 405 })));
    const store = useSystemStore();
    await store.detectRestartCapability();
    expect(store.canRestart).toBe(true);
  });

  it("detectRestartCapability sets canRestart=false on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("", { status: 404 })));
    const store = useSystemStore();
    await store.detectRestartCapability();
    expect(store.canRestart).toBe(false);
  });

  it("detectRestartCapability sets canRestart=false on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("net")));
    const store = useSystemStore();
    await store.detectRestartCapability();
    expect(store.canRestart).toBe(false);
  });

  it("detectRestartCapability probes only once per session", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const store = useSystemStore();
    await store.detectRestartCapability();
    await store.detectRestartCapability();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("restart fires POST then reloads after server comes back", async () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: reloadMock },
    });
    let postCalled = false;
    let configCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/manager/reboot" && init?.method === "POST") {
        postCalled = true;
        return Promise.reject(new Error("connection dropped"));  // realistic
      }
      if (url === "/wp/api/database/config") {
        configCalls += 1;
        // First poll fails (server still booting), second succeeds.
        if (configCalls === 1) return Promise.reject(new Error("ECONNREFUSED"));
        return Promise.resolve(new Response("{}", { status: 200 }));
      }
      return Promise.reject(new Error("unexpected url " + url));
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = useSystemStore();
    const p = store.restart();
    // Skip the 2s head start.
    await vi.advanceTimersByTimeAsync(2000);
    // Drive both poll iterations.
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await p;

    expect(postCalled).toBe(true);
    expect(reloadMock).toHaveBeenCalled();
    expect(store.restartError).toBeNull();
  });

  it("restart records error if server doesn't come back in time", async () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: reloadMock },
    });
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.reject(new Error("ECONNREFUSED")),
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = useSystemStore();
    const p = store.restart();
    // Advance past the entire 60s timeout window (head start + polling).
    await vi.advanceTimersByTimeAsync(65_000);
    await p;

    expect(reloadMock).not.toHaveBeenCalled();
    expect(store.restartError).toContain("60s");
    expect(store.restarting).toBe(false);
  });
});
