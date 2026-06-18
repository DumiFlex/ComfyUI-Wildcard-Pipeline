/**
 * Boot wiring for the one-time library UUID repair (Part 3). Builds the
 * dependency-injected `RepairDeps` from the live api client + gates the run so
 * it fires once per repair version. Kept separate from `uuid-repair.ts` (which
 * stays pure + server-free) so the orchestrator unit-tests don't pull the api.
 */
import { api } from "../api/client";
import type { ModuleType } from "../api/types";
import { runLibraryRepair, type RepairableEntry, type RepairDeps } from "./uuid-repair";

const REPAIR_KEY = "wp_uuid_repair_version";
/** Bump to force the repair to re-run after a future fix. */
const REPAIR_VERSION = 1;

function apiRepairDeps(): RepairDeps {
  return {
    listModules: async () => (await api.modules.list({})).items as unknown as RepairableEntry[],
    listBundles: async () => (await api.bundles.list({})).items as unknown as RepairableEntry[],
    createModule: async (e) => {
      const row = await api.modules.create({
        type: e.type as ModuleType,
        name: String(e.name ?? ""),
        description: typeof e.description === "string" ? e.description : undefined,
        category_id: (e.category_id as string | null | undefined) ?? null,
        tags: Array.isArray(e.tags) ? (e.tags as string[]) : undefined,
        payload: e.payload ?? {},
        content_rating: e.content_rating as "safe" | "nsfw" | undefined,
      });
      return { id: row.id };
    },
    createBundle: async (e) => {
      const row = await api.bundles.create({
        name: String(e.name ?? ""),
        description: typeof e.description === "string" ? e.description : undefined,
        color: (e.color as string | null | undefined) ?? null,
        category_id: (e.category_id as string | null | undefined) ?? null,
        tags: Array.isArray(e.tags) ? (e.tags as string[]) : undefined,
        children: (e.children as Array<Record<string, unknown>> | undefined) ?? [],
        content_rating: e.content_rating as "safe" | "nsfw" | undefined,
      });
      return { id: row.id };
    },
    updateModule: async (id, payload) => {
      await api.modules.update(id, { payload });
    },
    updateBundle: async (id, children) => {
      await api.bundles.update(id, { children: children as Array<Record<string, unknown>> });
    },
    deleteModule: async (id) => {
      await api.modules.delete(id);
    },
    deleteBundle: async (id) => {
      await api.bundles.delete(id);
    },
  };
}

/**
 * Run the library UUID repair once per `REPAIR_VERSION`. Fire-and-forget from
 * boot — never throws, never blocks first paint. The version marker is set
 * ONLY after a successful run, so a crash (or an offline DB) simply retries on
 * the next load. Returns the number of rows rekeyed (0 = nothing to do / gated
 * / failed), so the caller can refresh its catalogs when something changed.
 */
export async function repairLibraryOnce(): Promise<number> {
  try {
    const done = Number(localStorage.getItem(REPAIR_KEY) ?? "0");
    if (done >= REPAIR_VERSION) return 0;
    const { repaired } = await runLibraryRepair(apiRepairDeps());
    localStorage.setItem(REPAIR_KEY, String(REPAIR_VERSION));
    if (repaired > 0) {
      console.info(`[wp] library uuid repair: rekeyed ${repaired} row(s) with invalid ids`);
    }
    return repaired;
  } catch (err) {
    console.warn("[wp] library uuid repair failed (will retry next load):", err);
    return 0;
  }
}
