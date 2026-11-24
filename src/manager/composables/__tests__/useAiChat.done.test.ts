import { flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useToast } from "@/kit/useToast";
import { api } from "../../api/client";
import { _resetAiChatForTests, useAiChat } from "../useAiChat";
import { _resetAiDoneForTests } from "../useAiDone";
import type { AiChatResult } from "../../api/types";

vi.mock("../../api/client", () => ({
  api: { ai: { chatStream: vi.fn(), patchChat: vi.fn(async () => ({})) } },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

const ANSWER: AiChatResult = { chat_id: "c1", message: "Here are three outfits.", proposals: [], steps: [], model: "m" };

describe("chat done notice", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetAiChatForTests();
    _resetAiDoneForTests();
    useToast().toasts.value = [];
    vi.mocked(api.ai.chatStream).mockReset().mockResolvedValue(structuredClone(ANSWER));
  });

  it("toasts the answer when the drawer is closed, and Open opens it", async () => {
    const chat = useAiChat();
    chat.open.value = false;
    chat.input.value = "outfits?";
    await chat.send();
    await flushPromises();
    const t = useToast().toasts.value[0];
    expect(t?.summary).toBe("The assistant answered");
    expect(t?.detail).toBe("Here are three outfits.");
    await t?.action?.run();
    expect(chat.open.value).toBe(true);
  });

  it("says nothing while the drawer is open", async () => {
    const chat = useAiChat();
    chat.open.value = true;
    chat.input.value = "outfits?";
    await chat.send();
    expect(useToast().toasts.value).toHaveLength(0);
  });

  it("says nothing when stopped", async () => {
    vi.mocked(api.ai.chatStream).mockImplementation((_b, _on, signal) => new Promise((_res, rej) => {
      signal?.addEventListener("abort", () => rej(new DOMException("stop", "AbortError")));
    }));
    const chat = useAiChat();
    chat.open.value = false;
    chat.input.value = "outfits?";
    const run = chat.send();
    chat.stop();
    await run;
    expect(useToast().toasts.value).toHaveLength(0);
  });
});
