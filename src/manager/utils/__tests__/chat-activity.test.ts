import { describe, expect, it } from "vitest";
import type { AiChatStep } from "../../api/types";
import {
  categoryOf, doneTitle, failedCount, groupSteps, groupTime, hasWork, mainCat, previewLine,
  tally, turnSummary,
} from "../chat-activity";

const call = (tool: string, note: string, at?: number, ok = true): AiChatStep =>
  ({ tool, note, ok, ...(at !== undefined ? { at } : {}) });
const think = (note: string, at?: number): AiChatStep =>
  ({ tool: "think", note, ok: true, think: true, ...(at !== undefined ? { at } : {}) });
const say = (note: string, at?: number): AiChatStep =>
  ({ tool: "say", note, ok: true, say: true, ...(at !== undefined ? { at } : {}) });

describe("chat activity", () => {
  it("sorts tools into kinds", () => {
    expect(["read", "variables", "search", "docs_read", "web_search", "run_test", "create_wildcard",
      "edit_options", "plan_pack", "highlight", "more_tools"].map(categoryOf))
      .toEqual(["read", "read", "search", "docs", "web", "test", "change", "change", "change", "page", "other"]);
  });

  it("groups the work between two things the model said", () => {
    const items = groupSteps([
      think("plan", 900), call("read", "Read A", 1200), call("search", "Searched x", 1500),
      say("Found it, now testing.", 1600),
      call("run_test", "Ran A on 100 seeds", 4600),
      { tool: "retry", note: "Asked again in JSON steps", ok: true, notice: true, at: 5000 },
      call("read", "Read B", 5400),
    ]);
    expect(items.map((x) => x.kind)).toEqual(["group", "say", "group", "notice", "group"]);
    expect(items.map((x) => x.key)).toEqual(["g0", "s3", "g4", "n5", "g6"]);
    const [g1, , g2, , g3] = items;
    expect(g1.kind === "group" && g1.steps).toHaveLength(3);
    // Each group runs from the end of what came before it.
    expect(g1.kind === "group" && [g1.from, g1.to]).toEqual([0, 1500]);
    expect(g2.kind === "group" && groupTime(g2)).toBe("3 s");
    expect(g3.kind === "group" && groupTime(g3)).toBe("0.4 s");
  });

  it("leaves out a working note that is the final reply", () => {
    expect(groupSteps([call("read", "Read A"), say("Done.")], "Done.").map((x) => x.kind)).toEqual(["group"]);
  });

  it("titles a finished group by what it did", () => {
    expect(doneTitle([call("read", "a"), call("read", "b"), call("search", "s")]))
      .toBe("Read 2 items and searched once");
    expect(doneTitle([call("read", "a"), call("docs_read", "d"), call("run_test", "t"), call("create_wildcard", "c")]))
      .toBe("Read 1 item, read 1 docs page, ran 1 test and more");
    expect(doneTitle([think("hm")])).toBe("Thought it through");
    expect(mainCat([call("read", "a"), call("search", "s"), call("search", "t")])).toBe("search");
    expect(mainCat([think("x")])).toBe("think");
    expect(tally([think("x"), call("read", "a")])).toEqual([["read", 1]]);
  });

  it("counts failed calls", () => {
    expect(failedCount([call("read", "a", 0, false), think("x"), call("read", "b")])).toBe(1);
  });

  it("previews the last finished line of reasoning", () => {
    expect(previewLine("First I check.\n- Then I read Hair Color\nand the")).toBe("and the");
    expect(previewLine("First I check.\n- Then I read Hair Color\nand the", true)).toBe("Then I read Hair Color");
    expect(previewLine("no newline yet", true)).toBe("");
    expect(previewLine("x".repeat(200)).length).toBe(90);
  });

  it("sums up the whole answer in one line", () => {
    expect(turnSummary([call("read", "a"), call("read", "b"), call("run_test", "t")], 72_000))
      .toEqual({ title: "Worked for 1 min 12 s", detail: "read 2 items and ran 1 test" });
    expect(turnSummary([think("x")])).toEqual({ title: "Worked", detail: "thought it through" });
    expect(hasWork([say("hi")])).toBe(false);
    expect(hasWork([say("hi"), think("x")])).toBe(true);
  });
});
