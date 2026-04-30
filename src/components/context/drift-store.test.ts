import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetForTests,
  hashes,
  subscribe,
  unsubscribe,
} from "./drift-store";

beforeEach(() => {
  _resetForTests();
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (typeof url === "string" && url.includes("/wp/api/modules/hashes")) {
        return new Response(JSON.stringify({ hashes: { aaaaaaaa: "h-a", bbbbbbbb: "h-b" } }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }),
  );
});

afterEach(() => {
  _resetForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("drift-store: subscribe/unsubscribe", () => {
  it("starts the poll on first subscribe and populates hashes", async () => {
    expect(hashes.value).toBeNull();
    subscribe();
    await vi.advanceTimersByTimeAsync(0);
    expect(hashes.value).toEqual({ aaaaaaaa: "h-a", bbbbbbbb: "h-b" });
    unsubscribe();
  });
});

describe("drift-store: refCount lifecycle", () => {
  it("stops polling when the last subscriber unsubs", async () => {
    subscribe();
    await vi.advanceTimersByTimeAsync(0);
    const fetchSpy = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const callsAfterFirst = fetchSpy.mock.calls.length;

    unsubscribe();
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it("keeps polling when only one of two subscribers leaves", async () => {
    subscribe();
    subscribe();
    await vi.advanceTimersByTimeAsync(0);
    const fetchSpy = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const before = fetchSpy.mock.calls.length;

    unsubscribe();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(before);
    unsubscribe();
  });
});

describe("drift-store: forceRefresh", () => {
  it("fires an immediate fetch independent of the 5s tick", async () => {
    subscribe();
    await vi.advanceTimersByTimeAsync(0);
    const fetchSpy = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const before = fetchSpy.mock.calls.length;

    const { forceRefresh } = await import("./drift-store");
    await forceRefresh();
    expect(fetchSpy.mock.calls.length).toBe(before + 1);
    unsubscribe();
  });
});
