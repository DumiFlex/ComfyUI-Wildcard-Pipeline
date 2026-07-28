import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetForTests, ensure, lookup, markAllStale } from "./preview-resolver";

/**
 * Snapshot freshness.
 *
 * Successful cache entries used to live for the lifetime of the page —
 * `ensure()` short-circuited on `cache.has(u)` and nothing but the test seam
 * ever cleared the map. So the canvas kept whatever a wildcard looked like the
 * first time it was referenced: add an 11th option in the SPA and the canvas
 * went on reporting 10 while the SPA reported 11. The two surfaces are
 * separate pages with no shared invalidation event, so freshness is
 * time-based.
 */

function snapshotResponse(options: { id: string; value: string }[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      snapshots: {
        aabbccdd: {
          name: "pose",
          type: "wildcard",
          payload: { options, var_binding: "pose" },
        },
      },
    }),
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  _resetForTests();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Let the in-flight fetch promise settle under fake timers. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("preview-resolver freshness", () => {
  it("fetches once and serves from cache while fresh", async () => {
    fetchMock.mockResolvedValue(snapshotResponse([{ id: "o1", value: "a" }]));
    ensure(["aabbccdd"]);
    await settle();
    expect(lookup("aabbccdd")?.optionValues).toEqual(["a"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Repeated ticks inside the freshness window must not refetch — `ensure`
    // runs on every 400ms reactive tick.
    ensure(["aabbccdd"]);
    ensure(["aabbccdd"]);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches once the entry goes stale, picking up an edit made in the SPA", async () => {
    fetchMock.mockResolvedValue(snapshotResponse([{ id: "o1", value: "a" }]));
    ensure(["aabbccdd"]);
    await settle();
    expect(lookup("aabbccdd")?.optionValues).toHaveLength(1);

    // The wildcard gains an option in the SPA.
    fetchMock.mockResolvedValue(
      snapshotResponse([{ id: "o1", value: "a" }, { id: "o2", value: "b" }]),
    );

    // Still fresh → no refetch, still the old count.
    await vi.advanceTimersByTimeAsync(30_000);
    ensure(["aabbccdd"]);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lookup("aabbccdd")?.optionValues).toHaveLength(1);

    // Past the freshness window → refetch, and the canvas agrees with the SPA.
    await vi.advanceTimersByTimeAsync(31_000);
    ensure(["aabbccdd"]);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lookup("aabbccdd")?.optionValues).toEqual(["a", "b"]);
  });

  it("refreshes immediately on markAllStale — no waiting out the timer", async () => {
    // The real workflow: edit the wildcard in the SPA tab, switch back to the
    // ComfyUI tab. Focus / visibilitychange call markAllStale, so the canvas
    // agrees at once instead of after the backstop window.
    fetchMock.mockResolvedValue(snapshotResponse([{ id: "o1", value: "a" }]));
    ensure(["aabbccdd"]);
    await settle();
    expect(lookup("aabbccdd")?.optionValues).toHaveLength(1);

    fetchMock.mockResolvedValue(
      snapshotResponse([{ id: "o1", value: "a" }, { id: "o2", value: "b" }]),
    );
    markAllStale();
    ensure(["aabbccdd"]);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lookup("aabbccdd")?.optionValues).toEqual(["a", "b"]);
  });

  it("markAllStale keeps serving the old value until the refresh lands", async () => {
    fetchMock.mockResolvedValue(snapshotResponse([{ id: "o1", value: "a" }]));
    ensure(["aabbccdd"]);
    await settle();

    markAllStale();
    // Marked stale but nothing fetched yet — the label must not go blank.
    expect(lookup("aabbccdd")?.name).toBe("pose");
    expect(lookup("aabbccdd")?.optionValues).toEqual(["a"]);
  });

  it("keeps serving the stale value when the refresh fails", async () => {
    // A label must never flicker back to a raw uuid because a refresh flaked.
    fetchMock.mockResolvedValue(snapshotResponse([{ id: "o1", value: "a" }]));
    ensure(["aabbccdd"]);
    await settle();

    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await vi.advanceTimersByTimeAsync(61_000);
    ensure(["aabbccdd"]);
    await settle();

    expect(lookup("aabbccdd")?.name).toBe("pose");
    expect(lookup("aabbccdd")?.optionValues).toEqual(["a"]);
  });

  it("does not re-queue a uuid whose refresh 404'd on every tick", async () => {
    // A permanent failure is checked BEFORE staleness, so a stale entry whose
    // refresh 404'd can't hammer the endpoint once per reactive tick.
    fetchMock.mockResolvedValue(snapshotResponse([{ id: "o1", value: "a" }]));
    ensure(["aabbccdd"]);
    await settle();

    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    await vi.advanceTimersByTimeAsync(61_000);
    ensure(["aabbccdd"]);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    for (let i = 0; i < 5; i++) {
      ensure(["aabbccdd"]);
      await settle();
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
