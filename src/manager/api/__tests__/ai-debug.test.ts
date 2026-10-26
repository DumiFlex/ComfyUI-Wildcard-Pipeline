import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function load() {
  vi.resetModules();
  const debug = await import("../ai-debug");
  const { api } = await import("../client");
  return { debug, api };
}

function ndjsonDone(): Response {
  return new Response(JSON.stringify({ type: "done", result: { chat_id: "c1", message: "ok" } }) + "\n",
    { status: 200, headers: { "content-type": "application/x-ndjson" } });
}

describe("AI debug log", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

  it("sends no debug id while the log is off", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ndjsonDone());
    vi.stubGlobal("fetch", fetchMock);
    const { api, debug } = await load();
    await api.ai.chatStream({ message: "hi" }, () => undefined);
    expect(fetchMock.mock.calls[0][1].headers["X-WP-Debug"]).toBeUndefined();
    expect(debug.aiDebugSent.value).toEqual([]);
  });

  it("gives the chat stream and every AI POST an id once it's on, and counts them", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ndjsonDone());
    vi.stubGlobal("fetch", fetchMock);
    const { api, debug } = await load();
    debug.setAiDebug(true);
    expect(localStorage.getItem("wp-ai-debug")).toBe("1");
    await api.ai.chatStream({ message: "hi" }, () => undefined);
    const id = fetchMock.mock.calls[0][1].headers["X-WP-Debug"] as string;
    expect(id).toMatch(/^d[0-9a-f]{16}$/);
    expect(debug.aiDebugSent.value).toEqual([id]);
    expect(debug.aiDebugUnseen.value).toBe(1);
  });

  it("only AI POSTs that reach the model are recorded", async () => {
    const { debug } = await load();
    debug.setAiDebug(true);
    expect(debug.startDebug("/wp/api/ai/config", "GET")).toBeNull();
    expect(debug.startDebug("/wp/api/ai/index/rebuild", "POST")).toBeNull();
    expect(debug.startDebug("/wp/api/modules", "POST")).toBeNull();
    expect(debug.startDebug("/wp/api/ai/models", "POST")).toBeNull();
    expect(debug.startDebug("/wp/api/ai/thinking", "POST")).toBeNull();
    expect(debug.startDebug("/wp/api/ai/pack/plan", "POST")).not.toBeNull();
  });

  it("reads the switch back from this browser", async () => {
    localStorage.setItem("wp-ai-debug", "1");
    const { debug } = await load();
    expect(debug.aiDebugEnabled.value).toBe(true);
  });

  it("fetches the Markdown copy and says when a record is gone", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("# AI debug: Chat", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const { debug } = await load();
    expect(await debug.fetchAiDebug("d1", "md")).toBe("# AI debug: Chat");
    expect(fetchMock.mock.calls[0][0]).toBe("/wp/api/ai/debug/d1?format=md");
    await expect(debug.fetchAiDebug("d2", "json")).rejects.toThrow("isn't in the debug log");
  });
});
