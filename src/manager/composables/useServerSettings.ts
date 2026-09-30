/**
 * Server-side preferences (`/wp/api/settings`): the ones the engine or the
 * server acts on, so they are shared by every browser and reach real runs.
 *
 * One module-level copy so the Canvas and Library sections, which both edit
 * it, never show different values.
 */
import { ref } from "vue";
import { api } from "../api/client";
import type { ServerSettings, ServerSettingsPatch } from "../api/types";

/** The manager kept the ref recursion limit in localStorage, where no run
 *  ever read it. Carried over once, if it was changed from the default. */
const LEGACY_REF_DEPTH_KEY = "wp-wildcard-max-ref-depth";

const settings = ref<ServerSettings | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
let inflight: Promise<void> | null = null;

async function migrateLegacyRefDepth(current: ServerSettings): Promise<ServerSettings> {
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(LEGACY_REF_DEPTH_KEY);
  } catch {
    return current;
  }
  if (legacy === null) return current;
  const n = parseInt(legacy, 10);
  try {
    localStorage.removeItem(LEGACY_REF_DEPTH_KEY);
  } catch {
    /* ignore */
  }
  if (!Number.isFinite(n) || n === current.max_ref_depth || current.max_ref_depth !== 8) return current;
  return api.serverSettings.update({ max_ref_depth: n });
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    settings.value = await migrateLegacyRefDepth(await api.serverSettings.get());
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not load settings";
  } finally {
    loading.value = false;
  }
}

async function update(patch: ServerSettingsPatch): Promise<void> {
  try {
    settings.value = await api.serverSettings.update(patch);
    error.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not save settings";
    throw err;
  }
}

export function useServerSettings() {
  if (!settings.value && !inflight) {
    inflight = load().finally(() => { inflight = null; });
  }
  return { settings, loading, error, reload: load, update };
}

/** Tests only. */
export function _resetServerSettingsForTesting(): void {
  settings.value = null;
  loading.value = false;
  error.value = null;
  inflight = null;
}
