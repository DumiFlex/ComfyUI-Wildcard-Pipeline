import { defineStore } from "pinia";
import { reactive, watch } from "vue";

/**
 * listPrefsStore — per-list-kind defaults (page size + sort key)
 * persisted to localStorage.
 *
 * The list views already accept `pageSize` + `sortBy` via the URL query
 * (`useListUrlState`), so URL params always win during a session. This
 * store provides the *default* values used when no URL state exists —
 * e.g. the first time a user lands on /wildcards, or follows a deep
 * link that doesn't carry list state.
 *
 * Defaults are keyed by kind so power users who like 100 rows on the
 * busy 'wildcards' list and 10 on quiet 'constraints' can have both.
 */

const STORAGE_KEY = "wp-list-prefs-v1";

export type ListKind =
  | "wildcards"
  | "fixed-values"
  | "combines"
  | "derivations"
  | "constraints"
  | "bundles"
  | "all";

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export type PageSize = typeof PAGE_SIZE_OPTIONS[number];

export const SORT_OPTIONS = [
  { value: "updated-desc", label: "Updated — newest" },
  { value: "updated-asc",  label: "Updated — oldest" },
  { value: "name-asc",     label: "Name A → Z" },
  { value: "name-desc",    label: "Name Z → A" },
] as const;
export type SortKey = typeof SORT_OPTIONS[number]["value"];

const DEFAULT_PAGE_SIZE: PageSize = 25;
const DEFAULT_SORT: SortKey       = "updated-desc";

interface PersistedShape {
  pageSize?: Partial<Record<ListKind, PageSize>>;
  sortBy?: Partial<Record<ListKind, SortKey>>;
}

function readStored(): PersistedShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedShape;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStored(v: PersistedShape) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* localStorage unavailable */
  }
}

export const useListPrefsStore = defineStore("listPrefs", () => {
  const stored = readStored();

  const pageSize = reactive<Record<ListKind, PageSize>>({
    wildcards:      stored.pageSize?.wildcards      ?? DEFAULT_PAGE_SIZE,
    "fixed-values": stored.pageSize?.["fixed-values"] ?? DEFAULT_PAGE_SIZE,
    combines:       stored.pageSize?.combines       ?? DEFAULT_PAGE_SIZE,
    derivations:    stored.pageSize?.derivations    ?? DEFAULT_PAGE_SIZE,
    constraints:    stored.pageSize?.constraints    ?? DEFAULT_PAGE_SIZE,
    bundles:        stored.pageSize?.bundles        ?? DEFAULT_PAGE_SIZE,
    all:            stored.pageSize?.all            ?? DEFAULT_PAGE_SIZE,
  });

  const sortBy = reactive<Record<ListKind, SortKey>>({
    wildcards:      stored.sortBy?.wildcards      ?? DEFAULT_SORT,
    "fixed-values": stored.sortBy?.["fixed-values"] ?? DEFAULT_SORT,
    combines:       stored.sortBy?.combines       ?? DEFAULT_SORT,
    derivations:    stored.sortBy?.derivations    ?? DEFAULT_SORT,
    constraints:    stored.sortBy?.constraints    ?? DEFAULT_SORT,
    bundles:        stored.sortBy?.bundles        ?? DEFAULT_SORT,
    all:            stored.sortBy?.all            ?? DEFAULT_SORT,
  });

  function setPageSize(kind: ListKind, size: PageSize): void {
    pageSize[kind] = size;
  }

  function setSortBy(kind: ListKind, sort: SortKey): void {
    sortBy[kind] = sort;
  }

  function reset(): void {
    for (const k of Object.keys(pageSize) as ListKind[]) {
      pageSize[k] = DEFAULT_PAGE_SIZE;
      sortBy[k] = DEFAULT_SORT;
    }
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  watch(
    [pageSize, sortBy],
    () => writeStored({
      pageSize: { ...pageSize },
      sortBy: { ...sortBy },
    }),
    { deep: true },
  );

  return { pageSize, sortBy, setPageSize, setSortBy, reset };
});
