/**
 * What every AI request carries besides its own body:
 *
 * - `vocab`: which lookup sources the user switched on (Settings ›
 *   Autocomplete: tags, LoRAs, embeddings). The server also needs the data
 *   (a downloaded tag list, files in the folders) before it uses one.
 * - `canvas`: the run-time variables an open ComfyUI canvas tab sets
 *   (WP Context Injector rows, the Loop's iteration variables, WP Model
 *   Info), asked over the same-origin canvas-facts channel. The manager is
 *   its own tab with no graph, so with no canvas open there are none.
 */
import { CANVAS_FACTS_CHANNEL, type CanvasFactsMessage } from "../../extension/canvas-facts-channel";
import type { AiCanvasVar } from "../api/types";
import { completionSourceEnabled } from "./tagSetting";

/** How long a request waits for canvas tabs to answer. */
const WAIT_MS = 250;
/** How long an answer is reused before asking again. */
const FRESH_MS = 4000;

let last: { at: number; vars: AiCanvasVar[] | undefined } | null = null;
let asking: Promise<AiCanvasVar[] | undefined> | null = null;

/** Ask every open canvas tab; merged answers, or undefined when none
 *  answered in time (no canvas open, or no BroadcastChannel). */
export function askCanvas(wait = WAIT_MS): Promise<AiCanvasVar[] | undefined> {
  if (typeof BroadcastChannel === "undefined") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const channel = new BroadcastChannel(CANVAS_FACTS_CHANNEL);
    const id = Math.random().toString(36).slice(2);
    let got: AiCanvasVar[] | undefined;
    channel.onmessage = (event: MessageEvent<CanvasFactsMessage>) => {
      const msg = event.data;
      if (!msg || msg.type !== "facts" || msg.id !== id || !Array.isArray(msg.vars)) return;
      got = got ?? [];
      for (const v of msg.vars) if (!got.some((x) => x.name === v.name)) got.push(v);
    };
    channel.postMessage({ type: "ask", id } satisfies CanvasFactsMessage);
    setTimeout(() => {
      channel.close();
      resolve(got);
    }, wait);
  });
}

async function canvasVars(): Promise<AiCanvasVar[] | undefined> {
  if (last && Date.now() - last.at < FRESH_MS) return last.vars;
  asking ??= askCanvas().then((vars) => {
    last = { at: Date.now(), vars };
    asking = null;
    return vars;
  });
  return asking;
}

export interface AiRequestContext {
  vocab: { tags: boolean; loras: boolean; embeddings: boolean };
  canvas?: AiCanvasVar[];
}

/** The extras for one AI request. `canvas` is left out when no canvas tab
 *  answered, so the server keeps what a plan already had. */
export async function aiRequestContext(): Promise<AiRequestContext> {
  const vocab = {
    tags: completionSourceEnabled("tag"),
    loras: completionSourceEnabled("lora"),
    embeddings: completionSourceEnabled("embedding"),
  };
  const canvas = await canvasVars();
  return canvas ? { vocab, canvas } : { vocab };
}

/** Test seam. */
export function _resetAiContextForTests(): void {
  last = null;
  asking = null;
}
