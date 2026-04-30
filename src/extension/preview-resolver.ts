/**
 * Lazy preview-time resolver for `@{uuid}` refs that aren't in any chain
 * `WP_Context.modules`. Backend's `embed-bundle` deliberately stops at the
 * picked module — nested refs resolve at runtime against the live DB.
 * The frontend preview has no run-time DB access, so we lazily fetch
 * referenced modules through `embed-bundle` and cache them globally.
 *
 * Read API (`lookup`) is sync — callers (graph.ts `expandValue`) read
 * whatever is already cached, no awaits in the hot resolution path.
 * Write side (`ensure`) fires-and-forgets a single batched fetch per
 * unseen uuid set; the assembler's reactive polling (every 400ms) picks
 * up the new entries on the next snapshot compute.
 *
 * Reactive subscribers (e.g. ModuleEditModal's "@name" rendering) can
 * track {@link cacheVersion} — it bumps after every cache write so any
 * Vue computed/effect that reads it re-evaluates without polling.
 *
 * Failure handling: a uuid that 404s gets memoised as a tombstone so we
 * stop hammering the endpoint. There's no retry — the user can edit the
 * graph or reload to clear state.
 */
import { ref } from "vue";

export interface PreviewLookup {
  /** Display name from the library row. */
  name?: string;
  /** First option's value for `wildcard` modules — used to recurse. */
  firstOption?: string;
  /** `payload.var_binding` for `wildcard` modules — the canonical $-var
   *  name. Lets dangling constraint source/target refs render as
   *  `$style` instead of `$ae07018b` even when the referenced wildcard
   *  isn't embedded in the same WP_Context node. */
  varBinding?: string;
}

const cache = new Map<string, PreviewLookup>();
const inflight = new Set<string>();
const failed = new Set<string>();

/**
 * Bumped whenever a fetch settles (success or failure). Vue computeds
 * that depend on `lookup()` results should read this value once to opt
 * into reactivity — without it, the cache is a plain Map and reads
 * don't trigger re-renders when the async fetch lands.
 */
export const cacheVersion = ref(0);

/** Sync read — returns undefined if not yet fetched (or fetch failed). */
export function lookup(uuid: string): PreviewLookup | undefined {
  return cache.get(uuid);
}

/**
 * Schedule a background fetch for any uuid that's not already cached,
 * in-flight, or known-failed. Idempotent — safe to call every reactive
 * tick. Resolves silently; consumers re-read via `lookup` on the next
 * compute.
 */
export function ensure(uuids: Iterable<string>): void {
  const missing: string[] = [];
  for (const u of uuids) {
    if (cache.has(u) || inflight.has(u) || failed.has(u)) continue;
    missing.push(u);
  }
  if (!missing.length) return;
  for (const u of missing) inflight.add(u);
  fetchBundle(missing).finally(() => {
    for (const u of missing) inflight.delete(u);
  });
}

/** Test seam — clear all caches. Not exported in production paths. */
export function _resetForTests(): void {
  cache.clear();
  inflight.clear();
  failed.clear();
}

/** Test seam — directly seed the cache without going through fetch. */
export function _setForTests(uuid: string, entry: PreviewLookup): void {
  cache.set(uuid, entry);
}

interface BundleSnapshot {
  name?: string;
  type?: string;
  payload?: {
    options?: Array<{ value?: string }>;
    var_binding?: string;
  };
}

async function fetchBundle(uuids: string[]): Promise<void> {
  try {
    const res = await fetch("/wp/api/modules/embed-bundle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uuids }),
    });
    if (!res.ok) {
      // Server-side failure (404, 500, …) — memoise so we don't retry on
      // every 400ms poll. The cost is the user has to reload to recover
      // if the lookup was a flake; that's an acceptable trade for not
      // hammering the endpoint.
      for (const u of uuids) failed.add(u);
      return;
    }
    const data = (await res.json()) as {
      snapshots?: Record<string, BundleSnapshot>;
    };
    const got = data.snapshots ?? {};
    for (const u of uuids) {
      const snap = got[u];
      if (!snap) {
        // Server didn't return this uuid — module deleted or never existed.
        failed.add(u);
        continue;
      }
      const entry: PreviewLookup = { name: snap.name };
      if (snap.type === "wildcard") {
        const v = snap.payload?.options?.[0]?.value;
        if (typeof v === "string") entry.firstOption = v;
        const vb = snap.payload?.var_binding;
        if (typeof vb === "string" && vb.trim()) entry.varBinding = vb.trim();
      }
      cache.set(u, entry);
    }
  } catch {
    // Network error / JSON parse error — fail open on retries to avoid
    // hammering, but don't crash the preview.
    for (const u of uuids) failed.add(u);
  } finally {
    // Notify Vue subscribers regardless of outcome — even a tombstone
    // change is a state transition consumers may want to render
    // (e.g. drop the loading spinner on a uuid that 404'd).
    cacheVersion.value++;
  }
}
