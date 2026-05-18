import { defineStore } from "pinia";
import { computed, ref } from "vue";

export type RecentKind = "wildcard" | "fixed_values" | "combine" | "derivation" | "constraint" | "bundle";

export interface RecentItem {
  id: string;
  kind: RecentKind;
  name: string;
  /** ISO timestamp captured at push time so the Dashboard "Recently opened"
   *  surface can render a meaningful "X ago" date independent of the row's
   *  server-side `updated_at`. Older localStorage entries pre-dating this
   *  field get backfilled with the current timestamp on read. */
  openedAt: string;
}

const STORAGE_KEY = "wp-recent-items";
const CAP = 10;

function isRecentItem(v: unknown): v is RecentItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.kind !== "string" || typeof o.name !== "string") return false;
  if (typeof o.openedAt !== "string") {
    // Backfill missing openedAt with current timestamp so the entry is
    // still usable for the next render. Older localStorage payloads
    // (pre-dating this field) hit this path on first read.
    o.openedAt = new Date().toISOString();
  }
  return true;
}

function readStored(): RecentItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentItem).slice(0, CAP);
  } catch {
    return [];
  }
}

export const useRecentStore = defineStore("recent", () => {
  const items = ref<RecentItem[]>(readStored());

  function persist(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items.value)); }
    catch { /* localStorage unavailable */ }
  }

  /** Push (or move-to-front) a recent entry. Callers may omit `openedAt`
   *  — it gets stamped with the current timestamp here so existing call
   *  sites that pass `{id, kind, name}` keep working. */
  function push(item: Omit<RecentItem, "openedAt"> & { openedAt?: string }): void {
    const stamped: RecentItem = {
      id: item.id,
      kind: item.kind,
      name: item.name,
      openedAt: item.openedAt ?? new Date().toISOString(),
    };
    const next = items.value.filter((i) => i.id !== stamped.id);
    next.unshift(stamped);
    items.value = next.slice(0, CAP);
    persist();
  }

  /** Command-index-prefixed ids for the palette ranker's recent-boost.
   *  Bundles use `bundle:<id>`; all module kinds use `module:<id>`. */
  const recentIds = computed<string[]>(() =>
    items.value.map((i) => (i.kind === "bundle" ? `bundle:${i.id}` : `module:${i.id}`)),
  );

  return { items, recentIds, push };
});
