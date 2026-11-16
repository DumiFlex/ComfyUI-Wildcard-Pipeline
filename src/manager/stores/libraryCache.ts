/**
 * The one copy of a library list (modules, bundles, templates) that every
 * page reads: list pages filter it on the client, editors resolve refs
 * against it, the sidebar counts it.
 *
 * - Held in a `shallowRef`: the rows are plain API objects and nothing edits
 *   them in place, so Vue doesn't need to proxy ~1 MB of payloads (a list
 *   render used to spend most of its time in `track`). A change REPLACES the
 *   array (and the changed row object), which is also what keys the
 *   validation cache in `utils/validateModule.ts`. Never mutate the array or
 *   a row: a mutation neither re-renders nor clears that cache.
 * - One request at a time is enough: a list page mounting while the boot
 *   fetch runs waits for that one instead of sending its own.
 * - `ensure()` answers from the copy and revalidates it in the background
 *   when it is older than `STALE_MS` (catches renames and favourites made in
 *   another tab, which the drift poll's payload hashes don't see). Payload
 *   changes from anywhere arrive through AppLayout's drift watch, and chat
 *   cards / cascades through `libraryVersion`, each refetching once.
 */
import { ref, shallowRef, type Ref, type ShallowRef } from "vue";

export const STALE_MS = 60_000;

export interface LibraryCache<T> {
  rows: ShallowRef<T[]>;
  /** True once a fetch has landed (an empty library is loaded too). */
  loaded: Ref<boolean>;
  /** Fetch now (the newest request wins when two overlap). */
  refresh: () => Promise<void>;
  /** Resolve once a copy is there: waits for the first fetch (or the one in
   *  flight), and refreshes a stale copy in the background. */
  ensure: () => Promise<void>;
  /** Swap the whole list (store mutations: create / update / delete). */
  set: (rows: T[]) => void;
}

export function createLibraryCache<T>(
  load: () => Promise<{ items: T[] }>,
  now: () => number = Date.now,
): LibraryCache<T> {
  const rows = shallowRef<T[]>([]);
  const loaded = ref(false);
  let fetchedAt = 0;
  let seq = 0;
  let inflight: Promise<void> | null = null;

  function refresh(): Promise<void> {
    const mine = ++seq;
    const p = load().then((res) => {
      if (mine !== seq) return;
      rows.value = res.items;
      fetchedAt = now();
      loaded.value = true;
    });
    inflight = p;
    const clear = () => { if (inflight === p) inflight = null; };
    p.then(clear, clear);
    return p;
  }

  async function ensure(): Promise<void> {
    if (inflight) {
      try {
        await inflight;
      } catch (e) {
        if (!loaded.value) throw e;
      }
      if (loaded.value) return;
    }
    if (!loaded.value) return refresh();
    if (now() - fetchedAt > STALE_MS) refresh().catch(() => undefined);
  }

  function set(next: T[]): void {
    rows.value = next;
  }

  return { rows, loaded, refresh, ensure, set };
}

/** Replace the row with `row.id` (when present) by `row`, as a new array. */
export function replaceRow<T extends { id: string }>(list: readonly T[], row: T): T[] {
  const i = list.findIndex((r) => r.id === row.id);
  if (i < 0) return list as T[];
  const next = list.slice();
  next[i] = row;
  return next;
}

export interface ListFilter {
  type?: string;
  category?: string | null;
  q?: string;
  favorites?: boolean;
}

/** The server's list filter, on the client: kind, category, favourites and
 *  `q` matching the name or the id (case-insensitive substring, as the
 *  repository's `LIKE … COLLATE NOCASE`). Order is kept (the catalog comes
 *  back newest first, like a filtered list). */
export function filterRows<T extends {
  id: string;
  name?: string;
  type?: string;
  category_id?: string | null;
  is_favorite?: boolean;
}>(rows: readonly T[], f: ListFilter): T[] {
  const q = (f.q ?? "").toLowerCase();
  if (!f.type && !f.category && !f.favorites && !q) return rows.slice();
  return rows.filter((r) => {
    if (f.type && r.type !== f.type) return false;
    if (f.category && r.category_id !== f.category) return false;
    if (f.favorites && !r.is_favorite) return false;
    if (q && !(r.name ?? "").toLowerCase().includes(q) && !r.id.toLowerCase().includes(q)) return false;
    return true;
  });
}
