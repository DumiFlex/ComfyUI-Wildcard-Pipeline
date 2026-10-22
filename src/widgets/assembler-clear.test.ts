import { describe, expect, it } from "vitest";
import { clearTemplate } from "./assembler";

describe("Assembler Clear template", () => {
  it("empties the negative template too", () => {
    const node = { widgets: [{ name: "template", value: "$mood" }, { name: "negative_template", value: "blurry" }] };
    clearTemplate(node as unknown as Parameters<typeof clearTemplate>[0]);
    expect(node.widgets.map((w) => w.value)).toEqual(["", ""]);
  });
});
