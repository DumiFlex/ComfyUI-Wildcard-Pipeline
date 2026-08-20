/**
 * A var chip's accessor is TWO different things: a pick index (`.0`) and a
 * tag axis (`.SHOES`). They must not share styling — the index is positional
 * and, being a runtime-only concept, is nothing the editor can validate, so
 * tinting it the axis accent read to users as "your index is flagged".
 */
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import RefChip from "./RefChip.vue";

const AXES = [{ axis: "SHOES", tags: ["sneakers"], hueIndex: 0 }];

describe("RefChip — accessor index vs axis styling", () => {
  it("renders the pick index in its own NEUTRAL span, not the axis accent", () => {
    const w = mount(RefChip, {
      props: { kind: "var", name: "outfit", resolved: true, index: 0 },
    });
    expect(w.find(".wp-refchip__index").exists()).toBe(true);
    expect(w.find(".wp-refchip__index").text()).toBe(".0");
    // No axis part → no amber accessor span at all.
    expect(w.find(".wp-refchip__accessor").exists()).toBe(false);
  });

  it("renders index and axis as SEPARATE spans for `$outfit.0.SHOES`", () => {
    const w = mount(RefChip, {
      props: {
        kind: "var", name: "outfit", resolved: true,
        index: 0, axis: "SHOES", axisKnown: true,
      },
    });
    expect(w.find(".wp-refchip__index").text()).toBe(".0");
    expect(w.find(".wp-refchip__accessor").text()).toBe(".SHOES");
    // The index is NOT inside the amber accessor span.
    expect(w.find(".wp-refchip__accessor").text()).not.toContain(".0");
  });

  it("marks only the axis unknown — never the index", () => {
    const w = mount(RefChip, {
      props: {
        kind: "var", name: "outfit", resolved: true,
        index: 0, axis: "BELTS", axisKnown: false,
      },
    });
    expect(w.find(".wp-refchip__accessor--unknown").exists()).toBe(true);
    // A bare index with no axis is never unknown-styled.
    const w2 = mount(RefChip, {
      props: { kind: "var", name: "outfit", resolved: true, index: 0 },
    });
    expect(w2.find(".wp-refchip__accessor--unknown").exists()).toBe(false);
  });

  it("still shows the axis alone (no index) in the amber span", () => {
    const w = mount(RefChip, {
      props: {
        kind: "var", name: "outfit", resolved: true, axis: "SHOES", axisKnown: true,
      },
    });
    expect(w.find(".wp-refchip__index").exists()).toBe(false);
    expect(w.find(".wp-refchip__accessor").text()).toBe(".SHOES");
  });

  void AXES;
});
