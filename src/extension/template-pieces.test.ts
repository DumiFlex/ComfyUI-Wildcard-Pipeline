import { describe, expect, it } from "vitest";
import { templatePieces, templateVarReads } from "./template-pieces";

const text = (t: string): string =>
  templatePieces(t).map((p) => (p.kind === "text" ? p.text : p.kind === "pick" ? `[${p.raw}]` : `<${p.raw}>`)).join("");

describe("templatePieces", () => {
  it("prints $$ as one $ and @@ as one @", () => {
    expect(text("on a $$5 coin")).toBe("on a $5 coin");
    expect(text("mail me @@home")).toBe("mail me @home");
  });

  it("never reads a variable after an escape", () => {
    expect(text("$$role")).toBe("$role");
    expect(templateVarReads("$$role")).toEqual([]);
  });

  it("reads the variable right after an escaped $", () => {
    expect(text("$$$price each")).toBe("$<$price> each");
    expect(templateVarReads("$$$price").map((r) => r.name)).toEqual(["price"]);
  });

  it("keeps accessors on a read", () => {
    expect(text("$o.0.SHOES and $c.HAIR.1")).toBe("<$o.0.SHOES> and <$c.HAIR.1>");
  });

  it("keeps a pick as written, its own $$ included", () => {
    expect(text("{2$$, $$a|b} and {2$$a|b}")).toBe("[{2$$, $$a|b}] and [{2$$a|b}]");
    expect(text("{a $$5|b} $$1")).toBe("[{a $$5|b}] $1");
    expect(templateVarReads("{2$$a|b}")).toEqual([]);
    expect(templateVarReads("{$x|y}").map((r) => r.name)).toEqual(["x"]);
  });

  it("reads a brace that is no pick as plain text", () => {
    expect(text("{ $$5 } and { $x")).toBe("{ $5 } and { <$x>");
    expect(text("{{ $x }}")).toBe("{{ <$x> }}");
  });
});
