import { useUrlState, type UrlSchema } from "./useUrlState";

interface BaseShape {
  q: string;
  category: string | null;
  favorites: boolean;
  tags: string[];
  sortBy: string;
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
  page:      { type: "int",            default: 1 },
  pageSize:  { type: "int",            default: 15,             urlKey: "ps" },
};

/**
 * Share the canonical list-view URL schema across all 7 list views. Each
 * view passes only its kind-specific fields as `extraSchema`.
 */
export function useListUrlState<E extends object = Record<string, never>>(
  extraSchema?: UrlSchema<E>,
) {
  const schema = {
    ...BASE_LIST_SCHEMA,
    ...(extraSchema ?? ({} as UrlSchema<E>)),
  } as UrlSchema<BaseShape & E>;
  return useUrlState<BaseShape & E>(schema);
}
