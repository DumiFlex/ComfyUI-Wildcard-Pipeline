import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiCardGroup from "../AiCardGroup.vue";
import type { AiChatProposal } from "../../../api/types";
import type { ChatAssistantEntry } from "../../../composables/useAiChat";

const chat = vi.hoisted(() => ({
  apply: vi.fn(), applyAll: vi.fn(), undo: vi.fn(), dismiss: vi.fn(), fixAll: vi.fn(),
  blockedReason: vi.fn(() => ""), chainOf: vi.fn(() => [] as unknown[]),
}));
vi.mock("../../../composables/useAiChat", () => ({ useAiChat: () => chat }));

function card(pid: string, extra: Partial<AiChatProposal> = {}): AiChatProposal {
  return {
    pid, tool: "create_wildcard", title: `Create wildcard ${pid}`, summary: `$${pid} with 3 options`,
    preview: [], warnings: [], after: null,
    op: { op: "create", kind: "module", new_category: "", body: { type: "wildcard", name: pid, category_id: null, tags: [], payload: {} } },
    ...extra,
  } as unknown as AiChatProposal;
}

function entry(proposals: AiChatProposal[], status: Record<string, string> = {}): ChatAssistantEntry {
  return {
    role: "assistant", status, created: {}, errors: {},
    result: { chat_id: "c", message: "", proposals, steps: [], model: "m" },
  } as unknown as ChatAssistantEntry;
}

function mountIt(e: ChatAssistantEntry, open = new Set<string>()) {
  return mount(AiCardGroup, {
    props: { entry: e, group: { key: "create:wildcard", pids: e.result.proposals.map((p) => p.pid) },
      proposals: e.result.proposals, open, status: { ...e.status }, bodyId: (pid: string) => `body-${pid}` },
  });
}

describe("AiCardGroup", () => {
  beforeEach(() => {
    for (const f of Object.values(chat)) f.mockClear();
    chat.blockedReason.mockReturnValue("");
    chat.chainOf.mockReturnValue([]);
    chat.apply.mockImplementation(async (e: ChatAssistantEntry, p: AiChatProposal) => { e.status[p.pid] = "applied"; });
  });

  it("shows one row per card, with counts and warnings", () => {
    const e = entry([card("a"), card("b", { warnings: ["two picks share words", "a note"], notes: ["a note"] }), card("c")]);
    const w = mountIt(e);
    expect(w.text()).toContain("Create 3 wildcards");
    expect(w.get('[data-test="ai-group-counts"]').text()).toContain("3 to review · 1 with warnings");
    expect(w.findAll('[data-test="ai-group-row"]')).toHaveLength(3);
    expect(w.get('[data-test="ai-group-warn"]').text()).toBe("1");
    expect(w.get('[data-test="ai-group-apply"]').text()).toContain("Apply 3");
  });

  it("applies only the ticked rows, in order, and a waiting one through its chain", async () => {
    const e = entry([card("a"), card("b"), card("c")]);
    chat.blockedReason.mockImplementation(((_e: ChatAssistantEntry, p: AiChatProposal) => (p.pid === "c" ? "Apply a first" : "")) as never);
    chat.chainOf.mockImplementation(((_e: ChatAssistantEntry, p: AiChatProposal) => (p.pid === "c" ? [{}] : [])) as never);
    const w = mountIt(e);
    await w.findAll('[data-test="ai-group-tick"] [role="checkbox"]')[1].trigger("click");
    expect(w.get('[data-test="ai-group-apply"]').text()).toContain("Apply 2");
    await w.get('[data-test="ai-group-apply"]').trigger("click");
    await flushPromises();
    expect(chat.apply.mock.calls.map((c) => (c[1] as AiChatProposal).pid)).toEqual(["a"]);
    expect(chat.applyAll.mock.calls.map((c) => (c[1] as AiChatProposal).pid)).toEqual(["c"]);
  });

  it("dismisses the unticked rows, opens a row in place and undoes newest first", async () => {
    const e = entry([card("a"), card("b"), card("c")]);
    const w = mountIt(e);
    expect(w.find('[data-test="ai-group-dismiss"]').exists()).toBe(false);
    await w.findAll('[data-test="ai-group-tick"] [role="checkbox"]')[2].trigger("click");
    expect(w.get('[data-test="ai-group-apply"]').text()).toBe("Apply 2");
    expect(w.get('[data-test="ai-group-dismiss"]').text()).toBe("Dismiss the other 1");
    await w.get('[data-test="ai-group-dismiss"]').trigger("click");
    expect((chat.dismiss.mock.calls as unknown[][]).map((c) => (c[1] as AiChatProposal).pid)).toEqual(["c"]);
    chat.dismiss.mockClear();
    await w.get('[data-test="ai-group-tick-all"]').trigger("click");
    expect(w.find('[data-test="ai-group-apply"]').exists()).toBe(false);
    expect(w.get('[data-test="ai-group-dismiss"]').text()).toBe("Dismiss all 3");
    await w.get('[data-test="ai-group-dismiss"]').trigger("click");
    expect(chat.dismiss).toHaveBeenCalledTimes(3);
    // Each row has its body slot in place, under the row, for the drawer.
    expect(w.findAll('[data-test="ai-group-body"]').map((b) => b.attributes("id"))).toEqual(["body-a", "body-b", "body-c"]);
    await w.findAll('[data-test="ai-group-open"]')[1].trigger("click");
    expect(w.emitted("toggle")?.[0]).toEqual(["b"]);

    const broken = entry([card("a"), card("b"), card("c")], { a: "failed" });
    expect(mountIt(broken).get('[data-test="ai-group-counts"]').text()).toContain("1 failed");
    const done = entry([card("a"), card("b"), card("c")], { a: "applied", b: "editor", c: "dismissed" });
    const w2 = mountIt(done);
    expect(w2.get('[data-test="ai-group-counts"]').text()).toContain("2 applied · 0 to review");
    await w2.get('[data-test="ai-group-undo"]').trigger("click");
    await flushPromises();
    expect(chat.undo.mock.calls.map((c) => (c[1] as AiChatProposal).pid)).toEqual(["b", "a"]);
  });

  it("fixes every card the code can fix", async () => {
    const fixes = [{ warning: "w", key: "weights", label: "Even out the weights" }];
    const e = entry([card("a", { fixes }), card("b", { fixes }), card("c")]);
    const w = mountIt(e);
    await w.get('[data-test="ai-group-fix-all"]').trigger("click");
    await flushPromises();
    expect(chat.fixAll).toHaveBeenCalledTimes(2);
  });
});
