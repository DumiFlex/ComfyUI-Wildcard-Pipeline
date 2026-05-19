import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import RefChip from "./RefChip.vue";

describe("RefChip", () => {
  it("renders var kind with $name + green palette", () => {
    const wrap = mount(RefChip, {
      props: { kind: "var", name: "person", resolved: true },
    });
    expect(wrap.text()).toContain("$person");
    expect(wrap.classes()).toContain("wp-refchip");
    expect(wrap.classes()).toContain("wp-refchip--var");
    expect(wrap.classes()).not.toContain("wp-refchip--unresolved");
  });

  it("renders ref kind with @name + purple palette", () => {
    const wrap = mount(RefChip, {
      props: { kind: "ref", name: "color", uuid: "aabbccdd", resolved: true },
    });
    expect(wrap.text()).toContain("@color");
    expect(wrap.classes()).toContain("wp-refchip--ref");
  });

  it("renders sub-category suffix when present", () => {
    const wrap = mount(RefChip, {
      props: {
        kind: "ref", name: "color", uuid: "aabbccdd", resolved: true,
        subCategories: ["warm", "cool"],
      },
    });
    expect(wrap.text()).toMatch(/@color.*warm.*cool/);
    expect(wrap.classes()).toContain("wp-refchip--filtered");
  });

  it("renders unresolved ref as red ? chip with uuid visible", () => {
    const wrap = mount(RefChip, {
      props: { kind: "ref", name: "", uuid: "deadbeef", resolved: false },
    });
    expect(wrap.text()).toContain("?");
    expect(wrap.text()).toContain("deadbeef");
    expect(wrap.classes()).toContain("wp-refchip--unresolved");
  });

  it("emits click on ref-kind chip body", async () => {
    const wrap = mount(RefChip, {
      props: { kind: "ref", name: "color", uuid: "aabbccdd", resolved: true },
    });
    await wrap.trigger("click");
    expect(wrap.emitted("click")).toBeTruthy();
  });

  it("var-kind chip does not emit click on click (no edit affordance)", async () => {
    const wrap = mount(RefChip, {
      props: { kind: "var", name: "person", resolved: true },
    });
    await wrap.trigger("click");
    expect(wrap.emitted("click")).toBeFalsy();
  });
});
