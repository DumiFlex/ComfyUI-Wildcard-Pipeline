import { describe, expect, it } from "vitest";
import { ASK_PARAM, askInManagerUrl, isFrameUrl, staysInFrame } from "./frame-mode";

describe("frame mode", () => {
  it("is on only for ?frame=help", () => {
    expect(isFrameUrl("?frame=help")).toBe(true);
    expect(isFrameUrl("?x=1&frame=help")).toBe(true);
    expect(isFrameUrl("?frame=other")).toBe(false);
    expect(isFrameUrl("")).toBe(false);
  });

  it("keeps only docs pages in the frame", () => {
    expect(staysInFrame("/docs")).toBe(true);
    expect(staysInFrame("/docs/wp-toggles")).toBe(true);
    expect(staysInFrame("/wildcards")).toBe(false);
    expect(staysInFrame("/docsx")).toBe(false);
  });
});

describe("askInManagerUrl", () => {
  it("opens the same docs page in the manager with the question encoded", () => {
    const url = askInManagerUrl("http://h:1", "/docs/wp-note", "#s-x", "Explain \"a & b\"?");
    const u = new URL(url);
    expect(u.pathname).toBe("/wp/docs/wp-note");
    expect(u.hash).toBe("#s-x");
    expect(u.searchParams.get(ASK_PARAM)).toBe("Explain \"a & b\"?");
  });
});
