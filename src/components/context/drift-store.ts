import { ref, type Ref } from "vue";
import type { ModuleEntry } from "../../widgets/_shared";

/**
 * Shape of the SnapshotEntry returned by `POST /wp/api/modules/embed-bundle`
 * for each picked uuid. Mirrors `wp_api/modules.py:embed_bundle`.
 */
export interface SnapshotEntry {
  snapshot_version: 1;
  uuid: string;
  type: ModuleEntry["type"];
  name: string;
  payload: Record<string, unknown>;
  payload_hash: string;
  source: { kind: "user" } | { kind: "dep"; parent_uuids: string[] };
}

export interface RefreshResult {
  refreshed: ModuleEntry[];
  failed: { id: string; reason: string }[];
}

/** Live-library hashes keyed by uuid. `null` while the first fetch is in
 *  flight — predicates downstream use this to avoid flashing "missing" /
 *  "drift" before we know the truth.
 *
 *  Invariant: values are always non-empty strings once the map is non-null.
 *  Consumers may assume `live === undefined` is equivalent to `!(uuid in
 *  hashes.value)` — the API never emits explicit-undefined entries. If this
 *  ever changes, both `isMissingFromLibrary` and `isDrifted` in
 *  `ContextWidget.vue` need to be tightened together. */
export const hashes: Ref<Record<string, string> | null> = ref(null);

let refCount = 0;
let pollHandle: number | undefined;
const POLL_MS = 5000;

export function subscribe(): void {
  refCount++;
  if (refCount === 1) startPolling();
}

export function unsubscribe(): void {
  if (refCount === 0) return;
  refCount--;
  if (refCount === 0) stopPolling();
}

function startPolling(): void {
  void fetchHashes();
  pollHandle = window.setInterval(() => { void fetchHashes(); }, POLL_MS);
}

function stopPolling(): void {
  if (pollHandle !== undefined) {
    window.clearInterval(pollHandle);
    pollHandle = undefined;
  }
}

async function fetchHashes(): Promise<void> {
  try {
    const res = await fetch("/wp/api/modules/hashes");
    if (!res.ok) return;
    const body = (await res.json()) as { hashes?: Record<string, string> };
    if (body && body.hashes && typeof body.hashes === "object") {
      hashes.value = body.hashes;
    }
  } catch {
    // Silent — leave whatever we last had so transient errors don't flicker UI.
  }
}

export async function forceRefresh(): Promise<void> {
  await fetchHashes();
}

export async function refreshModule(m: ModuleEntry): Promise<ModuleEntry> {
  const result = await refreshMany([m]);
  if (result.failed.length > 0) throw new Error(result.failed[0].reason);
  // Defensive guard: refreshMany should always populate either refreshed or
  // failed for a single-uuid input, but if it ever introduces a "skip
  // silently" path the return type would still claim ModuleEntry while
  // handing back undefined. Throw before the consumer crashes on access.
  const merged = result.refreshed[0];
  if (!merged) throw new Error("refresh returned no entry");
  return merged;
}

export async function refreshMany(modules: ModuleEntry[]): Promise<RefreshResult> {
  if (modules.length === 0) return { refreshed: [], failed: [] };
  const uuids = modules.map((m) => m.id);

  let body: { snapshots?: Record<string, SnapshotEntry>; pickOrder?: string[] };
  try {
    const res = await fetch("/wp/api/modules/embed-bundle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uuids }),
    });
    if (!res.ok) {
      return {
        refreshed: [],
        failed: modules.map((m) => ({ id: m.id, reason: `HTTP ${res.status}` })),
      };
    }
    body = await res.json();
  } catch (err) {
    const reason = (err as Error).message || "network error";
    return { refreshed: [], failed: modules.map((m) => ({ id: m.id, reason })) };
  }

  const snapshots = body.snapshots ?? {};
  const refreshed: ModuleEntry[] = [];
  const failed: { id: string; reason: string }[] = [];
  for (const m of modules) {
    const live = snapshots[m.id];
    if (!live) {
      failed.push({ id: m.id, reason: "not in library" });
      continue;
    }
    refreshed.push(mergeRefresh(m, live));
  }
  return { refreshed, failed };
}

/**
 * Spread the library-side fields from `live` over the embedded entry, then
 * pin every widget-side field so user overrides + UI state survive. The
 * pin list MUST cover every widget-only ModuleEntry field — adding a new
 * widget field elsewhere requires extending this function.
 */
export function mergeRefresh(m: ModuleEntry, live: SnapshotEntry): ModuleEntry {
  return {
    type: live.type,
    meta: {
      name: live.name ?? m.meta.name,
      description: m.meta.description,
      tags: m.meta.tags,
    },
    payload: live.payload,
    payload_hash: live.payload_hash,
    id: m.id,
    enabled: m.enabled,
    entries: m.entries,
    instance: m.instance,
    collapsed: m.collapsed,
  };
}

/** Test-only — reset internal counters between cases. */
export function _resetForTests(): void {
  refCount = 0;
  stopPolling();
  hashes.value = null;
}
