// Tests for perf-stats — verifies recorder mutations + reset semantics +
// visibility ref. Counter mutations are simple but the reactive store
// is the primary contract HUD code depends on.

import { describe, it, expect, beforeEach } from "vitest";
import {
  perfStats,
  perfOverlayVisible,
  setPerfOverlayVisible,
  setModuleCount,
  recordCacheHit,
  recordCacheMiss,
  recordScanDuration,
  recordQueueDuration,
  resetPerfStats,
  _resetPerfStatsForTesting,
} from "./perf-stats";

describe("perf-stats", () => {
  beforeEach(() => {
    _resetPerfStatsForTesting();
  });

  describe("visibility ref", () => {
    it("starts hidden", () => {
      expect(perfOverlayVisible.value).toBe(false);
    });

    it("setPerfOverlayVisible flips the ref", () => {
      setPerfOverlayVisible(true);
      expect(perfOverlayVisible.value).toBe(true);
      setPerfOverlayVisible(false);
      expect(perfOverlayVisible.value).toBe(false);
    });
  });

  describe("module count", () => {
    it("setModuleCount overwrites (it's a snapshot, not a counter)", () => {
      setModuleCount(7);
      expect(perfStats.moduleCount).toBe(7);
      setModuleCount(3);
      expect(perfStats.moduleCount).toBe(3);
    });

    it("starts at zero", () => {
      expect(perfStats.moduleCount).toBe(0);
    });
  });

  describe("cache counters", () => {
    /** Cache recorders defer mutation via queueMicrotask to avoid
     *  reactive-loop crashes when called from inside Vue computeds.
     *  Tests need to wait one microtask tick for the increment to land. */
    const flush = () => new Promise<void>((r) => queueMicrotask(r));

    it("recordCacheHit increments hits", async () => {
      recordCacheHit();
      recordCacheHit();
      recordCacheHit();
      await flush();
      expect(perfStats.cacheHits).toBe(3);
      expect(perfStats.cacheMisses).toBe(0);
    });

    it("recordCacheMiss increments misses", async () => {
      recordCacheMiss();
      recordCacheMiss();
      await flush();
      expect(perfStats.cacheMisses).toBe(2);
      expect(perfStats.cacheHits).toBe(0);
    });

    it("hits and misses tracked independently", async () => {
      recordCacheHit();
      recordCacheMiss();
      recordCacheHit();
      recordCacheMiss();
      recordCacheHit();
      await flush();
      expect(perfStats.cacheHits).toBe(3);
      expect(perfStats.cacheMisses).toBe(2);
    });
  });

  describe("duration metrics", () => {
    it("recordScanDuration overwrites the last value", () => {
      recordScanDuration(12.5);
      expect(perfStats.lastScanMs).toBe(12.5);
      recordScanDuration(3.1);
      expect(perfStats.lastScanMs).toBe(3.1);
    });

    it("recordQueueDuration overwrites the last value", () => {
      recordQueueDuration(150.7);
      expect(perfStats.lastQueueMs).toBe(150.7);
      recordQueueDuration(42);
      expect(perfStats.lastQueueMs).toBe(42);
    });

    it("scan and queue tracked independently", () => {
      recordScanDuration(8);
      recordQueueDuration(100);
      expect(perfStats.lastScanMs).toBe(8);
      expect(perfStats.lastQueueMs).toBe(100);
    });
  });

  describe("resetPerfStats", () => {
    it("zeroes counters but keeps moduleCount snapshot", async () => {
      setModuleCount(12);
      recordCacheHit();
      recordCacheMiss();
      recordScanDuration(5);
      recordQueueDuration(50);
      // Flush deferred cache writes so reset operates on the actual
      // post-increment state.
      await new Promise<void>((r) => queueMicrotask(r));

      resetPerfStats();

      expect(perfStats.cacheHits).toBe(0);
      expect(perfStats.cacheMisses).toBe(0);
      expect(perfStats.lastScanMs).toBe(0);
      expect(perfStats.lastQueueMs).toBe(0);
      // Module count is a current-state snapshot, not a counter — preserved
      expect(perfStats.moduleCount).toBe(12);
    });
  });
});
