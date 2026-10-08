/**
 * The AI assistant's saved settings, one module-level copy so the Settings
 * section and every editor's "Draft with AI" button agree on whether the
 * assistant is on, without each fetching it.
 */
import { computed, ref } from "vue";
import { api } from "../api/client";
import type { AiConfig, AiConfigPatch } from "../api/types";

const config = ref<AiConfig | null>(null);
const error = ref<string | null>(null);
let inflight: Promise<void> | null = null;

async function load(): Promise<void> {
  try {
    config.value = await api.ai.config();
    error.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not load AI settings";
  }
}

function ensureLoaded(): Promise<void> {
  if (config.value) return Promise.resolve();
  inflight ??= load().finally(() => { inflight = null; });
  return inflight;
}

async function save(patch: AiConfigPatch): Promise<void> {
  try {
    config.value = await api.ai.saveConfig(patch);
    error.value = null;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Could not save AI settings";
    throw err;
  }
}

/** Ready to draft: turned on and a model chosen. */
const ready = computed(() => !!config.value?.enabled && !!config.value.model);

export function useAiConfig() {
  void ensureLoaded();
  return { config, error, ready, save, reload: load };
}

/** Test seam: forget the cached copy. */
export function _resetAiConfigForTests(): void {
  config.value = null;
  error.value = null;
  inflight = null;
}
