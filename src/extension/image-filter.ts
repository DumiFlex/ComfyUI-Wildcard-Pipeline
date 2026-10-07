/**
 * WP Image Filter — the canvas side of the pause-and-pick handshake.
 *
 * The node (`wp_nodes/image_filter_node.py`) sends `wp-image-filter` over
 * ComfyUI's websocket when it starts waiting and `wp-image-filter-done` when
 * the wait ends for any reason. This module keeps the queue of waiting
 * requests, mounts the picker modal the first time one arrives (the modal is
 * its own lazy chunk), and posts the answer to `/wp/api/image-filter/answer`.
 *
 * Lives in the boot chunk because the listener has to be in place before the
 * first run; it is tiny and imports no SFC.
 */
import { ref, shallowRef } from "vue";
import { parsePickRequest, type PickAnswer, type PickRequest } from "../components/image-filter/types";
import { shouldPlayImageFilterSound } from "./settings";

export interface WaitingRequest extends PickRequest {
  /** Browser clock when it arrived; the countdown runs from here so a server
   *  on another machine with a skewed clock can't shorten it. */
  receivedAt: number;
}

/** Requests waiting for an answer, oldest first. The picker shows the first. */
export const waiting = ref<WaitingRequest[]>([]);

/** The most recent request per node id, kept after it is answered so the
 *  node's widget can show thumbnails of what was picked. */
export const lastRequestByNode = shallowRef<Map<string, PickRequest>>(new Map());

export function addRequest(raw: unknown, now: number = Date.now()): WaitingRequest | null {
  const req = parsePickRequest(raw);
  if (!req) return null;
  if (waiting.value.some((r) => r.token === req.token)) return null;
  const entry: WaitingRequest = { ...req, receivedAt: now };
  waiting.value = [...waiting.value, entry];
  const next = new Map(lastRequestByNode.value);
  next.set(req.node_id, req);
  lastRequestByNode.value = next;
  return entry;
}

export function removeRequest(token: string): void {
  waiting.value = waiting.value.filter((r) => r.token !== token);
  drafts.delete(token);
}

// Picks made so far per waiting request, so tucking the picker away (which
// unmounts it) doesn't throw them away.
const drafts = new Map<string, string[]>();

export function draftPicks(token: string): string[] {
  return drafts.get(token) ?? [];
}

export function saveDraftPicks(token: string, keys: Iterable<string>): void {
  drafts.set(token, [...keys]);
}

/** Seconds left on a request's timeout, or null when it has none. */
export function secondsLeft(req: WaitingRequest, now: number = Date.now()): number | null {
  if (!req.timeout) return null;
  return Math.max(0, Math.ceil(req.timeout - (now - req.receivedAt) / 1000));
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<{ ok: boolean; status: number }>;

/**
 * Send the user's answer. The request leaves the queue whether or not the
 * server still wanted it: a 404 means it already ended (timed out, answered
 * from another tab, run cancelled), and the `done` event may be on its way.
 */
export async function submitAnswer(
  token: string,
  answer: PickAnswer,
  doFetch: FetchLike = fetch,
): Promise<boolean> {
  let ok = false;
  try {
    const res = await doFetch("/wp/api/image-filter/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, ...answer }),
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  removeRequest(token);
  return ok;
}

let audio: AudioContext | null = null;

/**
 * A short two-note chime, synthesised so there is no sound file to ship.
 * Plays when a node starts waiting, so a user in another tab hears it. Turned
 * off by the "Image Filter sound" setting. Browsers only allow audio after the
 * page has had a click, which the Run button always provides.
 */
export function playReadyChime(): void {
  if (!shouldPlayImageFilterSound()) return;
  try {
    const Ctx = globalThis.AudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    const ctx = audio;
    void ctx.resume?.().catch(() => undefined);
    const start = ctx.currentTime + 0.02;
    [659.25, 880].forEach((freq, i) => {
      const t = start + i * 0.14;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.5);
    });
  } catch {
    // No audio device or blocked: the picker still opens.
  }
}

interface ApiLike {
  addEventListener: (name: string, fn: (e: Event) => void) => void;
}

let installed = false;

/**
 * Wire the websocket events. `mountPicker` runs once, on the first request,
 * and mounts the (lazy) picker modal that renders `waiting`.
 */
export function installImageFilter(
  api: ApiLike | undefined,
  mountPicker: () => void,
  doFetch: typeof fetch = fetch,
  chime: () => void = playReadyChime,
): void {
  if (installed || !api) return;
  installed = true;
  let mounted = false;
  const ensureMounted = () => {
    if (mounted) return;
    mounted = true;
    mountPicker();
  };
  api.addEventListener("wp-image-filter", (e: Event) => {
    if (!addRequest((e as CustomEvent).detail)) return;
    ensureMounted();
    chime();
  });
  api.addEventListener("wp-image-filter-done", (e: Event) => {
    const token = ((e as CustomEvent).detail as { token?: unknown } | undefined)?.token;
    if (typeof token === "string") removeRequest(token);
  });
  // The whole run was cancelled: nothing is waiting any more.
  api.addEventListener("execution_interrupted", () => {
    waiting.value = [];
    drafts.clear();
  });
  // A page opened (or reloaded) while a node waits: show it again.
  void doFetch("/wp/api/image-filter/pending")
    .then((r) => (r.ok ? r.json() : null))
    .then((body: { pending?: unknown[] } | null) => {
      for (const raw of body?.pending ?? []) {
        if (addRequest(raw)) ensureMounted();
      }
    })
    .catch(() => undefined);
}

/** Test hook: forget the install + queue between tests. */
export function _resetImageFilterForTests(): void {
  installed = false;
  waiting.value = [];
  lastRequestByNode.value = new Map();
  drafts.clear();
  audio = null;
}
