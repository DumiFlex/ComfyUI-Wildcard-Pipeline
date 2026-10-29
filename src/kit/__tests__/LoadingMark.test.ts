import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import LoadingMark from "../LoadingMark.vue";

describe("LoadingMark", () => {
  it("is a status named Loading on its own", () => {
    const w = mount(LoadingMark);
    const root = w.get("[data-test='loading-mark']");
    expect(root.attributes("role")).toBe("status");
    expect(root.attributes("aria-label")).toBe("Loading");
    expect(w.get("svg").attributes("width")).toBe("14");
  });

  it("lets slot text name it", () => {
    const w = mount(LoadingMark, { props: { block: true, size: 40 }, slots: { default: "Loading bundle…" } });
    const root = w.get("[data-test='loading-mark']");
    expect(root.attributes("aria-label")).toBeUndefined();
    expect(root.classes()).toContain("wp-lm--block");
    expect(w.text()).toContain("Loading bundle…");
  });

  it("hides from screen readers when decorative", () => {
    const root = mount(LoadingMark, { props: { decorative: true } }).get("[data-test='loading-mark']");
    expect(root.attributes("role")).toBeUndefined();
    expect(root.attributes("aria-hidden")).toBe("true");
  });

  it("gives every mark its own gradient ids", () => {
    const a = mount(LoadingMark, { props: { block: true } }).get("linearGradient").attributes("id");
    const b = mount(LoadingMark, { props: { block: true } }).get("linearGradient").attributes("id");
    expect(a).not.toBe(b);
  });

  it("draws the sparkle inline and the full logo as a block", () => {
    expect(mount(LoadingMark).get("svg").attributes("data-variant")).toBe("sparkle");
    const block = mount(LoadingMark, { props: { block: true } }).get("svg");
    expect(block.attributes("data-variant")).toBe("logo");
    expect(block.attributes("width")).toBe("40");
    expect(mount(LoadingMark, { props: { size: 32 } }).get("svg").attributes("data-variant")).toBe("logo");
    expect(mount(LoadingMark, { props: { block: true, variant: "sparkle" } }).get("svg").attributes("data-variant")).toBe("sparkle");
  });

  it("draws in the text colour when mono", () => {
    const w = mount(LoadingMark, { props: { mono: true } });
    expect(w.findAll("path").every((p) => p.attributes("fill") === "currentColor")).toBe(true);
  });
});
