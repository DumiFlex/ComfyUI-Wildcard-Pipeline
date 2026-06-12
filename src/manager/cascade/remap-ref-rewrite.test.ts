import { describe, expect, it } from "vitest";
import { rewriteBrokenRef } from "./remap-ref-rewrite";

const NEXT = { uuid: "beef0001", name: "colour", subcatExpr: "warm", excludeNull: false };

describe("rewriteBrokenRef", () => {
  it("rewrites a single @{oldUuid} token, rebuilding #name + :expr", () => {
    expect(rewriteBrokenRef("see @{deadbeef} here", "deadbeef", NEXT))
      .toBe("see @{beef0001#colour:warm} here");
  });

  it("rebuilds the #name from the picked wildcard, discarding the old cached name", () => {
    expect(rewriteBrokenRef("@{deadbeef#oldname:cold}", "deadbeef", NEXT))
      .toBe("@{beef0001#colour:warm}");
  });

  it("applies the reconciled :subcat (not the old one)", () => {
    const next = { uuid: "beef0001", name: "colour", subcatExpr: "warm or cold", excludeNull: false };
    expect(rewriteBrokenRef("@{deadbeef:vivid}", "deadbeef", next))
      .toBe("@{beef0001#colour:warm or cold}");
  });

  it("emits !null when excludeNull is set, and omits :expr when expr empty", () => {
    const next = { uuid: "beef0001", name: "colour", subcatExpr: "", excludeNull: true };
    expect(rewriteBrokenRef("@{deadbeef:warm!null}", "deadbeef", next))
      .toBe("@{beef0001#colour!null}");
  });

  it("rewrites EVERY occurrence of the old uuid in one string", () => {
    expect(rewriteBrokenRef("@{deadbeef} and @{deadbeef:cold}", "deadbeef", NEXT))
      .toBe("@{beef0001#colour:warm} and @{beef0001#colour:warm}");
  });

  it("leaves @{otherUuid} refs untouched", () => {
    expect(rewriteBrokenRef("@{deadbeef} @{facade00:cold}", "deadbeef", NEXT))
      .toBe("@{beef0001#colour:warm} @{facade00:cold}");
  });

  it("omits #name when the picked name is empty (legacy bare-uuid target)", () => {
    const next = { uuid: "beef0001", name: "", subcatExpr: "", excludeNull: false };
    expect(rewriteBrokenRef("@{deadbeef}", "deadbeef", next)).toBe("@{beef0001}");
  });

  it("is a no-op when the old uuid does not appear", () => {
    expect(rewriteBrokenRef("plain text @{facade00}", "deadbeef", NEXT))
      .toBe("plain text @{facade00}");
  });
});
