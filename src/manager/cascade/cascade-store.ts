/**
 * Pinia store wrapping the reverse-dep index.
 *
 * Lazy lifecycle: index starts null + stale=true. Caller (typically
 * the manager App on mount or sidebar-load completion) calls `rebuild`
 * with the live library snapshot. After every cascade-apply, the
 * useCascadeApply composable calls `applyDiff` with the server-returned
 * diff payload to keep the index incrementally fresh. Any other mutation
 * path calls `invalidate()` for lazy full-rebuild on next read.
 */

import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  applyDiff as _applyDiff,
  buildIndex,
  categoryRefsTo as _categoryRefsTo,
  combineVarRefsTo as _combineVarRefsTo,
  optionRefsTo as _optionRefsTo,
  refsTo as _refsTo,
  subcatRefsTo as _subcatRefsTo,
  type DiffEntry,
  type IncomingRef,
  type LibraryFixture,
  type ReverseDepIndex,
} from "./reverse-dep-index";

export const useCascadeStore = defineStore("cascade", () => {
  const index = ref<ReverseDepIndex | null>(null);
  const stale = ref<boolean>(true);

  function rebuild(lib: LibraryFixture): void {
    index.value = buildIndex(lib);
    stale.value = false;
  }

  function invalidate(): void {
    stale.value = true;
  }

  function applyDiff(diff: DiffEntry[]): void {
    if (index.value) _applyDiff(index.value, diff);
  }

  function refsTo(kind: string, id: string): IncomingRef[] {
    if (!index.value) return [];
    return _refsTo(index.value, kind, id);
  }

  function subcatRefsTo(wildcard_id: string, subcat: string): IncomingRef[] {
    if (!index.value) return [];
    return _subcatRefsTo(index.value, wildcard_id, subcat);
  }

  function combineVarRefsTo(name: string): IncomingRef[] {
    if (!index.value) return [];
    return _combineVarRefsTo(index.value, name);
  }

  function categoryRefsTo(category_id: string): IncomingRef[] {
    if (!index.value) return [];
    return _categoryRefsTo(index.value, category_id);
  }

  function optionRefsTo(option_id: string): IncomingRef[] {
    if (!index.value) return [];
    return _optionRefsTo(index.value, option_id);
  }

  const isStale = computed<boolean>(() => stale.value);

  return {
    isStale,
    rebuild,
    invalidate,
    applyDiff,
    refsTo,
    subcatRefsTo,
    combineVarRefsTo,
    categoryRefsTo,
    optionRefsTo,
  };
});
