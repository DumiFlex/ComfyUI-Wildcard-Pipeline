/**
 * Canvas side of the canvas-facts channel: answers the manager's "ask"
 * with this tab's run-time variables (`collectCanvasVars`) and the library
 * items it uses (`collectCanvasLibraryUse`).
 */
import { CANVAS_FACTS_CHANNEL, type CanvasFactsMessage } from "./canvas-facts-channel";
import { collectCanvasLibraryUse, collectCanvasVars, type LiteGraphLike } from "./graph";

export function answerCanvasFacts(getGraph: () => LiteGraphLike | null | undefined): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(CANVAS_FACTS_CHANNEL);
  channel.onmessage = (event: MessageEvent<CanvasFactsMessage>) => {
    const msg = event.data;
    if (!msg || msg.type !== "ask" || typeof msg.id !== "string") return;
    const graph = getGraph();
    if (!graph) return;
    let vars, use;
    try {
      vars = collectCanvasVars(graph);
      use = collectCanvasLibraryUse(graph);
    } catch {
      return; // a graph mid-load answers next time
    }
    channel.postMessage({ type: "facts", id: msg.id, vars, ...use } satisfies CanvasFactsMessage);
  };
  return () => channel.close();
}
