import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import AiDebugList from "../AiDebugList.vue";
import { aiDebugSent, aiDebugUnseen } from "../../../api/ai-debug";

const ROWS = [
  { id: "d2", route: "/wp/api/ai/chat", label: "Chat message", started: "2026-10-26T08:00:05Z",
    seconds: 4.2, status: 200, error: null, calls: 3, failed: 0,
    tokens: { prompt: 9000, cached: 8000, output: 300 } },
  { id: "d1", route: "/wp/api/ai/wildcard/draft", label: "Draft: wildcard options",
    started: "2026-10-26T08:00:00Z", seconds: 2, status: 502, error: "the server answered 500",
    calls: 1, failed: 1, tokens: {} },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("AiDebugList", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    aiDebugSent.value = [];
    aiDebugUnseen.value = 0;
  });

  it("lists the kept requests, newest first, with their state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ records: ROWS, folder: "/u/ai-debug" })));
    aiDebugSent.value = ["d2"];
    aiDebugUnseen.value = 2;
    const w = mount(AiDebugList);
    await flushPromises();
    const rows = w.findAll('[data-test="ai-debug-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("Chat message");
    expect(rows[0].text()).toContain("3 calls");
    expect(rows[0].text()).toContain("9000 (8000 cached) in · 300 out");
    expect(rows[0].attributes("data-state")).toBe("ok");
    expect(rows[1].attributes("data-state")).toBe("error");
    expect(rows[1].text()).toContain("the server answered 500");
    expect(w.text()).toContain("/u/ai-debug");
    // Opening the list clears the button's count.
    expect(aiDebugUnseen.value).toBe(0);
    w.unmount();
  });

  it("copies the Markdown copy of a request", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ records: ROWS, folder: "" }))
      .mockResolvedValueOnce(new Response("# AI debug: Chat message", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const w = mount(AiDebugList);
    await flushPromises();
    await w.get('[data-test="ai-debug-copy"]').trigger("click");
    await flushPromises();
    expect(fetchMock.mock.calls[1][0]).toBe("/wp/api/ai/debug/d2?format=md");
    expect(writeText).toHaveBeenCalledWith("# AI debug: Chat message");
    expect(w.get('[data-test="ai-debug-copy"]').text()).toBe("Copied");
    w.unmount();
  });

  it("says when there is nothing yet, and closes on Escape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ records: [], folder: "" })));
    const w = mount(AiDebugList);
    await flushPromises();
    expect(w.find('[data-test="ai-debug-empty"]').exists()).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(w.emitted("close")).toHaveLength(1);
    w.unmount();
  });
});
