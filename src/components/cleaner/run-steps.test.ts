import { describe, expect, it } from "vitest";
import { entryHit, ruleSteps, tagSpans } from "./run-steps";
import type { CleanerTrace } from "./types";

describe("ruleSteps", () => {
  it("walks the trace in order and carries each step's before and after", () => {
    const trace: CleanerTrace = {
      input: "a,  a, b",
      output: "a, b",
      mode: "tags",
      steps: [
        { rule: "empty_groups" },
        { rule: "whitespace", text: "a, a, b" },
        { rule: "dedupe_exact", text: "a, b" },
      ],
    };
    const steps = ruleSteps(trace, {
      empty_groups: { removed: 0 },
      whitespace: { fixed: 1 },
      dedupe_exact: { dropped: ["a"], matched: ["a"] },
    });
    expect(steps.map((s) => [s.rule, s.changed, s.summary])).toEqual([
      ["empty_groups", false, "no change"],
      ["whitespace", true, "fixed 1 spacing or comma slip"],
      ["dedupe_exact", true, "dropped 1 repeated tag"],
    ]);
    expect(steps[2].before).toBe("a, a, b");
    expect(steps[2].after).toBe("a, b");
    expect(steps[2].reasons).toEqual([{ item: "a", verb: "repeats", cause: "a" }]);
    // The kept (first) "a" is marked, not the dropped one.
    expect(steps[2].marks).toEqual([{ start: 0, end: 1, label: 'kept: "a" repeats it' }]);
  });

  it("explains fuzzy drops with their closeness and blocklist drops with the entry", () => {
    const before = "pixie cut, pixie cuts, signature watermark";
    const trace: CleanerTrace = {
      input: before,
      output: "pixie cut",
      steps: [
        { rule: "fuzzy_dedupe", text: "pixie cut, signature watermark" },
        { rule: "blocklist", text: "pixie cut" },
      ],
    };
    const [fz, bl] = ruleSteps(trace, {
      fuzzy_dedupe: { dropped: ["pixie cuts"], matched: ["pixie cut"], scores: [0.9] },
      blocklist: { dropped: ["signature watermark"], matched: ["watermark"], errors: [] },
    });
    expect(fz.reasons).toEqual([{ item: "pixie cuts", verb: "is 90% like", cause: "pixie cut" }]);
    expect(fz.marks[0]).toMatchObject({ start: 0, end: 9 });
    expect(bl.reasons).toEqual([{ item: "signature watermark", verb: "matched", cause: "watermark" }]);
    const text = "pixie cut, signature watermark";
    expect(text.slice(bl.marks[0].start, bl.marks[0].end)).toBe("watermark");
  });

  it("names the negative's prompt-overlap drop", () => {
    const [step] = ruleSteps(
      { input: "lowres, red", output: "lowres", steps: [{ rule: "prompt_overlap", text: "lowres" }] },
      { prompt_overlap: { tags: ["red"], dropped: true } },
    );
    expect(step.summary).toBe("dropped 1 tag the prompt also has");
    expect(step.reasons).toEqual([{ item: "red", verb: "is also in", cause: "the prompt" }]);
  });

  it("works without a report and without stats it doesn't know", () => {
    const steps = ruleSteps({ input: "a", output: "b", steps: [{ rule: "punctuation", text: "b" }] }, null);
    expect(steps[0]).toMatchObject({ changed: true, summary: "trimmed 0 stray punctuation marks", reasons: [], marks: [] });
  });
});

describe("tagSpans / entryHit", () => {
  it("finds trimmed tag spans", () => {
    expect(tagSpans(" a ,b,, c")).toEqual([
      { start: 1, end: 2, tag: "a" },
      { start: 4, end: 5, tag: "b" },
      { start: 8, end: 9, tag: "c" },
    ]);
  });

  it("matches an entry as a regex, a word or a substring, and skips bad regexes", () => {
    const t = "bad hands, x";
    expect(entryHit(t, { start: 0, end: 9 }, "bad\\s+\\w+")).toEqual({ start: 0, end: 9 });
    expect(entryHit(t, { start: 0, end: 9 }, "HANDS")).toEqual({ start: 4, end: 9 });
    expect(entryHit(t, { start: 0, end: 9 }, "(")).toBeNull();
    expect(entryHit(t, { start: 0, end: 9 }, "zzz")).toBeNull();
  });
});
