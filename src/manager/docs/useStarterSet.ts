/**
 * useStarterSet — the create-direct engine behind the Starter Set tutorial
 * buttons (Phase A of `docs/superpowers/plans/2026-05-28-starter-set-tutorial.md`).
 *
 * Doc pages don't prefill the new-module forms; they call these functions to
 * create real library rows immediately, so the starter set reliably exists and
 * is runnable. Every function is idempotent — re-clicking a button reuses the
 * recorded row (verified live via `api.modules.get`) instead of duplicating it.
 *
 * Three layers:
 *   - `ensureSlot`            low-level: reuse-or-create one module slot.
 *   - `createStarterModule`   per-page entry: wraps `ensureSlot` (+ deps for
 *                             the constraint) and toasts.
 *   - `buildStarterBundle`    failsafe: guarantees the whole 6-module set,
 *                             then assembles a library-linked bundle + the
 *                             standalone template.
 *
 * Stores are refreshed after writes so sidebar counts / list views reflect the
 * new rows without a manual reload.
 */
import { useRouter } from "vue-router";
import { api } from "../api/client";
import type { ModuleRow } from "../api/types";
import { useToast } from "../composables/useToast";
import { useBundleStore } from "../stores/bundleStore";
import { useModuleStore } from "../stores/moduleStore";
import { useStarterStore } from "../stores/starterStore";
import { useTemplateStore } from "../stores/templateStore";
import {
  STARTER_BUNDLE_NAME,
  STARTER_BUNDLE_ORDER,
  STARTER_MODULE_DESCRIPTORS,
  STARTER_MODULE_SLOTS,
  STARTER_TEMPLATE_NAME,
  buildTemplateInput,
  type PairingBuildContext,
  type StarterModuleSlot,
} from "./starter-recipe";

/** Route name each module slot's "Open" link targets. */
export const SLOT_EDIT_ROUTE: Record<StarterModuleSlot, string> = {
  subject: "wildcards-edit",
  mood: "wildcards-edit",
  style: "fixed-values-edit",
  scene: "combines-edit",
  accent: "derivations-edit",
  pairing: "constraints-edit",
};

/** Route name every recordable starter key's "Open" link targets — the six
 *  module slots plus the standalone `template` and assembled `bundle`. Reused
 *  by `StarterButton.vue` so the button doesn't hard-code route names. */
export const STARTER_EDIT_ROUTE: Record<StarterModuleSlot | "template" | "bundle", string> = {
  ...SLOT_EDIT_ROUTE,
  template: "templates-edit",
  bundle: "bundles-edit",
};

export function useStarterSet() {
  const router = useRouter();
  const toast = useToast();
  const starter = useStarterStore();
  const moduleStore = useModuleStore();
  const bundleStore = useBundleStore();
  const templateStore = useTemplateStore();

  /** Refresh all three library catalogs after a write so the sidebar counts +
   *  lists stay live. Templates are included so the nav Templates count (which
   *  reads `templateStore.catalog.length`) updates without a page refresh. */
  async function refreshCatalogs(): Promise<void> {
    await Promise.all([
      moduleStore.fetchCatalog(),
      bundleStore.fetchCatalog(),
      templateStore.fetchCatalog(),
    ]);
  }

  /** Whether the row recorded for `slot` still exists in the live library
   *  catalog. Drives StarterButton's created/Open state: if the user deletes
   *  the created module / bundle / template, this flips false and the button
   *  resets to its create affordance. Reactive — reads the store catalogs, so a
   *  computed that calls it re-evaluates when a catalog changes. */
  function isSlotLive(slot: StarterModuleSlot | "template" | "bundle"): boolean {
    const id = starter.idFor(slot);
    if (!id) return false;
    if (slot === "bundle") return bundleStore.catalog.some((b) => b.id === id);
    if (slot === "template") return templateStore.catalog.some((t) => t.id === id);
    return moduleStore.catalog.some((m) => m.id === id);
  }

  /** Liveness check for a recorded module id. Resolves `true` if the row is
   *  still fetchable, `false` if `get` throws — a 404/ApiError means the row
   *  is dangling, and a network error is treated the same way: recreating is
   *  the safe, idempotent-at-the-set-level choice (caller recreates on false). */
  async function moduleStillExists(id: string): Promise<boolean> {
    try {
      await api.modules.get(id);
      return true;
    } catch {
      return false;
    }
  }

  /** Liveness check for a recorded template id (see `moduleStillExists`). */
  async function templateStillExists(id: string): Promise<boolean> {
    try {
      await api.templates.get(id);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reuse-or-create a single module slot. Idempotent:
   *   - if the store has a recorded id AND `api.modules.get(id)` resolves,
   *     reuse it (no second create);
   *   - otherwise (no id, or the recorded id 404s / errors) create fresh,
   *     record it, and return the new id.
   *
   * `ctx` is required for the `pairing` slot (the two wildcard ids) and
   * ignored for the others.
   */
  async function ensureSlot(slot: StarterModuleSlot, ctx?: PairingBuildContext): Promise<string> {
    const existing = starter.idFor(slot);
    if (existing && (await moduleStillExists(existing))) {
      return existing;
    }

    const descriptor = STARTER_MODULE_DESCRIPTORS[slot];
    const payload = descriptor.needsContext
      ? descriptor.buildPayload(requirePairingContext(slot, ctx))
      : descriptor.buildPayload();

    const row = await api.modules.create({
      type: descriptor.kind,
      name: descriptor.name,
      payload,
    });
    starter.record(slot, row.id);
    return row.id;
  }

  /** Narrow + validate the pairing context (both wildcard ids present). */
  function requirePairingContext(
    slot: StarterModuleSlot,
    ctx?: PairingBuildContext,
  ): PairingBuildContext {
    if (!ctx || !ctx.subjectId || !ctx.moodId) {
      throw new Error(`Starter slot "${slot}" requires subject + mood ids`);
    }
    return ctx;
  }

  /** Ensure the constraint's prerequisites (subject, mood) then the
   *  constraint itself, returning its id. Used by both the per-page button
   *  and the failsafe bundle build. */
  async function ensurePairing(): Promise<string> {
    const subjectId = await ensureSlot("subject");
    const moodId = await ensureSlot("mood");
    return ensureSlot("pairing", { subjectId, moodId });
  }

  /**
   * Per-page entry point for a module slot's button. Ensures the slot (plus
   * dependencies for `pairing`), refreshes catalogs, toasts success with an
   * "Open" action, and returns the created/reused id.
   *
   * The Constraint doc page maps to creating `mood` THEN `pairing` (and
   * `pairing` self-ensures `subject` first), so the whole constraint-relevant
   * trio lands from a single click.
   */
  async function createStarterModule(slot: StarterModuleSlot): Promise<string> {
    let id: string;
    if (slot === "pairing") {
      id = await ensurePairing();
    } else {
      id = await ensureSlot(slot);
    }
    await refreshCatalogs();
    const descriptor = STARTER_MODULE_DESCRIPTORS[slot];
    toast.push({
      severity: "success",
      summary: `Created “${descriptor.name}”`,
      detail: "Added to your library.",
      action: {
        label: "Open",
        run: () => { void router.push({ name: SLOT_EDIT_ROUTE[slot], params: { id } }); },
      },
    });
    return id;
  }

  /** Idempotent create of the standalone starter template. Reuses the
   *  recorded id if it still resolves; otherwise creates + records. */
  async function ensureStarterTemplate(): Promise<string> {
    const existing = starter.idFor("template");
    if (existing && (await templateStillExists(existing))) {
      return existing;
    }
    const row = await api.templates.create(buildTemplateInput());
    starter.record("template", row.id);
    return row.id;
  }

  /**
   * Per-page entry point for the Templates doc page button. Mirrors
   * `createStarterModule`'s side-effects for the standalone template: ensure
   * the template exists (idempotent), refresh catalogs, and toast success with
   * an "Open" action routing to the template editor. Returns the template id.
   */
  async function createStarterTemplate(): Promise<string> {
    const id = await ensureStarterTemplate();
    await refreshCatalogs();
    toast.push({
      severity: "success",
      summary: `Created “${STARTER_TEMPLATE_NAME}”`,
      detail: "Added to your library.",
      action: {
        label: "Open",
        run: () => { void router.push({ name: "templates-edit", params: { id } }); },
      },
    });
    return id;
  }

  /**
   * FAILSAFE — guarantee the entire starter set exists, then assemble it.
   *
   * 1. `ensureSlot` each of the six module slots in dependency order
   *    (creating any missing / dangling rows; the constraint gets the
   *    freshly-ensured subject + mood ids).
   * 2. `api.modules.get` each created id for the canonical fresh
   *    `payload` + `payload_hash`.
   * 3. Build library-linked children matching `toChildSnapshot`'s shape
   *    (`src/components/context/bundles/save.ts`) and `api.bundles.create`.
   * 4. Ensure the standalone template too.
   * 5. Refresh catalogs + toast with a "View bundle" navigate action.
   *
   * Works from an empty store (creates all six) or a partial one (fills gaps).
   */
  async function buildStarterBundle(): Promise<string> {
    // 1. Ensure all module slots exist (dependency order). Track the two
    //    wildcard ids so the constraint wires correctly.
    let subjectId = "";
    let moodId = "";
    const slotIds = new Map<StarterModuleSlot, string>();
    for (const slot of STARTER_MODULE_SLOTS) {
      let id: string;
      if (slot === "pairing") {
        id = await ensureSlot("pairing", { subjectId, moodId });
      } else {
        id = await ensureSlot(slot);
        if (slot === "subject") subjectId = id;
        if (slot === "mood") moodId = id;
      }
      slotIds.set(slot, id);
    }

    // 2. Fetch fresh rows for canonical payload + payload_hash, then
    // 3. build children in RUNTIME order (STARTER_BUNDLE_ORDER) — NOT the
    //    creation order above. The child array order IS the in-Context
    //    resolution order, and the constraint must sit between its source and
    //    target wildcard (see STARTER_BUNDLE_ORDER for the why).
    const children: Record<string, unknown>[] = [];
    for (const slot of STARTER_BUNDLE_ORDER) {
      const id = slotIds.get(slot);
      if (!id) continue;
      const row: ModuleRow = await api.modules.get(id);
      children.push(toStarterChild(row));
    }

    const bundle = await api.bundles.create({
      name: STARTER_BUNDLE_NAME,
      children,
    });
    starter.record("bundle", bundle.id);

    // 4. The template rounds out the set (standalone — not a bundle child).
    await ensureStarterTemplate();

    // 5. Reflect everything in the UI.
    await refreshCatalogs();
    toast.push({
      severity: "success",
      summary: `Built “${STARTER_BUNDLE_NAME}”`,
      detail: "Six modules bundled and ready to run.",
      action: {
        label: "View bundle",
        run: () => { void router.push({ name: "bundles-edit", params: { id: bundle.id } }); },
      },
    });
    return bundle.id;
  }

  return {
    ensureSlot,
    ensurePairing,
    createStarterModule,
    ensureStarterTemplate,
    createStarterTemplate,
    buildStarterBundle,
    isSlotLive,
  };
}

/**
 * Canonical library-linked bundle child for a freshly-fetched module row.
 * Matches `toChildSnapshot` (`src/components/context/bundles/save.ts`): carries
 * `id` + `payload` + `payload_hash` so the child is library-linked, with empty
 * `instance` / `entries` and `library_name` denormalized onto `meta`.
 */
function toStarterChild(row: ModuleRow): Record<string, unknown> {
  return {
    id: row.id,
    type: row.type,
    enabled: true,
    collapsed: false,
    meta: { name: row.name, library_name: row.name },
    payload: row.payload,
    payload_hash: row.payload_hash,
    instance: {},
    entries: [],
  };
}
