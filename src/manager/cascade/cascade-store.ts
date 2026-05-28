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
import type { BundleRow, CategoryRow, ModuleRow } from "../api/types";
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

  /**
   * Build the reverse-dep index straight from the three live library store
   * catalogs (modules, bundles, categories). Encapsulates the LibraryFixture
   * mapping so every call site stays in lockstep — modules are split by `type`
   * into the per-kind arrays, bundles carry their children, categories their
   * names. Constraints omit `category_id` (constraints are not category-tagged).
   *
   * Pure read + build (no DOM mutation), so it's safe to call from a `watch`
   * handler / drift self-heal as well as the initial bootstrap.
   */
  function rebuildFromCatalogs(
    modules: ModuleRow[],
    bundles: BundleRow[],
    categories: CategoryRow[],
  ): void {
    rebuild({
      wildcards: modules.filter((m) => m.type === "wildcard").map((m) => ({
        id: m.id, name: m.name, payload: m.payload ?? {}, category_id: m.category_id,
      })),
      fixed_values: modules.filter((m) => m.type === "fixed_values").map((m) => ({
        id: m.id, name: m.name, payload: m.payload ?? {}, category_id: m.category_id,
      })),
      combines: modules.filter((m) => m.type === "combine").map((m) => ({
        id: m.id, name: m.name, payload: m.payload ?? {}, category_id: m.category_id,
      })),
      derivations: modules.filter((m) => m.type === "derivation").map((m) => ({
        id: m.id, name: m.name, payload: m.payload ?? {}, category_id: m.category_id,
      })),
      constraints: modules.filter((m) => m.type === "constraint").map((m) => ({
        id: m.id, name: m.name, payload: m.payload ?? {},
      })),
      bundles: bundles.map((b) => ({
        id: b.id, name: b.name,
        children: (b.children ?? []) as Array<{ id: string; type: string }>,
      })),
      categories: categories.map((c) => ({ id: c.id, name: c.name })),
    });
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
    rebuildFromCatalogs,
    invalidate,
    applyDiff,
    refsTo,
    subcatRefsTo,
    combineVarRefsTo,
    categoryRefsTo,
    optionRefsTo,
  };
});
