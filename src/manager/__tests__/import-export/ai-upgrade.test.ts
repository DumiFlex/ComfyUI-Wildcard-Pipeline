import { describe, expect, it } from "vitest";
import { committedWildcardNames, MAX_NAMED, upgradeAsk } from "../../import-export/ai-upgrade";

describe("ai-upgrade", () => {
  it("names the wildcards a commit brought in, once each", () => {
    expect(committedWildcardNames({
      adds: [
        { kind: "wildcard", entity: { id: "a", name: "Hair" } },
        { kind: "template", entity: { id: "t", name: "Scene" } },
        { kind: "wildcard", entity: { id: "b", name: " " } },
      ],
      replaces: [{ kind: "wildcard", id: "c", new_content: { name: "Eyes" } }],
      renames: [{ kind: "wildcard", old_id: "d", new_id: "e", content: { name: "Hair" } }],
    })).toEqual(["Hair", "Eyes"]);
  });

  it("asks for tags, constraints with fallbacks, a bundle and a test run", () => {
    const ask = upgradeAsk(["Hair", "Eyes"]);
    expect(ask).toContain('"Hair", "Eyes".');
    expect(ask).toMatch(/fallback/);
    expect(ask).toMatch(/bundle/);
    expect(ask).toMatch(/Run a test/);
    const many = upgradeAsk(Array.from({ length: MAX_NAMED + 3 }, (_, i) => `W${i}`));
    expect(many).toContain("and 3 more.");
  });
});
