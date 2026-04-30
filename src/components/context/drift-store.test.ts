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
