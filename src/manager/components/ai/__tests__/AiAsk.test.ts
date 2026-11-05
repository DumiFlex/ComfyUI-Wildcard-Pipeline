import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiAsk from "../AiAsk.vue";
import { api } from "../../../api/client";
import { _resetAiChatForTests, askAnswered, useAiChat, type ChatAssistantEntry } from "../../../composables/useAiChat";
import type { AiAskQuestion, AiChatResult } from "../../../api/types";

vi.mock("../../../api/client", () => {
  const chat = vi.fn();
  return {
    api: {
      ai: {
        chat,
        chatStream: vi.fn((body: unknown, _on: unknown, signal?: AbortSignal) => chat(body, signal)),
        patchChat: vi.fn(() => Promise.resolve({})), getChat: vi.fn(), config: vi.fn(),
      },
    },
    ApiError: class ApiError extends Error {},
  };
});

const STYLE: AiAskQuestion = {
  header: "Style", question: "Which art style?", multi: false,
  choices: [{ label: "Anime" }, { label: "Realistic", hint: "photo-like" }],
};
const EXTRAS: AiAskQuestion = {
  header: "Extras", question: "Which extras?", multi: true,
  choices: [{ label: "Hats" }, { label: "Glasses" }, { label: "Capes" }],
};
const NEG: AiAskQuestion = {
  header: "Negatives", question: "Add negatives?", multi: false,
  choices: [{ label: "Yes" }, { label: "No" }],
};

function answers(w: ReturnType<typeof mount>): unknown[] {
  return (w.emitted("answer") ?? []).map((e) => e[0]);
}

describe("AiAsk", () => {
  it("sends one single-choice question on click, and on a number key", async () => {
    const w = mount(AiAsk, { props: { questions: [STYLE] } });
    expect(w.find('[data-test="ai-ask-send"]').exists()).toBe(false);
    const chips = w.findAll('[data-test="ai-ask-choice"]');
    expect(chips[1].text()).toContain("photo-like");
    expect(chips[1].attributes("title")).toBe("Realistic: photo-like");
    expect(w.find('[role="radiogroup"]').exists()).toBe(true);
    await chips[1].trigger("click");
    await chips[1].trigger("keydown", { key: "1" });
    await w.find('[data-test="ai-ask-decide"]').trigger("click");
    expect(answers(w)).toEqual([[{ q: 0, picked: [1] }], [{ q: 0, picked: [0] }], [{ q: 0, decide: true }]]);
  });

  it("takes the user's own words", async () => {
    const w = mount(AiAsk, { props: { questions: [STYLE] }, attachTo: document.body });
    await w.find('[data-test="ai-ask-other"]').trigger("click");
    const input = w.find('[data-test="ai-ask-other-input"]');
    expect(document.activeElement).toBe(input.element);
    await input.trigger("keydown", { key: "Enter" });
    expect(answers(w)).toEqual([]);  // nothing typed yet
    await input.setValue("  pastel watercolour ");
    await input.trigger("keydown", { key: "Enter" });
    expect(answers(w)).toEqual([[{ q: 0, other: "pastel watercolour" }]]);
    w.unmount();
  });

  it("collects several questions and leaves the open ones to the assistant", async () => {
    const w = mount(AiAsk, { props: { questions: [STYLE, EXTRAS, NEG] } });
    const qs = w.findAll('[data-test="ai-ask-question"]');
    expect(qs[1].attributes("role")).toBe("group");
    await qs[0].findAll('[data-test="ai-ask-choice"]')[0].trigger("click");
    // A multi question never sends by itself.
    await qs[1].findAll('[data-test="ai-ask-choice"]')[2].trigger("click");
    const chip = qs[1].find('[data-test="ai-ask-choice"]');
    await chip.trigger("keydown", { key: "1" });
    await chip.trigger("keydown", { key: "9" });
    expect(answers(w)).toEqual([]);
    expect(qs[1].findAll('[aria-checked="true"]')).toHaveLength(2);
    expect(w.text()).toContain("1 left for the assistant to decide");
    await chip.trigger("keydown", { key: "Enter" });
    expect(answers(w)).toEqual([[
      { q: 0, picked: [0] }, { q: 1, picked: [0, 2] }, { q: 2, decide: true }]]);
    // Picking again in a single question clears it; Decide for me clears picks.
    await qs[0].findAll('[data-test="ai-ask-choice"]')[0].trigger("click");
    await qs[1].find('[data-test="ai-ask-decide"]').trigger("click");
    await w.find('[data-test="ai-ask-send"]').trigger("click");
    expect(answers(w)[1]).toEqual([{ q: 0, decide: true }, { q: 1, decide: true }, { q: 2, decide: true }]);
  });

  it("folds to one line once answered, and does nothing while disabled", async () => {
    const done = mount(AiAsk, { props: { questions: [STYLE, NEG], answered: {
      answers: [{ header: "Style", answer: "Anime" }, { header: "Negatives", answer: "you decide" }] } } });
    expect(done.find('[data-test="ai-ask"]').exists()).toBe(false);
    expect(done.find('[data-test="ai-ask-done"]').text()).toBe("Style: Anime · Negatives: you decide");
    const own = mount(AiAsk, { props: { questions: [STYLE], answered: { own: true } } });
    expect(own.text()).toContain("Answered in your message");
    const busy = mount(AiAsk, { props: { questions: [STYLE], disabled: true } });
    await busy.findAll('[data-test="ai-ask-choice"]')[0].trigger("click");
    expect(answers(busy)).toEqual([]);
  });
});

const ASKING: AiChatResult = {
  chat_id: "c1", message: "A few questions first.", proposals: [], steps: [], model: "m",
  pending: [{ id: "call1", tool: "ask", label: "Asked 2 questions",
    args: { questions: [STYLE, NEG] } }],
};
const DONE: AiChatResult = { chat_id: "c1", message: "Building it.", proposals: [], steps: [], model: "m", pending: [] };

describe("useAiChat questions and edits", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetAiChatForTests();
    vi.mocked(api.ai.chat).mockReset();
  });

  it("words answers like the server", () => {
    expect(askAnswered([STYLE, EXTRAS, NEG], [
      { q: 0, picked: [1] }, { q: 1, picked: [2, 0, 2, 9] }, { q: 2, other: " none " }])).toEqual({ answers: [
      { header: "Style", answer: "Realistic" }, { header: "Extras", answer: "Capes, Hats" },
      { header: "Negatives", answer: '"none"' }] });
    expect(askAnswered([STYLE], [])).toEqual({ answers: [{ header: "Style", answer: "you decide" }] });
  });

  it("a question doesn't hold the chat; answering it carries the turn on", async () => {
    const chat = useAiChat();
    vi.mocked(api.ai.chat).mockResolvedValueOnce(ASKING).mockResolvedValueOnce(DONE);
    chat.input.value = "make a pack";
    await chat.send();
    expect(chat.loading.value).toBe(false);
    const entry = chat.entries.value[1] as ChatAssistantEntry;
    expect(chat.askCalls(entry).map((c) => c.id)).toEqual(["call1"]);
    await chat.answerAsk("call1", [{ q: 0, picked: [0] }]);
    expect(vi.mocked(api.ai.chat).mock.calls[1][0]).toEqual({
      chat_id: "c1", results: [{ id: "call1", answers: [{ q: 0, picked: [0] }] }] });
    expect(entry.answered?.call1).toEqual({ answers: [
      { header: "Style", answer: "Anime" }, { header: "Negatives", answer: "you decide" }] });
    expect((chat.entries.value[2] as ChatAssistantEntry).result.message).toBe("Building it.");
    // Answered once only.
    await chat.answerAsk("call1", [{ q: 0, picked: [1] }]);
    expect(vi.mocked(api.ai.chat)).toHaveBeenCalledTimes(2);
  });

  it("a failed answer can be given again; typing a message answers instead", async () => {
    const chat = useAiChat();
    vi.mocked(api.ai.chat).mockResolvedValueOnce(ASKING).mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(DONE);
    chat.input.value = "make a pack";
    await chat.send();
    const entry = chat.entries.value[1] as ChatAssistantEntry;
    await chat.answerAsk("call1", [{ q: 0, decide: true }]);
    expect(chat.error.value).toBe("down");
    expect(entry.answered?.call1).toBeUndefined();
    chat.input.value = "anime, no negatives";
    await chat.send();
    expect(entry.answered?.call1).toEqual({ own: true });
    expect(vi.mocked(api.ai.chat).mock.calls[2][0]).toMatchObject({ message: "anime, no negatives", chat_id: "c1" });
  });

  it("edits the last message: back in the box, then run in its place", async () => {
    const chat = useAiChat();
    vi.mocked(api.ai.chat).mockResolvedValueOnce(DONE).mockResolvedValueOnce({ ...DONE, message: "Blue." });
    chat.input.value = "make it red";
    await chat.send();
    chat.editLast();
    expect(chat.input.value).toBe("make it red");
    expect(chat.editing.value).toBe(true);
    chat.input.value = "make it blue";
    await chat.send();
    await flushPromises();
    expect(vi.mocked(api.ai.chat).mock.calls[1][0]).toEqual({ chat_id: "c1", retry: true, message: "make it blue" });
    expect(chat.entries.value.map((e) => e.role === "user" ? e.text : e.result.message)).toEqual(["make it blue", "Blue."]);
    expect(chat.editing.value).toBe(false);
    expect(chat.input.value).toBe("");
    // Cancelling empties the box.
    chat.editLast();
    chat.cancelEdit();
    expect(chat.input.value).toBe("");
    expect(chat.editing.value).toBe(false);
  });

  it("an edit that fails goes back in the box; an applied card blocks it", async () => {
    const chat = useAiChat();
    vi.mocked(api.ai.chat).mockResolvedValueOnce(DONE).mockRejectedValueOnce(new Error("down"));
    chat.input.value = "make it red";
    await chat.send();
    chat.editLast();
    chat.input.value = "make it blue";
    await chat.send();
    expect(chat.error.value).toBe("down");
    expect(chat.input.value).toBe("make it blue");
    expect(chat.editing.value).toBe(true);
    expect((chat.entries.value[0] as { text: string }).text).toBe("make it red");
    const entry = chat.entries.value[1] as ChatAssistantEntry;
    entry.status = { p1: "applied" };
    expect(chat.editBlocked()).toContain("Undo");
    await chat.send();
    expect(chat.error.value).toContain("Undo");
    expect(vi.mocked(api.ai.chat)).toHaveBeenCalledTimes(2);
  });
});
