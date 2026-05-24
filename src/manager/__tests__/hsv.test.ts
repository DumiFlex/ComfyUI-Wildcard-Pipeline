import { describe, expect, it } from "vitest";
import { hexToHsv, hexToRgb, hsvToHex, hsvToRgb, rgbToHex, rgbToHsv } from "../../components/shared/hsv";

describe("hsv utilities", () => {
  describe("hexToRgb", () => {
    it("parses 6-digit hex with leading #", () => {
      expect(hexToRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb("#00ff00")).toEqual({ r: 0, g: 255, b: 0 });
      expect(hexToRgb("#0000ff")).toEqual({ r: 0, g: 0, b: 255 });
    });
    it("parses 6-digit hex without #", () => {
      expect(hexToRgb("abcdef")).toEqual({ r: 0xab, g: 0xcd, b: 0xef });
    });
    it("returns null for invalid input", () => {
      expect(hexToRgb("xyz")).toBeNull();
      expect(hexToRgb("#fff")).toBeNull(); // 3-digit not supported
      expect(hexToRgb("")).toBeNull();
    });
  });

  describe("rgbToHex", () => {
    it("formats lowercase 6-digit hex with leading #", () => {
      expect(rgbToHex({ r: 255, g: 0, b: 0 })).toBe("#ff0000");
      expect(rgbToHex({ r: 18, g: 52, b: 86 })).toBe("#123456");
    });
    it("clamps out-of-range channels", () => {
      expect(rgbToHex({ r: 300, g: -5, b: 128 })).toBe("#ff0080");
    });
  });

  describe("rgbToHsv / hsvToRgb round-trip", () => {
    it("red → h=0, s=1, v=1", () => {
      const hsv = rgbToHsv({ r: 255, g: 0, b: 0 });
      expect(hsv.h).toBe(0);
      expect(hsv.s).toBeCloseTo(1, 5);
      expect(hsv.v).toBeCloseTo(1, 5);
    });
    it("green → h=120", () => {
      const hsv = rgbToHsv({ r: 0, g: 255, b: 0 });
      expect(hsv.h).toBeCloseTo(120, 1);
    });
    it("blue → h=240", () => {
      const hsv = rgbToHsv({ r: 0, g: 0, b: 255 });
      expect(hsv.h).toBeCloseTo(240, 1);
    });
    it("black → s=0, v=0 (hue undefined; we return 0)", () => {
      const hsv = rgbToHsv({ r: 0, g: 0, b: 0 });
      expect(hsv.v).toBe(0);
      expect(hsv.s).toBe(0);
    });
    it("round-trips through hsv → rgb → hsv for non-trivial color", () => {
      const start = { r: 124, g: 58, b: 237 }; // #7c3aed
      const hsv = rgbToHsv(start);
      const back = hsvToRgb(hsv);
      expect(back.r).toBe(start.r);
      expect(back.g).toBe(start.g);
      expect(back.b).toBe(start.b);
    });
  });

  describe("hexToHsv / hsvToHex", () => {
    it("round-trips through hex for brand presets", () => {
      const presets = ["#7c3aed", "#34d399", "#22d3ee", "#fbbf24", "#ef4444"];
      for (const hex of presets) {
        const hsv = hexToHsv(hex);
        expect(hsv).not.toBeNull();
        expect(hsvToHex(hsv!)).toBe(hex);
      }
    });
    it("hexToHsv returns null for invalid input", () => {
      expect(hexToHsv("not-a-color")).toBeNull();
    });
  });

  describe("hsvToRgb edge cases", () => {
    it("wraps negative hue around 360", () => {
      const a = hsvToRgb({ h: -60, s: 1, v: 1 });
      const b = hsvToRgb({ h: 300, s: 1, v: 1 });
      expect(a).toEqual(b);
    });
    it("clamps out-of-range s and v", () => {
      const sat0 = hsvToRgb({ h: 0, s: -5, v: 1 });
      expect(sat0).toEqual({ r: 255, g: 255, b: 255 }); // white at s=0
      const dark = hsvToRgb({ h: 0, s: 1, v: 2 });
      expect(dark).toEqual({ r: 255, g: 0, b: 0 }); // clamps to v=1 → red
    });
  });
});
