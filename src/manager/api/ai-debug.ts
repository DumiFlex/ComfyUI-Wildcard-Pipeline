/**
 * The AI debug log, browser side (Settings › AI assistant › Debug log).
 * While it's on, `request()` and the chat stream give every AI POST an
 * `X-WP-Debug` id; the server records each model call that request makes
 * under it (`wp_api/_ai_debug.py`), and the top bar's Debug button lists
 * them with Copy debug. The switch is kept in this browser.
 */
import { ref, shallowRef } from "vue";

const STORAGE_KEY = "wp-ai-debug";

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export const aiDebugEnabled = ref<boolean>(readEnabled());

export function setAiDebug(on: boolean): void {
  aiDebugEnabled.value = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* localStorage unavailable */
  }
}

export interface AiDebugRow {
  id: string;
  route: string;
  label: string;
  started: string;
  seconds: number | null;
  status: number | null;
  error: string | null;
  calls: number;
  failed: number;
  tokens: { prompt?: number; cached?: number; output?: number };
}

/** Ids this page sent since it loaded, newest last: the button's count. */
export const aiDebugSent = shallowRef<string[]>([]);
/** How many of `aiDebugSent` were sent after the list was last opened. */
export const aiDebugUnseen = ref(0);

/** AI POSTs that don't ask the model anything (lists, writes). */
const NO_MODEL = ["/wp/api/ai/index", "/wp/api/ai/models", "/wp/api/ai/thinking", "/wp/api/ai/pack/install"];

/** Every AI POST that waits on the model; the rest record nothing. */
export function debugsPath(path: string, method: string | undefined): boolean {
  return method === "POST" && path.startsWith("/wp/api/ai/") && !NO_MODEL.some((p) => path.startsWith(p));
}

function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return "d" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The id to send with this request, or null while the log is off. */
export function startDebug(path: string, method: string | undefined): string | null {
  if (!aiDebugEnabled.value || !debugsPath(path, method)) return null;
  const id = newId();
  aiDebugSent.value = [...aiDebugSent.value.slice(-49), id];
  aiDebugUnseen.value += 1;
  return id;
}

export async function listAiDebug(): Promise<{ records: AiDebugRow[]; folder: string }> {
  const resp = await fetch("/wp/api/ai/debug");
  if (!resp.ok) throw new Error(`the debug log didn't load (${resp.status})`);
  return (await resp.json()) as { records: AiDebugRow[]; folder: string };
}

/** One record as the Markdown copy (`md`) or the raw JSON text. */
export async function fetchAiDebug(id: string, format: "md" | "json"): Promise<string> {
  const q = format === "md" ? "?format=md" : "";
  const resp = await fetch(`/wp/api/ai/debug/${encodeURIComponent(id)}${q}`);
  if (resp.status === 404) throw new Error("that request isn't in the debug log any more");
  if (!resp.ok) throw new Error(`the debug copy didn't load (${resp.status})`);
  return format === "md" ? await resp.text() : JSON.stringify(await resp.json(), null, 1);
}

export async function clearAiDebug(): Promise<void> {
  await fetch("/wp/api/ai/debug", { method: "DELETE" });
  aiDebugSent.value = [];
  aiDebugUnseen.value = 0;
}
