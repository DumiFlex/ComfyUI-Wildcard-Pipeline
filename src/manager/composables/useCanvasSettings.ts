/**
 * Read and write the canvas nodes' settings from the manager.
 *
 * They live in ComfyUI's own settings store (`/api/settings`, per ComfyUI
 * user). Writes go two ways at once: to the API, so the value is saved even
 * with no canvas open, and over a same-origin BroadcastChannel, so an open
 * canvas applies it live through its own settings store (which fires the
 * same onChange the settings panel would; see `listenForManagerSettings`).
 * A change made on the canvas (ComfyUI's panel, the playground) comes back
 * over the same channel (`announceCanvasSetting`) and shows here at once; a
 * reload on focus still catches anything said while this page was closed.
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import {
  CANVAS_AUTOCOMPLETE_SETTINGS,
  CANVAS_SETTINGS,
  CANVAS_SETTINGS_CHANNEL,
  type CanvasSettingMessage,
} from "../../extension/settings-catalog";

type Values = Record<string, string | boolean>;

/** Everything the manager reads and writes: Settings › Canvas plus the canvas
 *  column of Settings › Autocomplete. */
const SYNCED = [...CANVAS_SETTINGS, ...CANVAS_AUTOCOMPLETE_SETTINGS];

function defaults(): Values {
  return Object.fromEntries(SYNCED.map((s) => [s.id, s.defaultValue]));
}

/** ComfyUI answers `/api/settings` with every stored value, ours included. */
export async function fetchCanvasSettings(): Promise<Values> {
  const out = defaults();
  const resp = await fetch("/api/settings");
  if (!resp.ok) throw new Error(`settings request failed (${resp.status})`);
  const all = await resp.json() as Record<string, unknown>;
  for (const s of SYNCED) {
    const v = all[s.id];
    if (s.type === "boolean" ? typeof v === "boolean" : typeof v === "string") out[s.id] = v as string | boolean;
  }
  return out;
}

export async function writeCanvasSetting(id: string, value: string | boolean): Promise<void> {
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(CANVAS_SETTINGS_CHANNEL);
    const msg: CanvasSettingMessage = { id, value, source: "manager" };
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
  let channel: BroadcastChannel | null = null;
  onMounted(() => {
    void reload();
    window.addEventListener("focus", onFocus);
    if (typeof BroadcastChannel === "undefined") return;
    channel = new BroadcastChannel(CANVAS_SETTINGS_CHANNEL);
    channel.onmessage = (event: MessageEvent<CanvasSettingMessage>) => {
      const msg = event.data;
      if (msg?.source !== "canvas" || !(msg.id in values.value)) return;
      if (typeof msg.value !== "string" && typeof msg.value !== "boolean") return;
      values.value = { ...values.value, [msg.id]: msg.value };
    };
  });
  onBeforeUnmount(() => {
    window.removeEventListener("focus", onFocus);
    channel?.close();
    channel = null;
  });

  return { values, loaded, error, reload, set };
}
