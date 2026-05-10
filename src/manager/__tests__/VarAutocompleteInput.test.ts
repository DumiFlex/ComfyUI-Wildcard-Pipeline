// VarAutocompleteInput — single-line var name input with custom
// dropdown matching RichTextInput's popover style. Coverage focuses
// on UX edge cases that surfaced post-ship: dropdown reopening after
// Enter-select, focus restoration, prefix filtering.

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import VarAutocompleteInput from "../components/VarAutocompleteInput.vue";

// Disable Teleport so the popover lands inside the wrapper DOM where
// VTU finds it via wrapper.find. Without this stub the popover
// teleports to body and is invisible to the test wrapper.
const mountOpts = { global: { stubs: { teleport: true } } } as const;

describe("VarAutocompleteInput", () => {
  it("renders the inner input with model value + placeholder", () => {
    const wrap = mount(VarAutocompleteInput, {
      ...mountOpts,
      props: {
        modelValue: "age",
        suggestions: ["age", "color", "mood"],
        placeholder: "variable",
      },
    });
    const input = wrap.find<HTMLInputElement>("input");
    expect(input.element.value).toBe("age");
    expect(input.element.placeholder).toBe("variable");
  });

  it("opens the dropdown on focus when suggestions exist", async () => {
    const wrap = mount(VarAutocompleteInput, {
      ...mountOpts,
      props: { modelValue: "", suggestions: ["age", "color"] },
    });
    expect(wrap.find(".wp-rt-suggestions").exists()).toBe(false);
    await wrap.find("input").trigger("focus");
    expect(wrap.find(".wp-rt-suggestions").exists()).toBe(true);
  });

  it("filters suggestions by case-insensitive substring on input", async () => {
    const wrap = mount(VarAutocompleteInput, {
      ...mountOpts,
      props: {
        modelValue: "co",
        suggestions: ["age", "color", "comment", "mood"],
      },
    });
    await wrap.find("input").trigger("focus");
    const items = wrap.findAll(".wp-rt-suggestions__item");
    // "co" matches "color" + "comment" via substring filter.
    expect(items.length).toBe(2);
    expect(items[0].text()).toContain("color");
    expect(items[1].text()).toContain("comment");
  });

  it("emits update:modelValue with selected label on Enter", async () => {
    const wrap = mount(VarAutocompleteInput, {
      ...mountOpts,
      props: { modelValue: "", suggestions: ["age", "color"] },
    });
    const input = wrap.find("input");
    await input.trigger("focus");
    await input.trigger("keydown", { key: "Enter" });
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events.length).toBe(1);
    expect(events[0][0]).toBe("age");
  });

  it("reopens dropdown when user types after selecting via Enter", async () => {
    // Regression — after Enter closes the popover, the dropdown must
    // reopen on subsequent input events so the user can keep
    // refining. Earlier impl checked `open.value` and only
    // repositioned, never reopening, which left users stuck typing
    // into a blank input with no autocomplete.
    const wrap = mount(VarAutocompleteInput, {
      ...mountOpts,
      props: { modelValue: "", suggestions: ["age", "color"] },
    });
    const input = wrap.find<HTMLInputElement>("input");
    await input.trigger("focus");
    await input.trigger("keydown", { key: "Enter" });
    // Popover closed after Enter.
    expect(wrap.find(".wp-rt-suggestions").exists()).toBe(false);

    // Simulate user typing more characters into the same input.
    input.element.value = "ag";
    await input.trigger("input");
    await nextTick();
    // Popover reopens with filtered matches.
    expect(wrap.find(".wp-rt-suggestions").exists()).toBe(true);
  });

  it("Escape closes dropdown but typing reopens it", async () => {
    const wrap = mount(VarAutocompleteInput, {
      ...mountOpts,
      props: { modelValue: "", suggestions: ["age", "color"] },
    });
    const input = wrap.find<HTMLInputElement>("input");
    await input.trigger("focus");
    expect(wrap.find(".wp-rt-suggestions").exists()).toBe(true);
    await input.trigger("keydown", { key: "Escape" });
    expect(wrap.find(".wp-rt-suggestions").exists()).toBe(false);

    input.element.value = "a";
    await input.trigger("input");
    await nextTick();
    expect(wrap.find(".wp-rt-suggestions").exists()).toBe(true);
  });

  it("does NOT open dropdown when suggestions list is empty", async () => {
    const wrap = mount(VarAutocompleteInput, {
      ...mountOpts,
      props: { modelValue: "", suggestions: [] },
    });
    await wrap.find("input").trigger("focus");
    expect(wrap.find(".wp-rt-suggestions").exists()).toBe(false);
  });
});
