import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetForTests,
  hashes,
  subscribe,
  unsubscribe,
  setLibraryHash,
} from "./drift-store";

beforeEach(() => {
  _resetForTests();
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (typeof url === "string" && url.includes("/wp/api/modules/hashes")) {
        return new Response(JSON.stringify({ hashes: { aaaaaaaa: { type: "wildcard", payload_hash: "h-a" }, bbbbbbbb: { type: "wildcard", payload_hash: "h-b" } } }), { status: 200 });
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
    expect(hashes.value).toEqual({ aaaaaaaa: { type: "wildcard", payload_hash: "h-a" }, bbbbbbbb: { type: "wildcard", payload_hash: "h-b" } });
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
    // forceRefresh fans out to both `/wp/api/modules/hashes` and
    // `/wp/api/bundles/hashes` in parallel, so each invocation
    // produces TWO fetch calls.
    expect(fetchSpy.mock.calls.length).toBe(before + 2);
    unsubscribe();
  });
});

import type { ModuleEntry } from "../../widgets/_shared";
import type { SnapshotEntry } from "./drift-store";
import { refreshMany, mergeRefresh } from "./drift-store";

function mkEntry(over: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "aaaaaaaa",
    type: "wildcard",
    enabled: true,
    meta: { name: "old name", description: "kept", tags: ["t1"] },
    entries: [{ variable_name: "$x", value: "v" }],
    payload: { options: ["old"] },
    payload_hash: "h-old",
    instance: { locked_seed: 42, _ui: { last_locked_seed: 42 } },
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

  it("preserves bundle_origin so refreshing rows inside a bundle doesn't dissolve it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const snapshots: Record<string, SnapshotEntry> = {
          aaaaaaaa: {
            snapshot_version: 1,
            uuid: "aaaaaaaa",
            type: "wildcard",
            name: "fresh",
            payload: { options: ["x"] },
            payload_hash: "h-fresh",
            source: { kind: "user" },
          },
        };
        return new Response(JSON.stringify({ snapshots, pickOrder: ["aaaaaaaa"] }), { status: 200 });
      }),
    );
    const inBundle = mkEntry({ id: "aaaaaaaa" }) as ModuleEntry & { bundle_origin?: string };
    inBundle.bundle_origin = "bundle-uid-XX";
    const result = await refreshMany([inBundle]);
    expect(result.refreshed).toHaveLength(1);
    expect((result.refreshed[0] as ModuleEntry & { bundle_origin?: string }).bundle_origin).toBe("bundle-uid-XX");
  });
});

describe("drift-store: refreshMany partial failure", () => {
  it("flags uuids missing from the response as failed-with-reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (typeof url === "string" && url.endsWith("/embed-bundle")) {
          return new Response(
            JSON.stringify({
              snapshots: {
                aaaaaaaa: {
                  snapshot_version: 1,
                  uuid: "aaaaaaaa",
                  type: "wildcard",
                  name: "ok",
                  payload: {},
                  payload_hash: "h",
                  source: { kind: "user" },
                },
              },
              pickOrder: ["aaaaaaaa", "bbbbbbbb"],
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const a = mkEntry({ id: "aaaaaaaa" });
    const b = mkEntry({ id: "bbbbbbbb" });
    const result = await refreshMany([a, b]);

    expect(result.refreshed.map((r) => r.id)).toEqual(["aaaaaaaa"]);
    expect(result.failed).toEqual([{ id: "bbbbbbbb", reason: "not in library" }]);
  });

  it("returns all failed when the network call itself errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("net down");
      }),
    );
    const a = mkEntry({ id: "aaaaaaaa" });
    const result = await refreshMany([a]);
    expect(result.refreshed).toEqual([]);
    expect(result.failed).toEqual([{ id: "aaaaaaaa", reason: "net down" }]);
  });

  it("returns all failed on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    const a = mkEntry({ id: "aaaaaaaa" });
    const result = await refreshMany([a]);
    expect(result.refreshed).toEqual([]);
    expect(result.failed[0].reason).toContain("500");
  });
});

describe("setLibraryHash — direct hash update without re-fetch", () => {
  beforeEach(() => {
    _resetForTests?.();
    hashes.value = {};
  });

  it("updates the local hash for the given module id", () => {
    setLibraryHash("abc123", "newhash456");
    expect(hashes.value).not.toBeNull();
    if (hashes.value) {
      // Optimistic entry stores { payload_hash } (type filled by next poll).
      expect(hashes.value["abc123"]).toEqual({ payload_hash: "newhash456" });
    }
  });

  it("preserves other module hashes", () => {
    setLibraryHash("a", "ha");
    setLibraryHash("b", "hb");
    setLibraryHash("a", "ha-updated");
    expect(hashes.value).toEqual({
      a: { payload_hash: "ha-updated" },
      b: { payload_hash: "hb" },
    });
  });
});

describe("drift-store: mergeRefresh type-guard", () => {
  it("throws when the live snapshot is a DIFFERENT kind than the embedded row", () => {
    const embedded = mkEntry({ id: "aabbccdd", type: "constraint" });
    const live: SnapshotEntry = {
      snapshot_version: 1,
      uuid: "aabbccdd",
      type: "wildcard",
      name: "w",
      payload: {},
      payload_hash: "h2",
      source: { kind: "user" },
    };
    // A same-id, different-kind library row must never merge over the
    // embedded item — it would silently change the item's kind.
    expect(() => mergeRefresh(embedded, live)).toThrow(/type mismatch/i);
  });

  it("merges normally when the kinds match", () => {
    const embedded = mkEntry({ id: "aabbccdd", type: "wildcard" });
    const live: SnapshotEntry = {
      snapshot_version: 1,
      uuid: "aabbccdd",
      type: "wildcard",
      name: "w2",
      payload: { options: [] },
      payload_hash: "h2",
      source: { kind: "user" },
    };
    const merged = mergeRefresh(embedded, live);
    expect(merged.type).toBe("wildcard");
    expect(merged.payload_hash).toBe("h2");
  });
});
