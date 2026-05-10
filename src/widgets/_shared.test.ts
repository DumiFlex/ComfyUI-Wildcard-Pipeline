import { describe, it, expect } from "vitest";
import {
  emptyInjectorRowsValue,
  parseWidgetJsonWithRecovery,
  type InjectorRowsValue,
} from "./_shared";

describe("emptyInjectorRowsValue", () => {
  it("returns version 1 + empty rows array", () => {
    expect(emptyInjectorRowsValue()).toEqual({ version: 1, rows: [] });
  });
});

describe("parseWidgetJsonWithRecovery for InjectorRowsValue", () => {
  it("parses well-formed rows", () => {
    const json = JSON.stringify({
      version: 1,
      rows: [
        { _uid: "abc", slot_name: "input_0", binding: "x", enabled: true, internal: false },
      ],
    });
    const parsed = parseWidgetJsonWithRecovery<InjectorRowsValue>(json, emptyInjectorRowsValue());
    expect(parsed.value.rows).toHaveLength(1);
    expect(parsed.value.rows[0].binding).toBe("x");
  });

  it("recovers to empty on malformed JSON", () => {
    const parsed = parseWidgetJsonWithRecovery<InjectorRowsValue>(
      "{not json",
      emptyInjectorRowsValue(),
    );
    expect(parsed.value).toEqual(emptyInjectorRowsValue());
  });
});
