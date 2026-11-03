import { describe, expect, it } from "vitest";
import { isFrameUrl, staysInFrame } from "./frame-mode";

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
