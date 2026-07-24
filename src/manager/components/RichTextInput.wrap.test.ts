import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import RichTextInput from "./RichTextInput.vue";

// Workstream C / issue #2: single-value surfaces opt into wrap+auto-grow via
// the `wrap` prop, so long override values are visible instead of clipped
// behind a horizontal scroll. The class is what the CSS auto-grow hangs off.
describe("RichTextInput — wrap mode", () => {
  it("applies wp-rt__host--wrap on a single-line host when wrap is set", async () => {
    const w = mount(RichTextInput, {
      props: { modelValue: "$pose_standing, a very long overriding value", wrap: true },
    });
    await w.vm.$nextTick();
    const host = w.get(".wp-rt__host");
    expect(host.classes()).toContain("wp-rt__host--single");
    expect(host.classes()).toContain("wp-rt__host--wrap");
  });

  it("does not apply wrap by default (stays clipped single-line)", async () => {
    const w = mount(RichTextInput, { props: { modelValue: "x" } });
    await w.vm.$nextTick();
    expect(w.get(".wp-rt__host").classes()).not.toContain("wp-rt__host--wrap");
  });

  it("ignores wrap when multiline is already on (multiline governs height)", async () => {
    const w = mount(RichTextInput, { props: { modelValue: "x", wrap: true, multiline: true } });
    await w.vm.$nextTick();
    const host = w.get(".wp-rt__host");
    expect(host.classes()).toContain("wp-rt__host--multi");
    expect(host.classes()).not.toContain("wp-rt__host--wrap");
  });
});
