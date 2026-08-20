import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import RichTextInput from "./RichTextInput.vue";

/**
 * Clicking away must close the suggestion popover.
 *
 * The dismiss listener was `mousedown`-only, which never fired for clicks on
 * the litegraph canvas: litegraph drives the canvas from pointer events and
 * calls `preventDefault()` on `pointerdown`, and a prevented `pointerdown`
 * suppresses the browser's compatibility `mousedown`. On a node graph the
 * canvas is most of the screen, so the popover read as never closing.
 *
 * These drive `pointerdown` specifically — the event a canvas click is
 * guaranteed to deliver.
 */
describe("RichTextInput — outside press dismisses the popover", () => {
  type Exposed = { __triggerAutocompleteForTest: (t: "@" | "$") => void };

  /** Mounted with a var to suggest, popover already open. */
  async function openPopover() {
    const w = mount(RichTextInput, {
      props: {
        modelValue: "",
        surface: "assembler",
        multiline: true,
        varSuggestions: ["style", "mood"],
      },
      attachTo: document.body,
    });
    await w.vm.$nextTick();
    (w.vm as unknown as Exposed).__triggerAutocompleteForTest("$");
    await w.vm.$nextTick();
    return w;
  }

  const popoverPresent = () => document.querySelectorAll(".wp-rt-suggestions").length > 0;

  const press = (target: EventTarget, type: "pointerdown" | "mousedown") =>
    target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));

  it("closes on a pointerdown outside, the event a canvas click always delivers", async () => {
    const w = await openPopover();
    expect(popoverPresent()).toBe(true);

    // Stand-in for the litegraph canvas: an element that is neither the input
    // nor the popover.
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    press(outside, "pointerdown");
    await w.vm.$nextTick();

    expect(popoverPresent()).toBe(false);
    outside.remove();
    w.unmount();
  });

  it("still closes on a bare mousedown, for hosts with no PointerEvent", async () => {
    const w = await openPopover();
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    press(outside, "mousedown");
    await w.vm.$nextTick();

    expect(popoverPresent()).toBe(false);
    outside.remove();
    w.unmount();
  });

  it("does NOT close when the press lands inside the popover", async () => {
    // Rows commit on mousedown and the scrollbar is draggable; dismissing on a
    // press inside would make both unusable.
    const w = await openPopover();
    const pop = document.querySelector(".wp-rt-suggestions");
    expect(pop).toBeTruthy();
    press(pop as Element, "pointerdown");
    await w.vm.$nextTick();

    expect(popoverPresent()).toBe(true);
    w.unmount();
  });

  it("does NOT close when the press lands inside the editor itself", async () => {
    const w = await openPopover();
    press(w.get(".wp-rt__host").element, "pointerdown");
    await w.vm.$nextTick();

    expect(popoverPresent()).toBe(true);
    w.unmount();
  });
});
