import { flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { _resetAiChatForTests, repeats, useAiChat } from "../useAiChat";
import type { AiChatResult } from "../../api/types";

vi.mock("../../api/client", () => ({
  api: { ai: {
    chatStream: vi.fn(), patchChat: vi.fn(async () => ({})),
    rateAnswer: vi.fn(async () => ({})), deleteTurn: vi.fn(async () => ({})),
  } },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

const AT = "2026-11-25T09:00:00+00:00";
const ANSWER: AiChatResult = {
  chat_id: "c1", message: "Two options.", proposals: [], steps: [], model: "m", at: AT,
  spent: { prompt: 1200, output: 80, cached: 1000, calls: 2 },
};

async function asked(chat: ReturnType<typeof useAiChat>, text: string): Promise<void> {
  chat.input.value = text;
  await chat.send();
  await flushPromises();
}

describe("chat turns", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetAiChatForTests();
    vi.mocked(api.ai.chatStream).mockReset().mockResolvedValue(structuredClone(ANSWER));
    vi.mocked(api.ai.rateAnswer).mockClear();
    vi.mocked(api.ai.deleteTurn).mockReset().mockResolvedValue({ deleted: true });
  });

  it("rates an answer, and the same rating again takes it back", async () => {
    const chat = useAiChat();
    await asked(chat, "what is in Weather?");
    const i = chat.entries.value.length - 1;
    await chat.rate(i, "up");
    const e = chat.entries.value[i];
    expect(e.role === "assistant" && e.rating).toBe("up");
    expect(api.ai.rateAnswer).toHaveBeenLastCalledWith("c1", AT, "up");
    await chat.rate(i, "up");
    const again = chat.entries.value[i];
    expect(again.role === "assistant" && again.rating).toBeFalsy();
    expect(api.ai.rateAnswer).toHaveBeenLastCalledWith("c1", AT, "");
  });

  it("deletes a turn: the message and its answer go", async () => {
    const chat = useAiChat();
    await asked(chat, "first");
    vi.mocked(api.ai.chatStream).mockResolvedValueOnce({ ...structuredClone(ANSWER), at: "2026-11-25T09:05:00+00:00" });
    await asked(chat, "second");
    const first = chat.entries.value.findIndex((e) => e.role === "assistant");
    expect(chat.deleteBlocked(first)).toBe("");
    await chat.deleteTurn(first);
    expect(api.ai.deleteTurn).toHaveBeenCalledWith("c1", AT);
    const users = chat.entries.value.filter((e) => e.role === "user").map((e) => e.role === "user" && e.text);
    expect(users).toEqual(["second"]);
  });

  it("puts the turn back when the server refuses", async () => {
    const chat = useAiChat();
    await asked(chat, "first");
    const before = chat.entries.value.length;
    vi.mocked(api.ai.deleteTurn).mockRejectedValueOnce(new Error("busy"));
    await chat.deleteTurn(before - 1);
    expect(chat.entries.value.length).toBe(before);
    expect(chat.error.value).toContain("busy");
  });

  it("can't delete an answer with no time (an older one)", async () => {
    vi.mocked(api.ai.chatStream).mockResolvedValueOnce({ ...structuredClone(ANSWER), at: undefined });
    const chat = useAiChat();
    await asked(chat, "first");
    expect(chat.deleteBlocked(chat.entries.value.length - 1)).not.toBe("");
  });
});

describe("repeats", () => {
  it("spots a reply that starts the way the note did", () => {
    expect(repeats("Weather has two options:  sunny and rainy.", "Weather has two\noptions")).toBe(true);
  });
  it("needs a few words before it decides", () => {
    expect(repeats("Weather has two options.", "Weather")).toBe(false);
  });
  it("is false for a reply that says something else", () => {
    expect(repeats("I read Weather first.", "Weather has two options")).toBe(false);
  });
});
