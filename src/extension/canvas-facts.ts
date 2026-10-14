/**
 * Canvas side of the canvas-facts channel: answers the manager's "ask"
 * with this tab's run-time variables (`collectCanvasVars`).
 */
import { CANVAS_FACTS_CHANNEL, type CanvasFactsMessage } from "./canvas-facts-channel";
import { collectCanvasVars, type LiteGraphLike } from "./graph";

export function answerCanvasFacts(getGraph: () => LiteGraphLike | null | undefined): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(CANVAS_FACTS_CHANNEL);
  channel.onmessage = (event: MessageEvent<CanvasFactsMessage>) => {
    const msg = event.data;
    if (!msg || msg.type !== "ask" || typeof msg.id !== "string") return;
    const graph = getGraph();
    if (!graph) return;
    let vars;
    try {
      vars = collectCanvasVars(graph);
    } catch {
      return; // a graph mid-load answers next time
    }
    channel.postMessage({ type: "facts", id: msg.id, vars } satisfies CanvasFactsMessage);
  };
  return () => channel.close();
}
