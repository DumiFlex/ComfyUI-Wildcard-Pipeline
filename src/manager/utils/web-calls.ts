import type { AiPendingCall } from "../api/types";

/** A paused call that runs on the server once the user allows it. */
export type WebCall = Extract<AiPendingCall, { tool: "web_search" | "read_result" | "danbooru" }>;

export function isWebCall(call: AiPendingCall): call is WebCall {
  return call.tool === "web_search" || call.tool === "read_result" || call.tool === "danbooru";
}

/** What the Allow card says for each web call: what leaves the machine. */
export function webCallCard(call: WebCall): { title: string; summary: string; text: string; icon: string } {
  switch (call.tool) {
    case "read_result":
      return {
        title: "Read this page?",
        summary: "ComfyUI fetches this result page and keeps its text, cut to a few thousand characters.",
        text: call.args.url,
        icon: "pi-file",
      };
    case "danbooru":
      return {
        title: "Look this tag up on Danbooru?",
        summary: "Asks danbooru.donmai.us for this tag's wiki, aliases and related tags. Never posts or images.",
        text: call.args.tag,
        icon: "pi-tag",
      };
    default:
      return {
        title: "Search the web?",
        summary: "Only this text goes to your search engine. Results come back as short snippets.",
        text: call.args.query,
        icon: "pi-globe",
      };
  }
}
