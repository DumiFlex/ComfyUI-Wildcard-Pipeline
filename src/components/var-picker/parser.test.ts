import { describe, it, expect } from "vitest";
import fixture from "../../../tests/fixtures/converter_cases.json";
import { parseInt as parseIntStr, parseFloat as parseFloatStr, parseBool } from "./parser";

describe("parser parity", () => {
  describe("parseInt", () => {
    for (const c of fixture.parse_int) {
      it(`${JSON.stringify(c.text)} @ ${c.index} -> ${c.expected}`, () => {
        expect(parseIntStr(c.text, c.index, c.default)).toBe(c.expected);
      });
    }
  });

  describe("parseFloat", () => {
    for (const c of fixture.parse_float) {
      it(`${JSON.stringify(c.text)} @ ${c.index} -> ${c.expected}`, () => {
        expect(parseFloatStr(c.text, c.index, c.default)).toBeCloseTo(c.expected, 8);
      });
    }
  });

  describe("parseBool", () => {
    for (const c of fixture.parse_bool) {
      it(`${JSON.stringify(c.text)} @ ${c.index} -> ${c.expected}`, () => {
        expect(parseBool(c.text, c.index, c.default)).toBe(c.expected);
      });
    }
  });
});
