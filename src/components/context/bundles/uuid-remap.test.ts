import { describe, it, expect } from "vitest";
import { walkRemap } from "./uuid-remap";

describe("walkRemap — partial remap table", () => {
  it("rewrites a whole-string field whose value is a remapped id", () => {
    const out = walkRemap("src11111", { src11111: "newsrc01" });
    expect(out).toBe("newsrc01");
  });

  it("leaves a whole-string field untouched when not in the remap table", () => {
    const out = walkRemap("other999", { src11111: "newsrc01" });
    expect(out).toBe("other999");
  });

  it("rewrites an embedded @{uuid} ref when the uuid is in the table", () => {
    const out = walkRemap("see @{bbbb2222} here", { bbbb2222: "newbbbb1" });
    expect(out).toBe("see @{newbbbb1} here");
  });

  it("preserves the #name and :subcat segments of an @{} ref", () => {
    const out = walkRemap("@{bbbb2222#Hair:long}", { bbbb2222: "newbbbb1" });
    expect(out).toBe("@{newbbbb1#Hair:long}");
  });

  it("leaves @{uuid} refs to non-remapped uuids verbatim", () => {
    const out = walkRemap("see @{xxxx9999} here", { bbbb2222: "newbbbb1" });
    expect(out).toBe("see @{xxxx9999} here");
  });

  it("recurses into nested arrays + objects without mutating input", () => {
    const input = { deeply: [[{ ref: "abcdef01", text: "see @{abcdef01}" }]] };
    const snapshot = JSON.parse(JSON.stringify(input));
    const out = walkRemap(input, { abcdef01: "newid001" }) as {
      deeply: Array<Array<{ ref: string; text: string }>>;
    };
    expect(out.deeply[0][0].ref).toBe("newid001");
    expect(out.deeply[0][0].text).toBe("see @{newid001}");
    expect(input).toEqual(snapshot);
  });
});
