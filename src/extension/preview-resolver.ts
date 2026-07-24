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
  /** Module kind from the library row (`wildcard` / `fixed_values` /
   *  `combine` / `derivation` / `constraint` / `bundle`). Lets non-
   *  wildcard `@{uuid}` refs (e.g. the constraint id embedded in a
   *  `constraint_never_applied` warning) render as a colored chip
   *  matching their kind, instead of falling through as an unresolved
   *  wildcard ref. */
  kind?: string;
  /** First option's value for `wildcard` modules — used to recurse. */
  firstOption?: string;
  /** `payload.var_binding` for `wildcard` modules — the canonical $-var
   *  name. Lets dangling constraint source/target refs render as
   *  `$style` instead of `$ae07018b` even when the referenced wildcard
   *  isn't embedded in the same WP_Context node. */
  varBinding?: string;
  /** Wildcard's declared `sub_categories`. Used by the constraint
   *  modal's matrix axes so a cross-node target wildcard still shows
   *  its current sub-cat list, not a stale union of the saved matrix
   *  keys. Empty / undefined when the lookup isn't a wildcard. */
  subCategories?: string[];
  /** Per-option `value` strings on a wildcard, in declaration order.
   *  Used by the constraint modal's extra-exception autocomplete so
   *  cross-node sources still get the source wildcard's current
   *  option list (renames / additions land without re-saving the
   *  constraint). Empty / undefined when not a wildcard. */
  optionValues?: string[];
  /** `option.id → option.value` for the wildcard — fallback resolver
   *  for legacy library exceptions that stored `source_id` only.
   *  Lets ExceptionsSection render the value chip without an empty
   *  string slot when the wildcard isn't a sibling. */
  optionsById?: ReadonlyMap<string, string>;
  /** True when the wildcard declares an `is_null` option (value === "").
   *  Drives the pi-ban "null" chip on exception rows whose source /
   *  target string is empty. */
  hasNullOption?: boolean;
  /** Per-option `sub_categories` tag sets, one array per option in
   *  declaration order. Feeds the ref-chip hover's "N of M options match"
   *  count — a `@{uuid:expr}` ref's filter is evaluated against each
   *  option's tags, LIVE from the library, so the count reflects options
   *  added/removed after the ref was authored (the propagation signal). */
  optionTagSets?: string[][];
}

const cache = new Map<string, PreviewLookup>();
const inflight = new Set<string>();
/** Failure ledger keyed by uuid. `at` is the wall-clock timestamp the
 *  failure was recorded; `permanent` flags 404 responses (server
 *  confirms the uuid doesn't exist — no retry helps) versus transient
 *  network/parse errors (worth retrying after the TTL).
 *
 *  Pre-fix this was a plain `Set<string>` which made every failure
 *  permanent for the session — a single page-load 5xx flake left a
 *  uuid stuck rendering as `$ae07018b` until full reload. The TTL
 *  recovers from transient failures without hammering the endpoint. */
interface FailureRecord { at: number; permanent: boolean; }
const failed = new Map<string, FailureRecord>();
/** Retry transient failures after this many ms. 30s is short enough
 *  that a user noticing a missing label can edit-something / wait /
 *  see it resolve, but long enough that a flapping endpoint doesn't
 *  generate one fetch per 400ms reactive tick. */
const RETRY_TTL_MS = 30_000;

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
  const now = Date.now();
  const missing: string[] = [];
  for (const u of uuids) {
    if (cache.has(u) || inflight.has(u)) continue;
    const fail = failed.get(u);
    if (fail) {
      // 404 stays permanent — server confirmed the uuid doesn't
      // exist, retrying won't help. Transient failures retry once
      // the TTL elapses, recovering from page-load flakes.
      if (fail.permanent) continue;
      if (now - fail.at < RETRY_TTL_MS) continue;
      failed.delete(u);
    }
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
    options?: Array<{ id?: string; value?: string; is_null?: boolean; sub_categories?: string[] }>;
    var_binding?: string;
    sub_categories?: string[];
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
      // 404 = server confirms the uuid doesn't exist → permanent.
      // Other 5xx/4xx may be transient (rate limit, CORS hiccup,
      // server restart) → retryable after the TTL elapses.
      const permanent = res.status === 404;
      const at = Date.now();
      for (const u of uuids) failed.set(u, { at, permanent });
      return;
    }
    const data = (await res.json()) as {
      snapshots?: Record<string, BundleSnapshot>;
    };
    const got = data.snapshots ?? {};
    const at = Date.now();
    for (const u of uuids) {
      const snap = got[u];
      if (!snap) {
        // Server returned a successful response but didn't include
        // this uuid — module deleted or never existed. Permanent.
        failed.set(u, { at, permanent: true });
        continue;
      }
      const entry: PreviewLookup = { name: snap.name };
      if (typeof snap.type === "string" && snap.type) entry.kind = snap.type;
      if (snap.type === "wildcard") {
        const opts = snap.payload?.options ?? [];
        const v = opts[0]?.value;
        if (typeof v === "string") entry.firstOption = v;
        const vb = snap.payload?.var_binding;
        if (typeof vb === "string" && vb.trim()) entry.varBinding = vb.trim();
        // Constraint modal's matrix axes + extra-exception autocomplete
        // need the live wildcard's sub_categories and option list when
        // the referenced wildcard isn't loaded as a sibling module.
        const subs = snap.payload?.sub_categories;
        if (Array.isArray(subs)) entry.subCategories = subs.filter((s): s is string => typeof s === "string");
        const values: string[] = [];
        const byId = new Map<string, string>();
        const tagSets: string[][] = [];
        let hasNull = false;
        for (const o of opts) {
          if (typeof o?.value === "string") values.push(o.value);
          if (typeof o?.id === "string" && typeof o?.value === "string") byId.set(o.id, o.value);
          if (o?.is_null === true) hasNull = true;
          tagSets.push(
            Array.isArray(o?.sub_categories)
              ? o.sub_categories.filter((s): s is string => typeof s === "string")
              : [],
          );
        }
        if (values.length) entry.optionValues = values;
        if (byId.size) entry.optionsById = byId;
        if (hasNull) entry.hasNullOption = true;
        if (tagSets.length) entry.optionTagSets = tagSets;
      }
      cache.set(u, entry);
    }
  } catch (err) {
    // Network error / JSON parse error — transient by definition. Log
    // once for diagnostics (gated by the same window flag the walker
    // uses) and mark retryable.
    if ((window as unknown as { __wp_walker_log__?: boolean }).__wp_walker_log__) {
      // eslint-disable-next-line no-console
      console.warn("[wp-preview-resolver] fetch failed", { uuids, err });
    }
    const at = Date.now();
    for (const u of uuids) failed.set(u, { at, permanent: false });
  } finally {
    // Notify Vue subscribers regardless of outcome — even a tombstone
    // change is a state transition consumers may want to render
    // (e.g. drop the loading spinner on a uuid that 404'd).
    cacheVersion.value++;
  }
}
