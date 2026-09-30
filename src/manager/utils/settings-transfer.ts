/**
 * Export / import every Wildcard Pipeline preference as one JSON file, to
 * move a setup to another machine or keep it safe.
 *
 * Three stores, one file:
 *   - `browser`: this device's `wp-*` / `wp.*` localStorage keys (manager
 *     look, editor and autocomplete preferences), minus caches and history
 *     that only mean something on the machine that wrote them;
 *   - `canvas`: our `wildcardPipeline.*` values in ComfyUI's settings;
 *   - `server`: the server-side preferences (ref recursion limit, backups).
 *
 * Import applies whatever sections are present and ignores keys it does not
 * own, so a file from a newer version imports what this one understands.
 */
import { api } from "../api/client";
import type { ServerSettings } from "../api/types";
import { writeCanvasSetting } from "../composables/useCanvasSettings";

export const SETTINGS_FILE_KIND = "wildcard-pipeline-settings";
export const SETTINGS_FILE_VERSION = 1;

/** Per-machine state, not preferences: carrying it over would be wrong or
 *  meaningless on another machine. */
const NOT_EXPORTED = new Set([
  "wp.releaseCheck",
  "wp-recent-items",
  "wp-last-route",
  "wp-last-seen-version",
  "wp-onboarding-dismissed",
]);

export interface SettingsFile {
  kind: typeof SETTINGS_FILE_KIND;
  version: number;
  exported_at: string;
  app_version: string;
  browser?: Record<string, string>;
  canvas?: Record<string, unknown>;
  server?: Partial<ServerSettings>;
}

function isOurKey(key: string): boolean {
  return key.startsWith("wp-") || key.startsWith("wp.");
}

export function collectBrowserSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !isOurKey(key) || NOT_EXPORTED.has(key)) continue;
      const v = localStorage.getItem(key);
      if (v !== null) out[key] = v;
    }
  } catch {
    /* localStorage unavailable */
  }
  return out;
}

async function collectCanvasSettings(): Promise<Record<string, unknown>> {
  const resp = await fetch("/api/settings");
  if (!resp.ok) return {};
  const all = await resp.json() as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(all).filter(([k]) => k.startsWith("wildcardPipeline.") && !k.includes("._")),
  );
}

export async function buildSettingsFile(appVersion: string): Promise<SettingsFile> {
  const [canvas, server] = await Promise.all([
    collectCanvasSettings().catch(() => ({})),
    api.serverSettings.get().catch(() => undefined),
  ]);
  return {
    kind: SETTINGS_FILE_KIND,
    version: SETTINGS_FILE_VERSION,
    exported_at: new Date().toISOString(),
    app_version: appVersion,
    browser: collectBrowserSettings(),
    canvas,
    server,
  };
}

export class SettingsFileError extends Error {}

/** Validate the envelope; section contents are filtered on apply. */
export function parseSettingsFile(text: string): SettingsFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SettingsFileError("That file is not JSON.");
  }
  const o = raw as Partial<SettingsFile> | null;
  if (!o || typeof o !== "object" || o.kind !== SETTINGS_FILE_KIND) {
    throw new SettingsFileError("That is not a Wildcard Pipeline settings file.");
  }
  if (typeof o.version !== "number" || o.version > SETTINGS_FILE_VERSION) {
    throw new SettingsFileError("That settings file was made by a newer version. Update the extension first.");
  }
  return o as SettingsFile;
}

export interface ImportSummary { browser: number; canvas: number; server: boolean }

export async function applySettingsFile(file: SettingsFile): Promise<ImportSummary> {
  const summary: ImportSummary = { browser: 0, canvas: 0, server: false };
  for (const [k, v] of Object.entries(file.browser ?? {})) {
    if (!isOurKey(k) || NOT_EXPORTED.has(k) || typeof v !== "string") continue;
    try {
      localStorage.setItem(k, v);
      summary.browser += 1;
    } catch {
      /* quota / unavailable */
    }
  }
  for (const [k, v] of Object.entries(file.canvas ?? {})) {
    if (!k.startsWith("wildcardPipeline.") || k.includes("._")) continue;
    if (typeof v !== "string" && typeof v !== "boolean" && typeof v !== "number") continue;
    try {
      await writeCanvasSetting(k, typeof v === "number" ? String(v) : v);
      summary.canvas += 1;
    } catch {
      /* ComfyUI rejected it; keep going */
    }
  }
  if (file.server && typeof file.server === "object") {
    try {
      await api.serverSettings.update(file.server);
      summary.server = true;
    } catch {
      /* server unreachable */
    }
  }
  return summary;
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
