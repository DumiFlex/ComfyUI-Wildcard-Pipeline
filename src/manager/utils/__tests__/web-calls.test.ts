import { describe, expect, it } from "vitest";
import { isWebCall, webCallCard } from "../web-calls";
import type { AiPendingCall } from "../../api/types";

describe("web call cards", () => {
  it("says what leaves the machine for each web call", () => {
    const calls: AiPendingCall[] = [
      { id: "1", tool: "web_search", label: "", args: { query: "bustle" } },
      { id: "2", tool: "read_result", label: "", args: { url: "https://e.org/b" } },
      { id: "3", tool: "danbooru", label: "", args: { tag: "twintails" } },
      { id: "4", tool: "select_rows", label: "", args: { ids: [] } },
    ];
    const web = calls.filter(isWebCall);
    expect(web.map((c) => c.id)).toEqual(["1", "2", "3"]);
    expect(web.map((c) => [webCallCard(c).title, webCallCard(c).text])).toEqual([
      ["Search the web?", "bustle"],
      ["Read this page?", "https://e.org/b"],
      ["Look this tag up on Danbooru?", "twintails"],
    ]);
    expect(webCallCard(web[2]!).summary).toContain("Never posts or images");
  });
});
