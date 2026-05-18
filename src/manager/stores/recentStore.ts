import { defineStore } from "pinia";
import { computed, ref } from "vue";

export type RecentKind = "wildcard" | "fixed_values" | "combine" | "derivation" | "constraint" | "bundle";

export interface RecentItem {
  id: string;
  kind: RecentKind;
  name: string;
}

const STORAGE_KEY = "wp-recent-items";
const CAP = 6;

function isRecentItem(v: unknown): v is RecentItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && typeof o.kind === "string" && typeof o.name === "string";
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

  function push(item: RecentItem): void {
    const next = items.value.filter((i) => i.id !== item.id);
    next.unshift(item);
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
