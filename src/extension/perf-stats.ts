// Performance overlay singleton — collects frontend-observable metrics so
// the optional HUD (PerfOverlay.vue) can render them live. Other modules
// call the `record*` setters from instrumentation points; the HUD reads
// the reactive `perfStats` object via Vue's dependency tracking.
//
// Metrics live entirely on the frontend — no engine-side telemetry yet
// (would require a WS event from Python). Phase 3d MVP scope:
//   - moduleCount        : total WP modules across all WP_Context nodes
//                          in the graph (refreshed on graph mutation +
//                          periodic poll)
//   - cacheHits/Misses   : preview-resolver lookup outcomes
//   - lastScanMs         : duration of the most recent conflict scan
//   - lastQueueMs        : duration of the most recent queuePrompt call
//
// Counters are cumulative across the session — the HUD shows them with
// a manual "reset" affordance. lastXxxMs metrics overwrite each call.

import { reactive, ref } from "vue";

export interface PerfStats {
  moduleCount: number;
  cacheHits: number;
  cacheMisses: number;
  lastScanMs: number;
  lastQueueMs: number;
}

/** Reactive metric store. Vue dependency tracking handles HUD updates
 *  — no manual notify needed. Each setter mutates a single field so
 *  consumers can react to specific metrics without re-rendering on
 *  every change. */
export const perfStats = reactive<PerfStats>({
  moduleCount: 0,
  cacheHits: 0,
  cacheMisses: 0,
  lastScanMs: 0,
  lastQueueMs: 0,
});

/** HUD visibility — flipped by the `wildcardPipeline.display.perfOverlay`
 *  setting's onChange. Mirror the playground-store pattern (one ref,
 *  one setter) so the consumer (PerfOverlay.vue) can `v-if` on it. */
export const perfOverlayVisible = ref(false);

export function setPerfOverlayVisible(on: boolean): void {
  perfOverlayVisible.value = on;
}

export function setModuleCount(n: number): void {
  perfStats.moduleCount = n;
}

/** Cache recorders defer the mutation via `queueMicrotask` because
 *  the only caller (`preview-resolver.lookup`) is invoked from inside
 *  Vue computeds — synchronously mutating a reactive object that the
 *  caller's effect transitively depends on triggers
 *  "Maximum recursive updates exceeded" because the mutation
 *  re-invalidates the very effect that just ran. Deferring breaks
 *  the loop: by the time the microtask runs, the effect has finished
 *  and the new perfStats value is picked up on the next tick. */
export function recordCacheHit(): void {
  queueMicrotask(() => { perfStats.cacheHits++; });
}

export function recordCacheMiss(): void {
  queueMicrotask(() => { perfStats.cacheMisses++; });
}

export function recordScanDuration(ms: number): void {
  perfStats.lastScanMs = ms;
}

export function recordQueueDuration(ms: number): void {
  perfStats.lastQueueMs = ms;
}

/** Manual reset hook — the HUD's "reset" button calls this. Counters
 *  zero out; lastXxxMs zero out too. moduleCount is left alone because
 *  it's a current-state snapshot, not a counter. */
export function resetPerfStats(): void {
  perfStats.cacheHits = 0;
  perfStats.cacheMisses = 0;
  perfStats.lastScanMs = 0;
  perfStats.lastQueueMs = 0;
}

/** Test-only: reset everything (including moduleCount + visibility) so
 *  each test starts from a clean baseline. */
export function _resetPerfStatsForTesting(): void {
  perfStats.moduleCount = 0;
  perfStats.cacheHits = 0;
  perfStats.cacheMisses = 0;
  perfStats.lastScanMs = 0;
  perfStats.lastQueueMs = 0;
  perfOverlayVisible.value = false;
}
