import { describe, expect, it, vi } from "vitest";
import { keptNote, useAiConversation } from "../useAiConversation";
import type { AiTurn } from "../../api/types";

type Res = { n: number; answer: Record<string, unknown> };

function setup(fail = false) {
  let n = 0;
  const send = vi.fn(async (_req: { instruction: string; history?: AiTurn[]; ctx: string }) => {
    if (fail) throw new Error("boom");
    n += 1;
    return { n, answer: { n } } as Res;
  });
  let ctx = "ctx1";
  const c = useAiConversation<Res, string>({
    capture: () => ctx, send, note: (r) => `note ${r.n}`,
    emptyMessage: (r) => (r.n === 3 ? "empty" : ""),
  });
  return { c, send, setCtx: (v: string) => { ctx = v; } };
}

describe("useAiConversation", () => {
  it("keeps the captured context for follow-ups and caps the history", async () => {
    const { c, send, setCtx } = setup();
    c.instruction.value = "first";
    await c.ask();
    setCtx("ctx2");
    for (let i = 0; i < 9; i++) {
      c.instruction.value = `f${i}`;
      await c.refine();
    }
    const last = send.mock.calls[send.mock.calls.length - 1]?.[0];
    expect(last?.ctx).toBe("ctx1");
    expect(last?.history).toHaveLength(8);
    expect(last?.history?.[0].instruction).toBe("first");
    expect(last?.history?.[7].instruction).toBe("f7");
    expect(last?.history?.[7].note).toBe("note 9");
    expect(c.count.value).toBe(10);
  });

  it("shows the empty message, keeps answers on a failed request", async () => {
    const { c } = setup();
    c.instruction.value = "a";
    await c.ask();
    await c.retry();
    await c.retry();
    expect(c.error.value).toBe("empty");
    c.go(-1);
    expect(c.error.value).toBe("");
    expect(c.result.value?.n).toBe(2);
    c.go(-5);
    expect(c.index.value).toBe(1);
  });

  it("keeps tries on their step and refines as branches under each try", async () => {
    const { c, send } = setup();
    const view = () => c.steps.value.map((s) => `${s.text}:${s.try + 1}/${s.tries}:${s.refine + 1}/${s.refines}${s.shown ? "*" : ""}`);
    c.instruction.value = "ask";
    await c.ask(); // #0 → n1
    await c.retry(); // #1 → n2, try 2 of the ask
    expect(view()).toEqual(["ask:2/2:1/1*"]);
    c.instruction.value = "darker";
    await c.refine(); // #2 → n3, from try 2
    expect(send.mock.calls[2][0].history?.[0].answer).toEqual({ n: 2 });
    await c.retry(); // #3 → n4, try 2 of "darker"
    expect(send.mock.calls[3][0].history?.[0].answer).toEqual({ n: 2 });
    expect(view()).toEqual(["ask:2/2:1/1", "darker:2/2:1/1*"]);
    // A second refine of the same try is a sibling step.
    c.show(c.steps.value[0].at);
    expect(c.result.value?.n).toBe(2);
    expect(c.steps.value[1].after).toBe(true);
    c.instruction.value = "shorter";
    await c.refine(); // #4 → n5
    expect(view()).toEqual(["ask:2/2:1/1", "shorter:1/1:2/2*"]);
    c.flip(c.steps.value[1].at, "refine", -1);
    // Back on "darker", at the try the user had there.
    expect(view()).toEqual(["ask:2/2:1/1", "darker:2/2:1/2*"]);
    expect(c.result.value?.n).toBe(4);
    // Flipping the ask to try 1 shows it; nothing was refined from it.
    c.flip(c.steps.value[0].at, "try", -1);
    expect(view()).toEqual(["ask:1/2:1/1*"]);
    expect(c.result.value?.n).toBe(1);
    // And back: the branch under try 2 returns as it was, try 2 showing.
    c.flip(c.steps.value[0].at, "try", 1);
    expect(view()).toEqual(["ask:2/2:1/1*", "darker:2/2:1/2"]);
    expect(c.result.value?.n).toBe(2);
    c.flip(c.steps.value[0].at, "try", 1); // past the end: nothing
    expect(c.result.value?.n).toBe(2);
    // A refine of try 1 goes under try 1 only.
    c.flip(c.steps.value[0].at, "try", -1);
    c.instruction.value = "from one";
    await c.refine();
    expect(send.mock.calls[5][0].history?.[0].answer).toEqual({ n: 1 });
    expect(view()).toEqual(["ask:1/2:1/1", "from one:1/1:1/1*"]);
    // Asking anew starts a fresh tree.
    c.clear();
    c.instruction.value = "new";
    await c.ask();
    expect(view()).toEqual(["new:1/1:1/1*"]);
  });

  it("an error leaves the box and the answers alone", async () => {
    const { c } = setup(true);
    c.instruction.value = "a";
    await c.ask();
    expect(c.error.value).toBe("boom");
    expect(c.instruction.value).toBe("a");
    expect(c.result.value).toBeNull();
  });
});

describe("keptNote", () => {
  it("says what was kept", () => {
    expect(keptNote(["a", "b"], new Set())).toBe("");
    expect(keptNote(["a", "b", "c"], new Set([1]))).toBe("they kept a; c. They unticked b");
    expect(keptNote(["a"], new Set([0]))).toBe("they unticked everything: a");
    expect(keptNote(["x".repeat(800), "b"], new Set([1])).length).toBeLessThan(760);
  });
});
