import type { ModuleRow, BundleRow } from "../api/types";

type ModuleStore = ReturnType<typeof import("../stores/moduleStore").useModuleStore>;
type BundleStore = ReturnType<typeof import("../stores/bundleStore").useBundleStore>;

export type AnyRow = ModuleRow | BundleRow;

export interface BulkResult {
  ok: number;
  failed: number;
  errors: { id: string; reason: string }[];
}

export interface BulkAdapter {
  setFavorite(items: AnyRow[], on: boolean): Promise<BulkResult>;
  duplicate(items: AnyRow[]): Promise<BulkResult & { created: string[] }>;
  addTag(items: AnyRow[], tag: string): Promise<BulkResult>;
  removeTag(items: AnyRow[], tag: string): Promise<BulkResult>;
  setCategory(items: AnyRow[], categoryId: string | null): Promise<BulkResult>;
  delete(items: AnyRow[]): Promise<BulkResult>;
}

function emptyResult(): BulkResult {
  return { ok: 0, failed: 0, errors: [] };
}

function isModule(row: AnyRow): row is ModuleRow {
  // Discriminate on `children` (bundle-only required field) rather than `type`
  // (module-only) — `children` is structurally definitive and won't false-positive
  // if some future ModuleRow variant gains an optional `type: string` field.
  return !("children" in row);
}

async function runEach<R extends AnyRow>(
  items: R[],
  fn: (item: R) => Promise<void>,
): Promise<BulkResult> {
  const res = emptyResult();
  await Promise.all(
    items.map(async (item) => {
      try {
        await fn(item);
        res.ok += 1;
      } catch (e) {
        res.failed += 1;
        res.errors.push({ id: item.id, reason: e instanceof Error ? e.message : String(e) });
      }
    }),
  );
  return res;
}

export function makeModuleStoreAdapter(store: ModuleStore): BulkAdapter {
  // Refresh items from the live store before idempotence filtering.
  // The composable's undo handlers close over the items array from BEFORE
  // the original mutation — by undo time, store has refetched and those
  // refs are stale. Without this lookup, the idempotence filter reads
  // pre-mutation `is_favorite`/`tags` and incorrectly skips items that
  // need flipping back.
  function fresh(items: AnyRow[]): ModuleRow[] {
    return items.map((i) => {
      const live = store.items.find((s) => s.id === i.id) ?? store.catalog.find((s) => s.id === i.id);
      return (live ?? (i as ModuleRow));
    });
  }
  return {
    async setFavorite(items, on) {
      const live = fresh(items);
      const target = live.filter((i) => Boolean(i.is_favorite) !== on);
      const skipped = live.length - target.length;
      const res = await runEach(target, async (i) => { await store.toggleFavorite(i.id); });
      res.ok += skipped;
      return res;
    },
    async duplicate(items) {
      const created: string[] = [];
      const res = emptyResult();
      // Sequential to preserve input order in `created` array.
      for (const i of items as ModuleRow[]) {
        try {
          const copy = await store.duplicate(i.id);
          created.push(copy.id);
          res.ok += 1;
        } catch (e) {
          res.failed += 1;
          res.errors.push({ id: i.id, reason: e instanceof Error ? e.message : String(e) });
        }
      }
      return { ...res, created };
    },
    async addTag(items, tag) {
      const live = fresh(items);
      const target = live.filter((i) => !(i.tags ?? []).includes(tag));
      const skipped = live.length - target.length;
      const res = await runEach(target, async (i) => {
        const nextTags = [...(i.tags ?? []), tag];
        await store.update(i.id, { tags: nextTags });
      });
      res.ok += skipped;
      return res;
    },
    async removeTag(items, tag) {
      const live = fresh(items);
      const target = live.filter((i) => (i.tags ?? []).includes(tag));
      const skipped = live.length - target.length;
      const res = await runEach(target, async (i) => {
        const nextTags = (i.tags ?? []).filter((t) => t !== tag);
        await store.update(i.id, { tags: nextTags });
      });
      res.ok += skipped;
      return res;
    },
    async setCategory(items, categoryId) {
      return runEach(items as ModuleRow[], async (i) => {
        await store.update(i.id, { category_id: categoryId });
      });
    },
    async delete(items) {
      return runEach(items as ModuleRow[], async (i) => { await store.remove(i.id); });
    },
  };
}

export function makeBundleStoreAdapter(store: BundleStore): BulkAdapter {
  // Same staleness defeat as the module adapter — re-read live state via
  // the store before deciding what to mutate. See `makeModuleStoreAdapter`
  // for the full rationale.
  function fresh(items: AnyRow[]): BundleRow[] {
    return items.map((i) => {
      const live = store.items.find((s) => s.id === i.id) ?? store.catalog.find((s) => s.id === i.id);
      return (live ?? (i as BundleRow));
    });
  }
  return {
    async setFavorite(items, on) {
      const live = fresh(items);
      const target = live.filter((i) => Boolean(i.is_favorite) !== on);
      const skipped = live.length - target.length;
      const res = await runEach(target, async (i) => { await store.toggleFavorite(i.id); });
      res.ok += skipped;
      return res;
    },
    async duplicate(items) {
      // Bundle store has no duplicate method; this is intentionally not
      // wired in Phase 3 — bundles are duplicated via Context widget, not
      // library. Surface as failed batch.
      const errors = items.map((i) => ({ id: i.id, reason: "bundle duplicate not supported in library" }));
      return { ok: 0, failed: items.length, errors, created: [] };
    },
    async addTag(items, tag) {
      const live = fresh(items);
      const target = live.filter((i) => !(i.tags ?? []).includes(tag));
      const skipped = live.length - target.length;
      const res = await runEach(target, async (i) => {
        const nextTags = [...(i.tags ?? []), tag];
        await store.update(i.id, { tags: nextTags });
      });
      res.ok += skipped;
      return res;
    },
    async removeTag(items, tag) {
      const live = fresh(items);
      const target = live.filter((i) => (i.tags ?? []).includes(tag));
      const skipped = live.length - target.length;
      const res = await runEach(target, async (i) => {
        const nextTags = (i.tags ?? []).filter((t) => t !== tag);
        await store.update(i.id, { tags: nextTags });
      });
      res.ok += skipped;
      return res;
    },
    async setCategory(items) {
      const errors = items.map((i) => ({ id: i.id, reason: "bundles have no category" }));
      return { ok: 0, failed: items.length, errors };
    },
    async delete(items) {
      return runEach(items as BundleRow[], async (i) => { await store.remove(i.id); });
    },
  };
}

export function makeMixedKindAdapter(stores: {
  moduleStore: ModuleStore;
  bundleStore: BundleStore;
}): BulkAdapter {
  const mod = makeModuleStoreAdapter(stores.moduleStore);
  const bun = makeBundleStoreAdapter(stores.bundleStore);

  function partition(items: AnyRow[]): { modules: ModuleRow[]; bundles: BundleRow[] } {
    const modules: ModuleRow[] = [];
    const bundles: BundleRow[] = [];
    for (const i of items) {
      if (isModule(i)) modules.push(i);
      else bundles.push(i as BundleRow);
    }
    return { modules, bundles };
  }

  function merge(a: BulkResult, b: BulkResult): BulkResult {
    return {
      ok: a.ok + b.ok,
      failed: a.failed + b.failed,
      errors: [...a.errors, ...b.errors],
    };
  }

  return {
    async setFavorite(items, on) {
      const { modules, bundles } = partition(items);
      return merge(await mod.setFavorite(modules, on), await bun.setFavorite(bundles, on));
    },
    async duplicate(items) {
      const { modules, bundles } = partition(items);
      const m = await mod.duplicate(modules);
      const b = await bun.duplicate(bundles);
      return {
        ...merge(m, b),
        created: [...m.created, ...b.created],
      };
    },
    async addTag(items, tag) {
      const { modules, bundles } = partition(items);
      return merge(await mod.addTag(modules, tag), await bun.addTag(bundles, tag));
    },
    async removeTag(items, tag) {
      const { modules, bundles } = partition(items);
      return merge(await mod.removeTag(modules, tag), await bun.removeTag(bundles, tag));
    },
    async setCategory(items, categoryId) {
      const { modules, bundles } = partition(items);
      return merge(await mod.setCategory(modules, categoryId), await bun.setCategory(bundles, categoryId));
    },
    async delete(items) {
      const { modules, bundles } = partition(items);
      return merge(await mod.delete(modules), await bun.delete(bundles));
    },
  };
}
