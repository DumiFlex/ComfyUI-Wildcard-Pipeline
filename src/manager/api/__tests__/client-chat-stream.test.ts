import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiChatStreamEvent } from "../types";

async function loadClient() {
  vi.resetModules();
  return (await import("../client")).api;
}

/** A body that arrives in the given pieces (split mid-line on purpose). */
function streamed(pieces: string[], status = 200): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(ctl) {
      for (const p of pieces) ctl.enqueue(enc.encode(p));
      ctl.close();
    },
  });
  return new Response(body, { status, headers: { "content-type": "application/x-ndjson" } });
}

describe("api.ai.chatStream", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("passes events on and resolves with the finished answer", async () => {
    const lines = [
      { type: "step", n: 1 }, { type: "text", v: "Hel" }, { type: "text", v: "Hello" },
      { type: "done", result: { chat_id: "c1", message: "Hello" } },
    ].map((x) => JSON.stringify(x) + "\n").join("");
    const fetchMock = vi.fn().mockResolvedValue(streamed([lines.slice(0, 20), lines.slice(20, 33), lines.slice(33)]));
    vi.stubGlobal("fetch", fetchMock);
    const api = await loadClient();
    const seen: AiChatStreamEvent[] = [];
    const out = await api.ai.chatStream({ message: "hi" }, (e) => seen.push(e));
    expect(out).toEqual({ chat_id: "c1", message: "Hello" });
    expect(seen.map((e) => e.type)).toEqual(["step", "text", "text"]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ message: "hi", stream: true });
  });

  it("throws the error event, and a stream cut short", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamed([
      '{"type":"error","status":409,"message":"undo first"}\n'])));
    let api = await loadClient();
    await expect(api.ai.chatStream({ message: "hi" }, () => undefined)).rejects.toMatchObject({
      status: 409, message: "undo first" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamed(['{"type":"step"}\n'])));
    api = await loadClient();
    await expect(api.ai.chatStream({ message: "hi" }, () => undefined)).rejects.toMatchObject({
      status: 502 });
  });

  it("reads a plain JSON error from before the stream started", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "the assistant is off" }), { status: 403 })));
    const api = await loadClient();
    await expect(api.ai.chatStream({ message: "hi" }, () => undefined)).rejects.toMatchObject({
      status: 403, message: "the assistant is off" });
  });
});
