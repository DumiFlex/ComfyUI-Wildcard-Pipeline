import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import AiWorking, { formatElapsed, pickVariant } from "../AiWorking.vue";
import { activeAiRequests, endAiRequest, startAiRequest, watchesProgress } from "../../../api/ai-progress";
import { api } from "../../../api/client";

describe("AiWorking", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    activeAiRequests.value = [];
  });

  it("shows a finished line and the phase's tempo", () => {
    const w = mount(AiWorking, { props: { text: "Writing…", phase: "writing" } });
    expect(w.get('[data-test="ai-working-detail"]').text()).toBe("Writing…");
    // One line: what is happening first, then the time.
    expect(w.get('[data-test="ai-working-word"]').text()).toBe("Writing…");
    expect(w.get('[data-test="ai-working-time"]').text()).toBe("0s");
    expect(w.attributes("data-tempo")).toBe("fast");
    expect(w.attributes("aria-label")).toBe("Writing…");
    // The logo's sparkles are drawn, not a spinner icon.
    expect(w.findAll(".wp-aiw__star")).toHaveLength(3);
  });

  it("mixes playful words with what is really happening", async () => {
    vi.useFakeTimers();
    const w = mount(AiWorking, { props: { text: "Searching the library…", phase: "thinking", variant: "orbit" } });
    const word = () => w.get('[data-test="ai-working-word"]').text();
    expect(word()).toBe("Searching the library…");
    vi.advanceTimersByTime(3500);
    await flushPromises();
    expect(word()).not.toBe("Searching the library…");
    vi.advanceTimersByTime(7000);
    await flushPromises();
    expect(word()).toBe("Searching the library…");
    // A new status is said straight away.
    vi.advanceTimersByTime(3500);
    await w.setProps({ text: "Writing…", phase: "writing" });
    expect(word()).toBe("Writing…");
    expect(w.findAll(".wp-aiw__dot")).toHaveLength(4);
    w.unmount();
  });

  it("picks the typing stars most often", () => {
    expect([0, 0.39, 0.45, 0.65, 0.95].map(pickVariant)).toEqual(["typing", "typing", "shuffle", "orbit", "burst"]);
    for (const v of ["typing", "shuffle", "orbit", "burst"] as const) {
      expect(mount(AiWorking, { props: { text: "x", variant: v } }).findAll(".wp-aiw__star")).toHaveLength(3);
    }
  });

  it("polls the newest AI request and says what the model is doing", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(
      { phase: "writing", tokens: 420, calls: 2, seconds: 3, done: false })));
    vi.stubGlobal("fetch", fetchMock);
    const id = startAiRequest("/wp/api/ai/pack/plan");
    const w = mount(AiWorking, { props: { label: "Planning" } });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith(`/wp/api/ai/progress/${id}`);
    expect(w.get('[data-test="ai-working-detail"]').text()).toBe("Planning: request 2, writing, about 420 tokens");
    expect(w.get('[data-test="ai-working-word"]').text()).toBe("Writing · 420 tokens…");
    expect(w.attributes("data-tempo")).toBe("fast");
    vi.advanceTimersByTime(2100);
    await flushPromises();
    expect(w.get('[data-test="ai-working-time"]').text()).toBe("2s");
    endAiRequest(id);
    w.unmount();
  });

  it("writes the time like Claude Code", () => {
    expect([5, 65, 797, 3725].map(formatElapsed)).toEqual(["5s", "1m 05s", "13m 17s", "1h 02m"]);
  });

  it("names model requests and tracks them while they run", async () => {
    expect(watchesProgress("/wp/api/ai/pack/plan", "POST")).toBe(true);
    expect(watchesProgress("/wp/api/ai/config", "GET")).toBe(false);
    expect(watchesProgress("/wp/api/ai/index/rebuild", "POST")).toBe(false);
    let seen: Record<string, string> = {};
    let during = 0;
    vi.stubGlobal("fetch", vi.fn(async (_path: string, init: RequestInit) => {
      seen = init.headers as Record<string, string>;
      during = activeAiRequests.value.length;
      return new Response(JSON.stringify({ ok: true }));
    }));
    await api.ai.test();
    expect(seen["X-WP-Progress"]).toMatch(/^[0-9a-f]{24}$/);
    expect(during).toBe(1);
    expect(activeAiRequests.value).toHaveLength(0);
  });
});
