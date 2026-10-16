import { describe, expect, it } from "vitest";
import { starterQuestions, WHAT_CAN_YOU_DO, type StarterLibrary } from "../chat-starters";

const EMPTY: StarterLibrary = { modules: {}, bundles: 0, templates: 0, categories: 0 };
const FULL: StarterLibrary = {
  modules: { wildcard: 12, constraint: 2 }, bundles: 3, templates: 1, categories: 4, topCategory: "Outfits",
};

describe("starterQuestions", () => {
  it("fits the home page to the library and offers What can you do?", () => {
    expect(starterQuestions({ name: "dashboard" }, EMPTY)).toEqual([
      "Help me make my first wildcard", "How does the pipeline fit together?", WHAT_CAN_YOU_DO,
    ]);
    expect(starterQuestions({ name: "dashboard" }, FULL)[0]).toBe("What does my library set up for outfits?");
  });

  it("asks about the page's own kind", () => {
    expect(starterQuestions({ name: "constraints" }, FULL)[0]).toBe("How do constraints work?");
    expect(starterQuestions({ name: "wildcards" }, FULL)[0]).toBe("Which of my 12 wildcards repeat each other?");
    expect(starterQuestions({ name: "wildcards" }, EMPTY)).not.toContain("How do constraints work?");
    expect(starterQuestions({ name: "bundles" }, FULL)[0]).toBe("What do my 3 bundles set up?");
    expect(starterQuestions({ name: "constraints" }, EMPTY)).not.toContain(
      "Which of my wildcards should rule each other out?");
  });

  it("uses editor starters by kind, and never more than three", () => {
    expect(starterQuestions({ name: "wildcards-edit", hasId: true }, FULL)).toEqual([
      "What could make this better?", "Remove options that repeat each other", WHAT_CAN_YOU_DO,
    ]);
    expect(starterQuestions({ name: "constraints-edit", hasId: true }, FULL)[0]).toBe("Explain what this does");
    expect(starterQuestions({ name: "wildcards-new" }, FULL)[0]).toBe("Help me fill this in");
    expect(starterQuestions({ name: "documentation-page" }, FULL)[0]).toBe("Explain this page in simpler words");
    for (const name of ["dashboard", "wildcards", "tags", "settings", "test", "nope"]) {
      expect(starterQuestions({ name }, FULL).length).toBeLessThanOrEqual(3);
    }
  });
});
