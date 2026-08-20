import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import RichTextInput from "./RichTextInput.vue";

/**
 * Fill mode: the NODE's corner is the only resize control.
 *
 * Two authorities over one box produced both reported failures — a drag that
 * never ended and stayed glued to the cursor, and a node that fought the editor
 * over its height. Three rounds of arbitrating between them each fixed a real
 * defect and none fixed the symptom. This removes the second authority.
 */
describe("RichTextInput — fill mode", () => {
  const mountFill = (fill: boolean) =>
    mount(RichTextInput, {
      props: { modelValue: "a template", surface: "assembler", multiline: true, fill },
    });

  it("offers no resize grip — there is only one resize control now", () => {
    expect(mountFill(true).find('[data-test="rt-grip"]').exists()).toBe(false);
  });

  it("keeps the grip everywhere else, where nothing else can size the box", () => {
    // The SPA's modals and pages have no node corner to drag.
    expect(mountFill(false).find('[data-test="rt-grip"]').exists()).toBe(true);
  });

  it("marks the root so the fill CSS applies", () => {
    // `min-height: 0` on this element is load-bearing: it and the host are both
    // flex items, and a flex item defaults to `min-height: auto`, which refuses
    // to shrink below its content — which is precisely how the template used to
    // push the node taller and refuse to be dragged back down.
    expect(mountFill(true).get(".wp-rt").classes()).toContain("wp-rt--fill");
    expect(mountFill(false).get(".wp-rt").classes()).not.toContain("wp-rt--fill");
  });
});
