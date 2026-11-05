/**
 * The AI requests in flight, so a "working" line can say what the model is
 * doing. `request()` gives every AI POST an `X-WP-Progress` id; the server
 * records what it sees under that id (`wp_api/_ai_progress.py`) and
 * `GET /wp/api/ai/progress/{id}` reads it back.
 */
import { shallowRef } from "vue";

export type AiPhase = "starting" | "reading" | "thinking" | "writing" | "done";

export interface AiProgress {
  phase: AiPhase;
  /** About how many tokens the answer has so far. */
  tokens: number;
  /** Model requests this call has sent (a repair or a second step adds one). */
  calls: number;
  seconds: number;
  done: boolean;
}

export interface ActiveAiRequest {
  id: string;
  path: string;
}

export const activeAiRequests = shallowRef<ActiveAiRequest[]>([]);

/** AI routes that wait on the model; the rest answer at once. */
export function watchesProgress(path: string, method: string | undefined): boolean {
  return method === "POST" && path.startsWith("/wp/api/ai/") && !path.startsWith("/wp/api/ai/index");
}

function newId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function startAiRequest(path: string): string {
  const id = newId();
  activeAiRequests.value = [...activeAiRequests.value, { id, path }];
  return id;
}

export function endAiRequest(id: string): void {
  activeAiRequests.value = activeAiRequests.value.filter((r) => r.id !== id);
}

export async function fetchAiProgress(id: string): Promise<AiProgress | null> {
  try {
    const resp = await fetch(`/wp/api/ai/progress/${encodeURIComponent(id)}`);
    if (!resp.ok) return null;
    return (await resp.json()) as AiProgress;
  } catch {
    return null;
  }
}
