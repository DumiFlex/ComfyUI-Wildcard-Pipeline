import { describe, expect, it } from "vitest";
import { isValidId, VALID_ID_RE, newShortId } from "./ids";

describe("isValidId / VALID_ID_RE", () => {
  it("accepts exactly 8 lowercase hex chars", () => {
    expect(isValidId("ed1bccf8")).toBe(true);
    expect(isValidId("00000000")).toBe(true);
    expect(isValidId("deadbeef")).toBe(true);
    expect(VALID_ID_RE.test("c010c010")).toBe(true);
  });

  it("rejects non-hex, wrong length, uppercase, and non-strings", () => {
    expect(isValidId("coloruni")).toBe(false); // the real bug: has o/r/u/n/i
    expect(isValidId("ED1BCCF8")).toBe(false); // uppercase
    expect(isValidId("ed1bccf")).toBe(false); // 7 chars
    expect(isValidId("ed1bccf80")).toBe(false); // 9 chars
    expect(isValidId("opt00001")).toBe(false); // option-id shape (o/p/t)
    expect(isValidId("")).toBe(false);
    expect(isValidId(undefined)).toBe(false);
    expect(isValidId(12345678)).toBe(false);
  });

  it("every newShortId() passes isValidId", () => {
    for (let i = 0; i < 200; i++) {
      expect(isValidId(newShortId())).toBe(true);
    }
  });
});
