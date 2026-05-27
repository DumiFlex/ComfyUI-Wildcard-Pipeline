/**
 * Starter-set tracker store.
 *
 * Records the library row id created for each starter slot (the six module
 * slots + the assembled `bundle`) so the doc-page "Create starter" buttons can
 * (a) show a "✓ Created — Open" state and (b) reuse an already-created module
 * instead of spawning duplicates. Persisted to localStorage so the set
 * survives page reloads / tab revisits.
 *
 * Modelled on `recentStore.ts`: a single reactive ref, an explicit `persist()`
 * on every write, and a typed guard around the parsed localStorage blob so a
 * corrupt / hand-edited entry degrades to "empty" rather than throwing.
 *
 * NOTE: the recorded id is a liveness *hint*, not a guarantee — the user may
 * have deleted the module in the library since. The composable treats a
 * recorded id as dangling if `api.modules.get(id)` 404s and recreates.
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { STARTER_MODULE_SLOTS, type StarterSlot } from "../docs/starter-recipe";

/** Slots we persist an id for: every starter slot plus the assembled bundle. */
export type StarterRecordKey = StarterSlot | "bundle";

type StarterMap = Partial<Record<StarterRecordKey, string>>;

const STORAGE_KEY = "wp-starter-set-v1";

/** All valid keys (used to filter the parsed blob to known string-id pairs). */
const VALID_KEYS: readonly StarterRecordKey[] = [
  ...STARTER_MODULE_SLOTS,
  "template",
  "bundle",
];

function isStarterMap(v: unknown): v is StarterMap {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  // Every present value must be a string; unknown keys are ignored on read.
  return Object.entries(o).every(
    ([k, val]) => !VALID_KEYS.includes(k as StarterRecordKey) || typeof val === "string",
  );
}

function readStored(): StarterMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isStarterMap(parsed)) return {};
    const out: StarterMap = {};
    for (const key of VALID_KEYS) {
      const val = (parsed as Record<string, unknown>)[key];
      if (typeof val === "string") out[key] = val;
    }
    return out;
  } catch {
    return {};
  }
}

export const useStarterStore = defineStore("starter", () => {
  const ids = ref<StarterMap>(readStored());

  function persist(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.value)); }
    catch { /* localStorage unavailable */ }
  }

  /** Created library id recorded for `slot`, or undefined if none yet. */
  function idFor(slot: StarterRecordKey): string | undefined {
    return ids.value[slot];
  }

  /** Whether `slot` has a recorded id. */
  function has(slot: StarterRecordKey): boolean {
    return typeof ids.value[slot] === "string";
  }

  /** Record (or overwrite) the created id for `slot`. */
  function record(slot: StarterRecordKey, id: string): void {
    ids.value = { ...ids.value, [slot]: id };
    persist();
  }

  /** Forget a single slot's id, or the whole set when `slot` is omitted. */
  function clear(slot?: StarterRecordKey): void {
    if (slot === undefined) {
      ids.value = {};
    } else {
      const next = { ...ids.value };
      delete next[slot];
      ids.value = next;
    }
    persist();
  }

  /** True once all six module slots have a recorded id (template/bundle
   *  excluded — they're not prerequisites for the per-slot module set). */
  const moduleSlotsComplete = computed<boolean>(() =>
    STARTER_MODULE_SLOTS.every((slot) => typeof ids.value[slot] === "string"),
  );

  return { ids, idFor, has, record, clear, moduleSlotsComplete };
});
