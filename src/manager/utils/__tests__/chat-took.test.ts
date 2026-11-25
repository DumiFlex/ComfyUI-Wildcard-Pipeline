import { describe, expect, it } from "vitest";
import { tookLabel } from "../chat-took";

describe("tookLabel", () => {
  it("says how long an answer took, short", () => {
    expect(tookLabel(40)).toBe("0.1 s");
    expect(tookLabel(840)).toBe("0.8 s");
    expect(tookLabel(9_960)).toBe("10 s");
    expect(tookLabel(12_400)).toBe("12 s");
    expect(tookLabel(60_000)).toBe("1 min");
    expect(tookLabel(125_000)).toBe("2 min 5 s");
  });
  it("says nothing without a time", () => {
    expect(tookLabel(undefined)).toBe("");
    expect(tookLabel(-1)).toBe("");
  });
});

describe("usage and time", () => {
  it("shortens token counts", async () => {
    const { tokensShort } = await import("../chat-took");
    expect(tokensShort(980)).toBe("980");
    expect(tokensShort(12_400)).toBe("12.4k");
    expect(tokensShort(1000)).toBe("1k");
    expect(tokensShort(250_000)).toBe("250k");
    expect(tokensShort(1_200_000)).toBe("1.2M");
  });
  it("labels what an answer used, read plus written", async () => {
    const { spentLabel, spentTitle } = await import("../chat-took");
    const s = { prompt: 12_000, output: 400, cached: 9_000, calls: 2 };
    expect(spentLabel(s)).toBe("12.4k tokens");
    expect(spentLabel(undefined)).toBe("");
    const title = spentTitle(s);
    expect(title).toContain("from the cache (75%)");
    expect(title).toContain("2 model calls");
  });
  it("shows the time today and the date before that", async () => {
    const { shortTime, fullTime } = await import("../chat-took");
    const now = new Date("2026-11-25T12:00:00");
    expect(shortTime("2026-11-25T09:05:00", now)).not.toMatch(/25/);
    expect(shortTime("2026-11-20T09:05:00", now)).toMatch(/20/);
    expect(shortTime("nope", now)).toBe("");
    expect(fullTime("nope")).toBe("");
  });
});
