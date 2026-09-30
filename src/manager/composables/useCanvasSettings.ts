/**
 * Read and write the canvas nodes' settings from the manager.
 *
 * They live in ComfyUI's own settings store (`/api/settings`, per ComfyUI
 * user). Writes go two ways at once: to the API, so the value is saved even
 * with no canvas open, and over a same-origin BroadcastChannel, so an open
 * canvas applies it live through its own settings store (which fires the
 * same onChange the settings panel would; see `listenForManagerSettings`).
 * Changes made on the canvas are picked up when this page regains focus.
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import {
  CANVAS_SETTINGS,
  CANVAS_SETTINGS_CHANNEL,
  type CanvasSettingMessage,
} from "../../extension/settings-catalog";

type Values = Record<string, string | boolean>;

function defaults(): Values {
  return Object.fromEntries(CANVAS_SETTINGS.map((s) => [s.id, s.defaultValue]));
}

/** ComfyUI answers `/api/settings` with every stored value, ours included. */
export async function fetchCanvasSettings(): Promise<Values> {
  const out = defaults();
  const resp = await fetch("/api/settings");
  if (!resp.ok) throw new Error(`settings request failed (${resp.status})`);
  const all = await resp.json() as Record<string, unknown>;
  for (const s of CANVAS_SETTINGS) {
    const v = all[s.id];
    if (s.type === "boolean" ? typeof v === "boolean" : typeof v === "string") out[s.id] = v as string | boolean;
  }
  return out;
}

export async function writeCanvasSetting(id: string, value: string | boolean): Promise<void> {
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CANVAS_SETTINGS_CHANNEL);
    const msg: CanvasSettingMessage = { id, value };
    channel.postMessage(msg);
    channel.close();
  }
  const resp = await fetch(`/api/settings/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!resp.ok) throw new Error(`could not save ${id} (${resp.status})`);
}

export function useCanvasSettings() {
  const values = ref<Values>(defaults());
  const loaded = ref(false);
  const error = ref<string | null>(null);

  async function reload(): Promise<void> {
    try {
      values.value = await fetchCanvasSettings();
      error.value = null;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Could not read ComfyUI settings";
    } finally {
      loaded.value = true;
    }
  }

  async function set(id: string, value: string | boolean): Promise<void> {
    const previous = values.value[id];
    values.value = { ...values.value, [id]: value };
    try {
      await writeCanvasSetting(id, value);
      error.value = null;
    } catch (err) {
      values.value = { ...values.value, [id]: previous };
      error.value = err instanceof Error ? err.message : "Could not save";
    }
  }

  const onFocus = () => { void reload(); };
  onMounted(() => {
    void reload();
    window.addEventListener("focus", onFocus);
  });
  onBeforeUnmount(() => window.removeEventListener("focus", onFocus));

  return { values, loaded, error, reload, set };
}
