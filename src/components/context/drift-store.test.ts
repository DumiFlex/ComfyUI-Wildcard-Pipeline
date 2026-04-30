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

import type { ModuleEntry } from "../../widgets/_shared";
import type { SnapshotEntry } from "./drift-store";
import { refreshMany } from "./drift-store";

function mkEntry(over: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "aaaaaaaa",
    type: "wildcard",
    enabled: true,
    meta: { name: "old name", description: "kept", tags: ["t1"] },
    entries: [{ variable_name: "$x", value: "v" }],
    payload: { options: ["old"] },
    payload_hash: "h-old",
    instance: { locked_seed: 42, last_locked_seed: 42 },
    collapsed: true,
    ...over,
  };
}

describe("drift-store: refreshMany happy path", () => {
  it("calls /embed-bundle once with all uuids and merges library-side fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (typeof url === "string" && url.endsWith("/embed-bundle")) {
          const body = JSON.parse(String(init?.body ?? "{}")) as { uuids: string[] };
          expect(body.uuids).toEqual(["aaaaaaaa", "bbbbbbbb"]);
          const snapshots: Record<string, SnapshotEntry> = {
            aaaaaaaa: {
              snapshot_version: 1,
              uuid: "aaaaaaaa",
              type: "wildcard",
              name: "fresh name",
              payload: { options: ["fresh"] },
              payload_hash: "h-fresh",
              source: { kind: "user" },
            },
            bbbbbbbb: {
              snapshot_version: 1,
              uuid: "bbbbbbbb",
              type: "wildcard",
              name: "fresh-b",
              payload: { options: ["b"] },
              payload_hash: "h-b-fresh",
              source: { kind: "user" },
            },
          };
          return new Response(JSON.stringify({ snapshots, pickOrder: body.uuids }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const a = mkEntry({ id: "aaaaaaaa" });
    const b = mkEntry({ id: "bbbbbbbb", meta: { name: "old-b", description: "kept", tags: ["t1"] } });
    const result = await refreshMany([a, b]);

    expect(result.failed).toEqual([]);
    expect(result.refreshed).toHaveLength(2);

    expect(result.refreshed[0].payload).toEqual({ options: ["fresh"] });
    expect(result.refreshed[0].payload_hash).toBe("h-fresh");
    expect(result.refreshed[0].meta.name).toBe("fresh name");
    expect(result.refreshed[0].meta.description).toBe("kept");
    expect(result.refreshed[0].meta.tags).toEqual(["t1"]);

    expect(result.refreshed[0].id).toBe("aaaaaaaa");
    expect(result.refreshed[0].enabled).toBe(true);
    expect(result.refreshed[0].entries).toEqual([{ variable_name: "$x", value: "v" }]);
    expect(result.refreshed[0].instance?.locked_seed).toBe(42);
    expect(result.refreshed[0].collapsed).toBe(true);
  });
});
