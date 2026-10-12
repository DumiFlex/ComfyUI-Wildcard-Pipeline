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
