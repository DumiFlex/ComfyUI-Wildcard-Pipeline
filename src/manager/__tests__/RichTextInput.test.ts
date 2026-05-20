import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import RichTextInput from "../components/RichTextInput.vue";
import RichTextPreview from "../components/RichTextPreview.vue";

describe("RichTextInput.vue", () => {
  it("renders bound value as text+chip atoms inside the host", () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "$person walks", varSuggestions: ["person"] },
    });
    const host = wrap.find(".wp-rt__host");
    expect(host.exists()).toBe(true);
    expect(host.text()).toContain("$person");
    expect(host.text()).toContain("walks");
  });

  it("emits update:modelValue with serialised raw text after host input", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "hello", varSuggestions: [] },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host");
    // Simulate the user typing — browsers extend the existing text span's
    // textContent rather than inserting sibling text nodes.
    const span = (host.element as HTMLElement).querySelector(".wp-rt__text");
    if (span) span.textContent = "hellox";
    await host.trigger("input");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("hellox");
    wrap.unmount();
  });

  it("readHostAsText reconstructs ref/var chips from atom truth, not display text", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "a @{aabbccdd:warm} b",
        varSuggestions: [],
        uuidToName: new Map([["aabbccdd", "color"]]),
      },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host");
    // Simulate user editing the trailing " b" text — typing "z" at end.
    const spans = (host.element as HTMLElement).querySelectorAll(".wp-rt__text");
    // Trailing text is the last wp-rt__text span.
    const trailing = spans[spans.length - 1];
    trailing.textContent = " bz";
    await host.trigger("input");
    const events = wrap.emitted("update:modelValue") ?? [];
    // Expect the raw form preserved + the trailing edit captured.
    expect(events[events.length - 1]?.[0]).toBe("a @{aabbccdd:warm} bz");
    wrap.unmount();
  });

  it("multiline=true sets data-multiline + wp-rt--multi on the host (no textarea)", () => {
    // Multiline mode used to swap the input for a <textarea>; now it's a
    // single contenteditable host with a data attribute + size variant.
    const wrap = mount(RichTextInput, {
      props: { modelValue: "line1\nline2", multiline: true, rows: 6 },
    });
    expect(wrap.find("textarea").exists()).toBe(false);
    const host = wrap.find(".wp-rt__host");
    expect(host.attributes("data-multiline")).toBe("true");
    expect(host.attributes("aria-multiline")).toBe("true");
    expect(host.classes()).toContain("wp-rt__host--multi");
    expect(wrap.find(".wp-rt").classes()).toContain("wp-rt--multi");
  });

  it("renders RefChip atoms for $var/@{uuid}/@{uuid:subcat} tokens", () => {
    // `varSuggestions` opts the `$person` var into resolved state so its
    // chip renders `$person` instead of the unresolved `?person` fallback.
    // `uuidToName` resolves `aabbccdd` → `color`; `deadbeef` stays unresolved.
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "$person sees @{aabbccdd} and @{deadbeef:warm} of {red|blue}",
        varSuggestions: ["person"],
        uuidToName: new Map([["aabbccdd", "color"]]),
      },
    });
    const chips = wrap.findAll(".wp-refchip");
    // var + 2 refs = 3 chips; {red|blue} stays as text in this model
    expect(chips.length).toBe(3);
    expect(chips[0].text()).toContain("$person");
    expect(chips[1].text()).toContain("@color");
    expect(chips[2].text()).toContain("?");  // deadbeef unresolved
    expect(chips[2].text()).toContain("deadbeef");
  });

  it("renders $$ escapes as literal text without classifying as a var chip", () => {
    // `$$` is an escape token in the tokenizer — atomicEditorModel collapses
    // it back into the text buffer rather than lifting it into a var atom.
    // The host should therefore render NO var chip for `$$literal`.
    const wrap = mount(RichTextInput, {
      props: { modelValue: "$$literal", varSuggestions: ["literal"] },
    });
    expect(wrap.findAll(".wp-refchip--var")).toHaveLength(0);
    expect(wrap.findAll(".wp-refchip")).toHaveLength(0);
    // The raw `$$` survives in the rendered text — atoms preserve the
    // original characters even though they're escape tokens.
    expect(wrap.find(".wp-rt__host").text()).toContain("$$literal");
  });

  // OBSOLETE (task-19 confirmed): Comment token kind was removed in the locked
  // grammar. `# lines` are now plain text. Keeping the skip so the intent is
  // visible in git history — the assertion can never pass with the current
  // tokenizer.
  it.skip("renders # comment lines greyed out [OBSOLETE — comment syntax removed]", () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "# noted", multiline: true },
    });
    expect(wrap.find(".wp-rt__mirror").html()).toContain("wp-rt-comment");
  });

  it("toggles wp-rt--focused class on host focus/blur", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "" },
      attachTo: document.body,
    });
    const root = wrap.find(".wp-rt");
    // Rest state — `wp-rt--rest` is on, `wp-rt--focused` is off.
    expect(root.classes()).toContain("wp-rt--rest");
    expect(root.classes()).not.toContain("wp-rt--focused");
    await wrap.find(".wp-rt__host").trigger("focus");
    expect(root.classes()).toContain("wp-rt--focused");
    expect(root.classes()).not.toContain("wp-rt--rest");
    await wrap.find(".wp-rt__host").trigger("blur");
    expect(root.classes()).not.toContain("wp-rt--focused");
    expect(root.classes()).toContain("wp-rt--rest");
    wrap.unmount();
  });

  it("forwards aria-label + disabled onto the contenteditable host", () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "hi",
        ariaLabel: "Template body",
        disabled: true,
      },
    });
    const host = wrap.find(".wp-rt__host");
    expect(host.attributes("aria-label")).toBe("Template body");
    // Disabled toggles `contenteditable="false"` so the caret can't enter
    // the host. The wrapper also picks up `wp-rt--disabled` for styling.
    expect(host.attributes("contenteditable")).toBe("false");
    expect(wrap.find(".wp-rt").classes()).toContain("wp-rt--disabled");
  });

  // --- Task 7: autocomplete pick routes through SubcategoryFilterPicker ---
  // These tests drive the autocomplete state machine via test seams
  // (`__triggerAutocompleteForTest`, `__applyAutocompleteForTest`) exposed
  // via `defineExpose` rather than faking keyboard events (which are flaky
  // under jsdom).

  it("opens SubcategoryFilterPicker after picking an @ ref with sub-categories", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "",
        surface: "wildcard",
        refSuggestions: ["aabbccdd"],
        uuidToName: new Map([["aabbccdd", "color"]]),
        uuidToSubCategories: new Map([["aabbccdd", ["warm", "cool"]]]),
      },
      attachTo: document.body,
    });
    // Force open the autocomplete state at `@` (test seam — directly toggle
    // the internal trigger; the real-world path is via keyboard).
    await (wrap.vm as unknown as { __triggerAutocompleteForTest: (t: "@" | "$") => Promise<void> })
      .__triggerAutocompleteForTest("@");
    // Pick the first suggestion.
    await (wrap.vm as unknown as { __applyAutocompleteForTest: (label: string) => Promise<void> })
      .__applyAutocompleteForTest("aabbccdd");
    // Picker should now be open.
    expect(document.querySelector('[data-test="subcat-picker"]')).not.toBeNull();
    wrap.unmount();
  });

  it("inserts unfiltered ref atom when wildcard has no sub-categories", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "",
        surface: "wildcard",
        refSuggestions: ["aabbccdd"],
        uuidToName: new Map([["aabbccdd", "outfit"]]),
        // No entry in uuidToSubCategories → empty array → skip picker.
        uuidToSubCategories: new Map([["aabbccdd", []]]),
      },
      attachTo: document.body,
    });
    await (wrap.vm as unknown as { __triggerAutocompleteForTest: (t: "@" | "$") => Promise<void> })
      .__triggerAutocompleteForTest("@");
    await (wrap.vm as unknown as { __applyAutocompleteForTest: (label: string) => Promise<void> })
      .__applyAutocompleteForTest("aabbccdd");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("@{aabbccdd}");
    expect(document.querySelector('[data-test="subcat-picker"]')).toBeNull();
    wrap.unmount();
  });

  it("subcat picker Apply with selection inserts @{uuid:warm} chip", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "",
        surface: "wildcard",
        refSuggestions: ["aabbccdd"],
        uuidToName: new Map([["aabbccdd", "color"]]),
        uuidToSubCategories: new Map([["aabbccdd", ["warm", "cool"]]]),
      },
      attachTo: document.body,
    });
    await (wrap.vm as unknown as { __triggerAutocompleteForTest: (t: "@" | "$") => Promise<void> })
      .__triggerAutocompleteForTest("@");
    await (wrap.vm as unknown as { __applyAutocompleteForTest: (label: string) => Promise<void> })
      .__applyAutocompleteForTest("aabbccdd");
    // Click "warm" then Apply.
    (document.querySelector('[data-test="subcat-chip"][data-value="warm"]') as HTMLElement).click();
    await flushPromises();
    (document.querySelector('[data-test="picker-apply"]') as HTMLElement).click();
    await flushPromises();
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("@{aabbccdd:warm}");
    expect(document.querySelector('[data-test="subcat-picker"]')).toBeNull();
    wrap.unmount();
  });

  it("subcat picker Skip inserts plain @{uuid} chip", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "",
        surface: "wildcard",
        refSuggestions: ["aabbccdd"],
        uuidToName: new Map([["aabbccdd", "color"]]),
        uuidToSubCategories: new Map([["aabbccdd", ["warm", "cool"]]]),
      },
      attachTo: document.body,
    });
    await (wrap.vm as unknown as { __triggerAutocompleteForTest: (t: "@" | "$") => Promise<void> })
      .__triggerAutocompleteForTest("@");
    await (wrap.vm as unknown as { __applyAutocompleteForTest: (label: string) => Promise<void> })
      .__applyAutocompleteForTest("aabbccdd");
    (document.querySelector('[data-test="picker-skip"]') as HTMLElement).click();
    await flushPromises();
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("@{aabbccdd}");
    wrap.unmount();
  });

  it("backdrop click cancels picker without inserting", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "",
        surface: "wildcard",
        refSuggestions: ["aabbccdd"],
        uuidToName: new Map([["aabbccdd", "color"]]),
        uuidToSubCategories: new Map([["aabbccdd", ["warm"]]]),
      },
      attachTo: document.body,
    });
    await (wrap.vm as unknown as { __triggerAutocompleteForTest: (t: "@" | "$") => Promise<void> })
      .__triggerAutocompleteForTest("@");
    await (wrap.vm as unknown as { __applyAutocompleteForTest: (label: string) => Promise<void> })
      .__applyAutocompleteForTest("aabbccdd");
    // Picker is open.
    expect(document.querySelector('[data-test="subcat-picker"]')).not.toBeNull();
    // Click backdrop (the overlay div, not the picker contents).
    const overlay = document.querySelector(".wp-subcat-picker__overlay") as HTMLElement;
    overlay.click();
    await flushPromises();
    // Picker closed, no chip inserted.
    expect(document.querySelector('[data-test="subcat-picker"]')).toBeNull();
    // No update:modelValue with a ref chip was emitted.
    const events = wrap.emitted("update:modelValue") ?? [];
    const hasInsert = events.some((e) => String(e[0]).includes("@{aabbccdd"));
    expect(hasInsert).toBe(false);
    wrap.unmount();
  });

  it("Escape key cancels picker without inserting", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "",
        surface: "wildcard",
        refSuggestions: ["aabbccdd"],
        uuidToName: new Map([["aabbccdd", "color"]]),
        uuidToSubCategories: new Map([["aabbccdd", ["warm"]]]),
      },
      attachTo: document.body,
    });
    await (wrap.vm as unknown as { __triggerAutocompleteForTest: (t: "@" | "$") => Promise<void> })
      .__triggerAutocompleteForTest("@");
    await (wrap.vm as unknown as { __applyAutocompleteForTest: (label: string) => Promise<void> })
      .__applyAutocompleteForTest("aabbccdd");
    expect(document.querySelector('[data-test="subcat-picker"]')).not.toBeNull();
    // Dispatch Escape on window.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(document.querySelector('[data-test="subcat-picker"]')).toBeNull();
    const events = wrap.emitted("update:modelValue") ?? [];
    const hasInsert = events.some((e) => String(e[0]).includes("@{aabbccdd"));
    expect(hasInsert).toBe(false);
    wrap.unmount();
  });

  it("$var autocomplete pick inserts $var atom directly (no picker)", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "",
        surface: "combine",  // $var allowed surface
        varSuggestions: ["person"],
      },
      attachTo: document.body,
    });
    await (wrap.vm as unknown as { __triggerAutocompleteForTest: (t: "@" | "$") => Promise<void> })
      .__triggerAutocompleteForTest("$");
    await (wrap.vm as unknown as { __applyAutocompleteForTest: (label: string) => Promise<void> })
      .__applyAutocompleteForTest("person");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("$person");
    expect(document.querySelector('[data-test="subcat-picker"]')).toBeNull();
    wrap.unmount();
  });

  // --- Task 8: click-to-edit ref chip opens picker in edit mode ---

  it("opens picker in edit mode when clicking a ref chip", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "hi @{aabbccdd:warm} foo",
        surface: "wildcard",
        uuidToName: new Map([["aabbccdd", "color"]]),
        uuidToSubCategories: new Map([["aabbccdd", ["warm", "cool", "earth"]]]),
      },
      attachTo: document.body,
    });
    const chip = wrap.find(".wp-refchip--ref");
    await chip.trigger("click");
    const picker = document.querySelector('[data-test="subcat-picker"]');
    expect(picker).not.toBeNull();
    // Edit-mode → delete button present.
    expect(document.querySelector('[data-test="picker-delete"]')).not.toBeNull();
    // The "warm" subcat chip should be preselected.
    const warmChip = document.querySelector('[data-test="subcat-chip"][data-value="warm"]');
    expect(warmChip?.classList.contains("wp-subcat-chip--selected")).toBe(true);
    wrap.unmount();
  });

  it("apply in edit mode replaces the chip's subCategories in place", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "hi @{aabbccdd:warm} foo",
        surface: "wildcard",
        uuidToName: new Map([["aabbccdd", "color"]]),
        uuidToSubCategories: new Map([["aabbccdd", ["warm", "cool", "earth"]]]),
      },
      attachTo: document.body,
    });
    await wrap.find(".wp-refchip--ref").trigger("click");
    // Click "cool" to add it to selection.
    const coolChip = document.querySelector('[data-test="subcat-chip"][data-value="cool"]') as HTMLElement;
    coolChip.click();
    await flushPromises();
    // Apply.
    (document.querySelector('[data-test="picker-apply"]') as HTMLElement).click();
    await flushPromises();
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("hi @{aabbccdd:warm,cool} foo");
    wrap.unmount();
  });

  it("delete in edit mode removes the chip atom", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "hi @{aabbccdd:warm} foo",
        surface: "wildcard",
        uuidToName: new Map([["aabbccdd", "color"]]),
        uuidToSubCategories: new Map([["aabbccdd", ["warm", "cool"]]]),
      },
      attachTo: document.body,
    });
    await wrap.find(".wp-refchip--ref").trigger("click");
    (document.querySelector('[data-test="picker-delete"]') as HTMLElement).click();
    await flushPromises();
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("hi  foo");
    wrap.unmount();
  });

  it("backspace immediately after a chip deletes the chip", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "a @{aabbccdd} b",
        surface: "wildcard",
        uuidToName: new Map([["aabbccdd", "color"]]),
      },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    // Place caret at start of " b" (the text node after the chip).
    const trailingTextSpans = host.querySelectorAll(".wp-rt__text");
    const trailingSpan = trailingTextSpans[trailingTextSpans.length - 1];
    const textNode = trailingSpan.firstChild;
    const range = document.createRange();
    if (textNode) range.setStart(textNode, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    if (textNode) sel?.addRange(range);
    // Dispatch a Backspace keydown via the host wrapper.
    await wrap.find(".wp-rt__host").trigger("keydown", { key: "Backspace" });
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("a  b");
    wrap.unmount();
  });

  it.skip("OBSOLETE — arrow keys defer to native browser chip-skip handling", () => {
    // The previous implementation preventDefaulted arrow keys at chip
    // boundaries and tried to position the caret manually. Live QA
    // showed that fighting the browser's selection semantics produced
    // worse UX than the native fallback — modern Chrome + Firefox
    // already skip `contenteditable=false` nodes naturally on
    // ArrowLeft / ArrowRight. The handler was removed; this test no
    // longer applies.
  });

  it("inserts an autocomplete pick at the current selection, not the end", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "alpha  beta",
        surface: "wildcard",
        refSuggestions: ["aabbccdd"],
        uuidToName: new Map([["aabbccdd", "color"]]),
        uuidToSubCategories: new Map([["aabbccdd", []]]),
      },
      attachTo: document.body,
    });
    // Place the caret between the two spaces (offset 6 in "alpha  beta").
    // NOTE: focus first, then set selection — jsdom's `focus()` on a
    // contenteditable resets the selection to (host, 0), so installing
    // the range after focus is the only way to preserve our intended
    // caret position under jsdom. In a real browser the order doesn't
    // matter because focus doesn't clobber an in-element selection.
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    const textNode = host.querySelector(".wp-rt__text")?.firstChild ?? host.firstChild;
    const range = document.createRange();
    if (textNode) range.setStart(textNode, 6);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // Pick via the test seam.
    await (wrap.vm as unknown as { __triggerAutocompleteForTest: (t: "@" | "$") => Promise<void> })
      .__triggerAutocompleteForTest("@");
    await (wrap.vm as unknown as { __applyAutocompleteForTest: (label: string) => Promise<void> })
      .__applyAutocompleteForTest("aabbccdd");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("alpha @{aabbccdd} beta");
    wrap.unmount();
  });
});

describe("RichTextPreview.vue", () => {
  it("renders chip markup for $var without a textarea", () => {
    const wrap = mount(RichTextPreview, { props: { value: "$person" } });
    expect(wrap.find("textarea").exists()).toBe(false);
    expect(wrap.find("input").exists()).toBe(false);
    expect(wrap.html()).toContain("wp-rt-var");
  });

  it("renders empty value without throwing", () => {
    const wrap = mount(RichTextPreview, { props: { value: "" } });
    expect(wrap.exists()).toBe(true);
  });

  it("renders RefChip atoms for refs and vars in the same shape as the editor", () => {
    const wrap = mount(RichTextPreview, {
      props: {
        modelValue: "x $person sees @{aabbccdd:warm}",
        uuidToName: new Map([["aabbccdd", "color"]]),
        varSuggestions: ["person"],
      },
    });
    const chips = wrap.findAll(".wp-refchip");
    expect(chips.length).toBe(2);
    expect(chips[0].text()).toContain("$person");
    expect(chips[1].text()).toContain("@color");
    expect(chips[1].text()).toContain("warm");
  });
});
