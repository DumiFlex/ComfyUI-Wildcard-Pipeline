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

export const CANVAS_SETTING_ID = "wildcardPipeline.behavior.tagAutocomplete";

function canvasSetting(): boolean | null {
  const app = (globalThis as { app?: ComfySettingHost }).app;
  const get = app?.extensionManager?.setting?.get;
  if (typeof get !== "function") return null;   // not on the canvas
  try {
    return get(CANVAS_SETTING_ID) === true;
  } catch {
    return null;
  }
}

function spaSetting(): boolean {
  // Read the persisted value directly rather than the store. The store is the
  // writer and this is a reader on a hot path (every keystroke probe), and it
  // keeps this module free of a Pinia dependency it cannot satisfy on canvas.
  try {
    return localStorage.getItem("wp-tag-autocomplete") === "1";
  } catch {
    return false;
  }
}

/**
 * True when the host this editor is running in has the feature switched on.
 *
 * Availability of a tag LIST is a separate question, answered by
 * `loadTagAvailability()` — a setting can be on with no list installed, and
 * the UI has to be able to say so.
 */
export function tagAutocompleteEnabled(): boolean {
  const canvas = canvasSetting();
  return canvas === null ? spaSetting() : canvas;
}
