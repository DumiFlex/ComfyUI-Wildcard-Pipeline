import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import RefChip from "./RefChip.vue";

describe("RefChip — remap vs click emit split", () => {
  it("an UNRESOLVED ref chip emits remap and NOT click", async () => {
    const w = mount(RefChip, {
      props: { kind: "ref", name: "colour", uuid: "deadbeef", resolved: false },
    });
    await w.find(".wp-refchip").trigger("click");
    expect(w.emitted("remap")).toBeTruthy();
    expect(w.emitted("click")).toBeFalsy();
  });

  it("a RESOLVED ref chip emits click and NOT remap", async () => {
    const w = mount(RefChip, {
      props: { kind: "ref", name: "colour", uuid: "deadbeef", resolved: true },
    });
    await w.find(".wp-refchip").trigger("click");
    expect(w.emitted("click")).toBeTruthy();
    expect(w.emitted("remap")).toBeFalsy();
  });

  it("a var chip emits neither", async () => {
    const w = mount(RefChip, {
      props: { kind: "var", name: "mood", resolved: true },
    });
    await w.find(".wp-refchip").trigger("click");
    expect(w.emitted("click")).toBeFalsy();
    expect(w.emitted("remap")).toBeFalsy();
  });
});
