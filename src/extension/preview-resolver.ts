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

/** Wall-clock stamp for each SUCCESSFUL cache entry, so a snapshot can go
 *  stale. Kept in a sibling map rather than on `PreviewLookup` so the public
 *  shape consumers read stays free of bookkeeping fields. */
const cachedAt = new Map<string, number>();

/** Backstop freshness window.
 *
 *  Successful entries used to live for the lifetime of the page: `ensure()`
 *  short-circuits on `cache.has(u)` and nothing but `_resetForTests` ever
 *  cleared the map. So the canvas kept whatever a wildcard looked like the
 *  first time it was referenced — add an 11th option in the SPA and the canvas
 *  went on reporting 10, while the SPA (which reads the live catalog) reported
 *  11.
 *
 *  The PRIMARY invalidation is `markAllStale` on window focus / tab
 *  visibility (see below): editing in the SPA and switching back to the canvas
 *  refreshes immediately, which is the actual workflow. This timer only covers
 *  the case where focus never changes — two visible windows on one desktop,
 *  say — so it can be generous without anyone waiting on it.
 *
 *  The stale entry is deliberately KEPT while the refresh is in flight — and
 *  kept even if the refresh fails — so a label never flickers back to a raw
 *  uuid. */
const FRESH_TTL_MS = 60_000;

/**
 * Bumped whenever a fetch settles (success or failure). Vue computeds
 * that depend on `lookup()` results should read this value once to opt
 * into reactivity — without it, the cache is a plain Map and reads
 * don't trigger re-renders when the async fetch lands.
 */
export const cacheVersion = ref(0);

/**
 * Record a failure the server has CONFIRMED — the uuid does not exist.
 *
 * Evicts the snapshot as well as stamping the tombstone. Keeping it is what
 * let a module deleted from the library go on rendering as a perfectly valid
 * chip, complete with the option count it had before it was deleted: the
 * tombstone was set, but `lookup()` still answered from `cache`, so no
 * consumer ever learned the ref had broken.
 *
 * The "keep the stale value so nothing flickers back to a raw uuid" rule this
 * departs from is right for TRANSIENT failures, where the old value is our
 * best guess at the current one. Once the server says the module is gone, the
 * old value is not a guess — it is a false statement.
 */
function tombstonePermanent(uuid: string, at: number): void {
  failed.set(uuid, { at, permanent: true });
  cache.delete(uuid);
  cachedAt.delete(uuid);
}

/**
 * Sync read — undefined if not yet fetched, or if the fetch failed.
 *
 * A confirmed-missing uuid resolves to undefined even if something else
 * repopulated the cache. `tombstonePermanent` already evicts, so this is the
 * belt to that braces: "the server says it does not exist" has to beat any
 * cached snapshot, whatever wrote it, or a broken ref renders as a live one.
 */
export function lookup(uuid: string): PreviewLookup | undefined {
  if (failed.get(uuid)?.permanent) return undefined;
  return cache.get(uuid);
}

/**
 * Mark every cached snapshot stale so the next `ensure()` refetches it.
 *
 * Drops only the freshness stamps, never `cache` itself: consumers keep
 * rendering the last known values until the refresh lands, so nothing
 * flickers back to a raw uuid. Transient failure tombstones are cleared too —
 * a deliberate "check again now" should retry them rather than wait out
 * `RETRY_TTL_MS`. Permanent (404) tombstones stay, since the server already
 * confirmed those uuids don't exist.
 */
export function markAllStale(): void {
  cachedAt.clear();
  for (const [u, f] of failed) {
    if (!f.permanent) failed.delete(u);
  }
}

/**
 * The canvas and the SPA are separate pages, so a library edit in one is
 * invisible to the other — there is no shared invalidation event to subscribe
 * to. What IS observable is the user coming back: they edit a wildcard in the
 * SPA tab, switch to the ComfyUI tab, and expect the canvas to agree.
 *
 * `visibilitychange` covers the tab switch, `focus` covers clicking between
 * two windows. Both just mark stale — the refetch itself is lazy, driven by
 * whatever `ensure()` call the next reactive tick makes, so a focus event on a
 * graph with no `@{}` refs costs nothing.
 */
if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.addEventListener("focus", markAllStale);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) markAllStale();
  });
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
    if (inflight.has(u)) continue;
    const fail = failed.get(u);
    if (fail) {
      // 404 stays permanent — server confirmed the uuid doesn't
      // exist, retrying won't help. Transient failures retry once
      // the TTL elapses, recovering from page-load flakes.
      // Checked BEFORE the cache so a stale entry whose refresh 404'd
      // can't re-enter the fetch queue on every reactive tick.
      if (fail.permanent) continue;
      if (now - fail.at < RETRY_TTL_MS) continue;
      failed.delete(u);
    }
    // Cached AND still fresh → nothing to do. A STALE entry falls through to
    // a refresh; `lookup` keeps serving the old value until the new one lands.
    const at = cachedAt.get(u);
    if (cache.has(u) && at !== undefined && now - at < FRESH_TTL_MS) continue;
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
  cachedAt.clear();
  inflight.clear();
  failed.clear();
}

/** Test seam — directly seed the cache without going through fetch. Stamps
 *  `cachedAt` too, otherwise the seeded entry reads as stale and the very
 *  next `ensure()` would fire a real fetch. */
export function _setForTests(uuid: string, entry: PreviewLookup): void {
  cache.set(uuid, entry);
  cachedAt.set(uuid, Date.now());
}

/** Test seam — record the server having confirmed a uuid is gone, without
 *  standing up a fetch mock. Deliberately does NOT clear the cache first, so
 *  a suite can assert the guard in `lookup` holds even against a populated
 *  entry — the exact shape of the deleted-module bug. */
export function _tombstoneForTests(uuid: string): void {
  failed.set(uuid, { at: Date.now(), permanent: true });
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
      for (const u of uuids) {
        // A 404 is the server confirming these are gone, so their snapshots
        // must go with them. Anything else keeps its last known value.
        if (permanent) tombstonePermanent(u, at);
        else failed.set(u, { at, permanent });
      }
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
        // Server returned a successful response but didn't include this
        // uuid — module deleted or never existed. Just as confirmed as a
        // 404, so the snapshot goes too.
        tombstonePermanent(u, at);
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
      cachedAt.set(u, at);
      // A successful refresh clears any earlier failure so the entry is not
      // held back by a stale tombstone on the next staleness check.
      failed.delete(u);
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
