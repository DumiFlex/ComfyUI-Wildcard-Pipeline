import { watch } from "vue";
import { useUrlState, type UrlSchema } from "./useUrlState";
import {
  useListPrefsStore,
  type ListKind,
  type PageSize,
  type SortKey,
  PAGE_SIZE_OPTIONS,
  SORT_OPTIONS,
} from "../stores/listPrefsStore";

interface BaseShape {
  q: string;
  category: string | null;
  favorites: boolean;
  tags: string[];
  sortBy: string;
  /** Content-rating filter shared by every list view (+ All items):
   *  "all" (default) / "sfw" / "nsfw". Client-side over content_rating. */
  nsfw: string;
  page: number;
  pageSize: number;
}

/** Canonical URL schema for list views. Each view passes only its kind-specific
 *  fields as `extraSchema`. Identical schema literals across 7 views would drift
 *  over time — this composable owns the contract so any change here propagates
 *  everywhere. */
export const BASE_LIST_SCHEMA: UrlSchema<BaseShape> = {
  q:         { type: "string",         default: "" },
  category:  { type: "string-or-null", default: null,           urlKey: "cat" },
  favorites: { type: "bool",           default: false,          urlKey: "fav" },
  tags:      { type: "csv",            default: [],             urlKey: "tag" },
  sortBy:    { type: "string",         default: "updated-desc", urlKey: "sort" },
  nsfw:      { type: "string",         default: "all",          urlKey: "nsfw" },
  page:      { type: "int",            default: 1 },
  pageSize:  { type: "int",            default: 15,             urlKey: "ps" },
};

/**
 * Share the canonical list-view URL schema across all 7 list views.
 *
 * Pass `kind` (e.g. "wildcards", "constraints") to inherit the user's
 * persisted page-size + sort defaults from listPrefsStore. Without
 * `kind`, falls back to the hard-coded BASE_LIST_SCHEMA defaults.
 *
 * URL params still override store defaults at all times — the store
 * only provides the *starting* values when no URL state exists.
 */
const KNOWN_PAGE_SIZES = new Set<number>(PAGE_SIZE_OPTIONS);
const KNOWN_SORT_KEYS = new Set<string>(SORT_OPTIONS.map((o) => o.value));

export function useListUrlState<E extends object = Record<string, never>>(
  extraSchema?: UrlSchema<E>,
  kind?: ListKind,
) {
  let baseSchema: UrlSchema<BaseShape> = BASE_LIST_SCHEMA;
  let prefs: ReturnType<typeof useListPrefsStore> | null = null;
  if (kind) {
    prefs = useListPrefsStore();
    baseSchema = {
      ...BASE_LIST_SCHEMA,
      sortBy:   { ...BASE_LIST_SCHEMA.sortBy,   default: prefs.sortBy[kind] },
      pageSize: { ...BASE_LIST_SCHEMA.pageSize, default: prefs.pageSize[kind] },
    };
  }
  const schema = {
    ...baseSchema,
    ...(extraSchema ?? ({} as UrlSchema<E>)),
  } as UrlSchema<BaseShape & E>;
  const state = useUrlState<BaseShape & E>(schema);

  // Mirror the user's in-session pageSize/sortBy choices back to the
  // prefs store so the next visit picks up the new defaults. Only
  // accepted values (PAGE_SIZE_OPTIONS / SORT_OPTIONS) are persisted —
  // arbitrary URL values stay session-scoped.
  if (kind && prefs) {
    const persistedKind = kind;
    const persistedStore = prefs;
    watch(
      () => state.pageSize,
      (v) => {
        if (KNOWN_PAGE_SIZES.has(v)) persistedStore.setPageSize(persistedKind, v as PageSize);
      },
    );
    watch(
      () => state.sortBy,
      (v) => {
        if (KNOWN_SORT_KEYS.has(v)) persistedStore.setSortBy(persistedKind, v as SortKey);
      },
    );
  }

  return state;
}
