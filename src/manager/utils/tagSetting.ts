/**
 * "Is booru tag autocomplete on?", answered in both places the editors run.
 *
 * `RichTextInput` mounts on two very different hosts:
 *
 *   - the SPA manager, which has Pinia and the `uiStore` setting;
 *   - the ComfyUI canvas widgets, which have NEITHER — no Pinia is installed
 *     in those mounts at all.
 *
 * The first version read `useUiStore()` behind a try/catch so a Pinia-less
 * mount degraded to "off". That fixed 113 tests and silently disabled the whole
 * feature on the canvas, which is where half the editing happens. The fallback
 * was hiding a missing implementation rather than handling an edge case.
 *
 * So each host answers for itself, and the canvas gets its own switch in
 * ComfyUI's settings panel — which is what a ComfyUI user will look for anyway.
 * The two are deliberately independent: someone may want suggestions in the
 * full manager and not while squinting at a node on a canvas.
 */

/** ComfyUI's settings store, present only when running inside the canvas. */
interface ComfySettingHost {
  extensionManager?: { setting?: { get?: (id: string) => unknown } };
}

/**
 * The completion sources a bare word can match.
 *
 * Each is independently switchable because they answer different questions.
 * Someone writing danbooru prompts wants tags and may have no LoRAs at all;
 * someone with 200 LoRAs may find the tag list noise. Bundling them behind one
 * switch would force that choice.
 */
export type CompletionSource = "tag" | "lora" | "embedding";

export const CANVAS_SETTING_ID = "wildcardPipeline.behavior.tagAutocomplete";

/** Canvas setting id and SPA storage key per source. Both spellings are load
 *  bearing — the canvas ids are asserted by the settings parity test, and the
 *  storage keys are persisted user state that must not be renamed casually. */
const KEYS: Record<CompletionSource, { canvas: string; storage: string }> = {
  tag: { canvas: CANVAS_SETTING_ID, storage: "wp-tag-autocomplete" },
  lora: {
    canvas: "wildcardPipeline.behavior.loraAutocomplete",
    storage: "wp-lora-autocomplete",
  },
  embedding: {
    canvas: "wildcardPipeline.behavior.embeddingAutocomplete",
    storage: "wp-embedding-autocomplete",
  },
};

function canvasSetting(id: string): boolean | null {
  const app = (globalThis as { app?: ComfySettingHost }).app;
  const get = app?.extensionManager?.setting?.get;
  if (typeof get !== "function") return null;   // not on the canvas
  try {
    return get(id) === true;
  } catch {
    return null;
  }
}

function spaSetting(storageKey: string): boolean {
  // Read the persisted value directly rather than the store. The store is the
  // writer and this is a reader on a hot path (every keystroke probe), and it
  // keeps this module free of a Pinia dependency it cannot satisfy on canvas.
  try {
    return localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

/** True when the host this editor runs in has `source` switched on. */
export function completionSourceEnabled(source: CompletionSource): boolean {
  const keys = KEYS[source];
  const canvas = canvasSetting(keys.canvas);
  return canvas === null ? spaSetting(keys.storage) : canvas;
}

/** Every source currently switched on, in the order they are shown. Tags lead
 *  because that is what a prompt is mostly made of. */
export function enabledCompletionSources(): CompletionSource[] {
  return (["tag", "lora", "embedding"] as const).filter(completionSourceEnabled);
}

/**
 * True when the host this editor is running in has tag suggestions on.
 *
 * Availability of a tag LIST is a separate question, answered by
 * `loadTagAvailability()` — a setting can be on with no list installed, and
 * the UI has to be able to say so. The model sources have no equivalent: they
 * read whatever ComfyUI already enumerated, so "on" and "has files" collapse
 * into one count.
 */
export function tagAutocompleteEnabled(): boolean {
  return completionSourceEnabled("tag");
}
