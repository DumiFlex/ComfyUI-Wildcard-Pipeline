import { describe, expect, it } from "vitest";
import { rankCommands } from "../../utils/commandRank";

const noop = () => {};
const item = (id: string, label: string, subtitle?: string) => ({
  id,
  label,
  subtitle: subtitle ?? "",
  kind: "module" as const,
  icon: "x",
  run: noop,
});

describe("rankCommands", () => {
  it("returns all items when query empty", () => {
    const items = [item("a", "Alpha"), item("b", "Beta")];
    expect(rankCommands(items, "", []).length).toBe(2);
  });

  it("ranks exact-prefix above substring", () => {
    const items = [
      item("a", "Alphabet"),
      item("b", "Alpha"),
      item("c", "Halpha"),
    ];
    const ranked = rankCommands(items, "alp", []);
    // "Alpha" and "Alphabet" both prefix-match "alp"; "Alpha" is exact label match (= label "alpha" lowercase) — should rank highest.
    // "Halpha" contains "alp" but not at prefix.
    expect(ranked[0].id).toBe("b");
  });

  it("recent ids get boost", () => {
    const items = [item("a", "Foo"), item("b", "Foobar")];
    const noBoost = rankCommands(items, "foo", []);
    const withBoost = rankCommands(items, "foo", ["b"]);
    expect(noBoost[0].id).toBe("a");      // shorter label, exact prefix
    expect(withBoost[0].id).toBe("b");    // recent boost overcomes alpha tiebreak
  });

  it("multi-token query requires all tokens to match somewhere", () => {
    const items = [
      item("a", "Wild things"),                  // both in label
      item("b", "Wild", "things"),               // one in label, one in subtitle
      item("c", "Wild"),                          // only one token matches
    ];
    const ranked = rankCommands(items, "wild things", []);
    const ids = ranked.map((i) => i.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).not.toContain("c");
  });

  it("returns empty when no items match", () => {
    const items = [item("a", "Alpha")];
    expect(rankCommands(items, "xyz", []).length).toBe(0);
  });

  it("alphabetical tiebreak on equal score", () => {
    const items = [item("z", "Zeta"), item("a", "Alpha")];
    // Both contain "a" as substring; equal prefix scoring on label
    // (both have "a" at position 0). Tiebreak should sort by label.
    const ranked = rankCommands(items, "a", []);
    expect(ranked[0].id).toBe("a"); // "Alpha" comes before "Zeta" alphabetically
  });
});
