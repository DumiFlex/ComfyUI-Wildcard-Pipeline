/**
 * Library UUID repair (Part 3 of the uuid-fixer).
 *
 * Modules/bundles authored with a non-8-hex id (e.g. `coloruni`) can't be
 * nested-referenced (`@{coloruni}` matches neither the editor chip tokenizer
 * nor the engine resolver — both `[0-9a-f]{8}`). PR #5 fixes ids on the way IN
 * (import/download); this repairs ids ALREADY in the local library.
 *
 * `create` server-mints the id (no `id` field on the create body), so the new
 * id is only known AFTER the row is created. The orchestrator therefore:
 *   create copies (server mints) → build old→new map → remap referrers + the
 *   created rows → update → delete the old rows.
 *
 * Pure helpers (`findInvalidIds`, `planRemapUpdates`, `remapAll`) are exported
 * for unit tests; `runLibraryRepair` is dependency-injected so it tests against
 * a mock store with no server. Scope: TOP-LEVEL module + bundle ids (bundle
 * child-snapshot ids are a documented follow-up).
 */
import { isValidId } from "../utils/ids";
import { walkRemap } from "../../components/context/bundles/uuid-remap";

/** Minimal shape the repair needs from a library row (module or bundle). */
export interface RepairableEntry {
  id: string;
  type?: string;
  payload?: Record<string, unknown>;
  children?: unknown[];
  [k: string]: unknown;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rewrite nested `@{oldid…}` refs whose id is one of the renamed ids.
 * `walkRemap`'s `REF_RE` only matches `[0-9a-f]{6,16}`, so it SILENTLY skips a
 * non-hex id like `@{coloruni}` — exactly the ids we repair. Matches up to a
 * ref delimiter (`}` `#` `:` `!`) so the `#name`/`:filter`/`!null` suffix is
 * preserved verbatim.
 */
function rewriteInvalidNestedRefs(value: unknown, renameMap: Record<string, string>): unknown {
  if (typeof value === "string") {
    let out = value;
    for (const [oldId, newId] of Object.entries(renameMap)) {
      out = out.replace(new RegExp(`@\\{${escapeRe(oldId)}([#:!}])`, "g"), `@{${newId}$1`);
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => rewriteInvalidNestedRefs(v, renameMap));
  if (value && typeof value === "object") {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      obj[k] = rewriteInvalidNestedRefs(v, renameMap);
    }
    return obj;
  }
  return value;
}

/** Full ref remap: `walkRemap` (whole-string constraint axes + any hex nested
 *  refs) THEN the literal pass for the non-hex ids walkRemap can't see. */
export function remapAll(value: unknown, renameMap: Record<string, string>): unknown {
  return rewriteInvalidNestedRefs(walkRemap(value, renameMap), renameMap);
}

/** Ids that fail the canonical 8-hex shape and therefore need rekeying. */
export function findInvalidIds(entries: readonly RepairableEntry[]): string[] {
  return entries.filter((e) => !isValidId(e.id)).map((e) => e.id);
}

export interface RemapUpdate {
  id: string;
  payload?: Record<string, unknown>;
  children?: unknown[];
}

/**
 * Given the COMPLETE old→new id map, return every entry whose payload or
 * children actually change under `remapAll` — the rows that need a server
 * update. Caller passes the rows under their CURRENT id (freshly-created rows
 * under their new id + original payload, plus the untouched referrers), so the
 * returned `id` is the one to `update`.
 */
export function planRemapUpdates(
  entries: readonly RepairableEntry[],
  renameMap: Record<string, string>,
): RemapUpdate[] {
  if (Object.keys(renameMap).length === 0) return [];
  const out: RemapUpdate[] = [];
  for (const e of entries) {
    const update: RemapUpdate = { id: e.id };
    let changed = false;
    if (e.payload !== undefined) {
      const next = remapAll(e.payload, renameMap) as Record<string, unknown>;
      if (JSON.stringify(next) !== JSON.stringify(e.payload)) {
        update.payload = next;
        changed = true;
      }
    }
    if (e.children !== undefined) {
      const next = remapAll(e.children, renameMap) as unknown[];
      if (JSON.stringify(next) !== JSON.stringify(e.children)) {
        update.children = next;
        changed = true;
      }
    }
    if (changed) out.push(update);
  }
  return out;
}

/** Store surface the repair needs — modules + bundles. Dependency-injected so
 *  the orchestrator unit-tests against a mock with no server. `create*` return
 *  the server-minted id. */
export interface RepairDeps {
  listModules(): Promise<RepairableEntry[]>;
  listBundles(): Promise<RepairableEntry[]>;
  createModule(entry: RepairableEntry): Promise<{ id: string }>;
  createBundle(entry: RepairableEntry): Promise<{ id: string }>;
  updateModule(id: string, payload: Record<string, unknown>): Promise<void>;
  updateBundle(id: string, children: unknown[]): Promise<void>;
  deleteModule(id: string): Promise<void>;
  deleteBundle(id: string): Promise<void>;
}

export interface RepairResult {
  /** Count of rows rekeyed (modules + bundles). 0 = nothing to do. */
  repaired: number;
}

/**
 * One-time library repair. Idempotent: a clean library (all valid ids) is a
 * no-op. Order is create → update → delete so a crash never leaves a dangling
 * ref — referrers always point at an id that already exists; worst case is a
 * harmless unreferenced row, cleaned on the next run.
 */
export async function runLibraryRepair(deps: RepairDeps): Promise<RepairResult> {
  const modules = await deps.listModules();
  const bundles = await deps.listBundles();
  const invalidModules = modules.filter((m) => !isValidId(m.id));
  const invalidBundles = bundles.filter((b) => !isValidId(b.id));
  if (invalidModules.length + invalidBundles.length === 0) return { repaired: 0 };

  // 1. Create copies first — the server mints the new ids.
  const renameMap: Record<string, string> = {};
  const createdModules: RepairableEntry[] = [];
  for (const m of invalidModules) {
    const { id } = await deps.createModule(m);
    renameMap[m.id] = id;
    createdModules.push({ ...m, id });
  }
  const createdBundles: RepairableEntry[] = [];
  for (const b of invalidBundles) {
    const { id } = await deps.createBundle(b);
    renameMap[b.id] = id;
    createdBundles.push({ ...b, id });
  }

  // 2. With the full map, remap referrers + the freshly-created rows (their
  //    payloads may reference other rekeyed ids). Survivors keep their id.
  const survivorModules = modules.filter((m) => isValidId(m.id));
  const survivorBundles = bundles.filter((b) => isValidId(b.id));
  const moduleUpdates = planRemapUpdates([...createdModules, ...survivorModules], renameMap);
  const bundleUpdates = planRemapUpdates([...createdBundles, ...survivorBundles], renameMap);
  for (const u of moduleUpdates) {
    if (u.payload !== undefined) await deps.updateModule(u.id, u.payload);
  }
  for (const u of bundleUpdates) {
    if (u.children !== undefined) await deps.updateBundle(u.id, u.children);
  }

  // 3. Delete the old (invalid-id) rows last.
  for (const m of invalidModules) await deps.deleteModule(m.id);
  for (const b of invalidBundles) await deps.deleteBundle(b.id);

  return { repaired: invalidModules.length + invalidBundles.length };
}
