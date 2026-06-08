import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import RichTextInput from "../components/RichTextInput.vue";
import RichTextPreview from "../components/RichTextPreview.vue";
import { useResolveWarnings } from "../composables/useResolveWarnings";

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
        surface: "wildcard",
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

  it("chipifies a runtime-only $var when the user types a word-boundary char", async () => {
    // The static suggestion list is empty (the runtime var doesn't exist yet
    // in any module's catalog) but typing `$runtimeVar` + space should still
    // produce a var chip. Without this settle path the token would stay raw
    // text forever — vars created downstream / via overrides could never get
    // a chip.
    const wrap = mount(RichTextInput, {
      props: { modelValue: "", varSuggestions: [] },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host");
    // Simulate the user typing `$runtimeVar ` — browsers extend the trailing
    // wp-rt__text span's textContent in place. We mirror that here.
    const span = (host.element as HTMLElement).querySelector(".wp-rt__text") as HTMLElement;
    span.textContent = "$runtimeVar";
    await host.trigger("input", { inputType: "insertText", data: "r" });
    // Mid-token: still raw text, no chip yet.
    expect(wrap.findAll(".wp-refchip--var")).toHaveLength(0);
    // Now the boundary char.
    span.textContent = "$runtimeVar ";
    await host.trigger("input", { inputType: "insertText", data: " " });
    await flushPromises();
    const chips = wrap.findAll(".wp-refchip--var");
    expect(chips.length).toBe(1);
    expect(chips[0].text()).toContain("$runtimeVar");
    wrap.unmount();
  });

  it("Enter on a $-trigger with no suggestion match chipifies the typed query", async () => {
    // Runtime / forward-declared vars never appear in varSuggestions, so
    // pressing Enter on `$runtimeVar` used to be a dead keystroke: the
    // suggestion list was empty, the handler bailed, and the typed text
    // stayed raw. Now we treat the typed query as the chip name directly.
    const wrap = mount(RichTextInput, {
      props: { modelValue: "", varSuggestions: [] },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host");
    const span = (host.element as HTMLElement).querySelector(".wp-rt__text") as HTMLElement;
    span.textContent = "$runtimeVar";
    // Place the caret at the end of the typed text so refreshAutocomplete
    // sees the `$` trigger.
    const sel = window.getSelection();
    const range = document.createRange();
    const tn = span.firstChild as Text;
    range.setStart(tn, tn.length);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
    // Drive an input event so refreshAutocompleteFromHost runs.
    await host.trigger("input", { inputType: "insertText", data: "r" });
    // Now press Enter.
    await host.trigger("keydown", { key: "Enter" });
    await flushPromises();
    const chips = wrap.findAll(".wp-refchip--var");
    expect(chips.length).toBe(1);
    expect(chips[0].text()).toContain("$runtimeVar");
    wrap.unmount();
  });

  it("Enter after $mood.0 settles the var with no stray newline (multiline combine, SP2a)", async () => {
    // Regression: probeAutocomplete stopped scanning back at `.`, so after
    // `$mood.0` the popover was closed and Enter fell through to a newline on
    // the multiline combine surface — splitting the token. The accessor-aware
    // probe keeps the popover open so Enter chipifies the var instead.
    const wrap = mount(RichTextInput, {
      props: { modelValue: "", surface: "combine", multiline: true, varSuggestions: [] },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host");
    const span = (host.element as HTMLElement).querySelector(".wp-rt__text") as HTMLElement;
    span.textContent = "$mood.0";
    // Caret at end so probeAutocomplete sees the `$mood.0` run.
    const sel = window.getSelection();
    const range = document.createRange();
    const tn = span.firstChild as Text;
    range.setStart(tn, tn.length);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
    await host.trigger("input", { inputType: "insertText", data: "0" });
    await host.trigger("keydown", { key: "Enter" });
    await flushPromises();
    const chips = wrap.findAll(".wp-refchip--var");
    expect(chips.length).toBe(1);
    expect(chips[0].text()).toContain("$mood.0");
    const events = wrap.emitted("update:modelValue") ?? [];
    const last = String(events[events.length - 1]?.[0] ?? "");
    expect(last).toBe("$mood.0");        // no newline split
    expect(last).not.toContain("\n");
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

  it("renders RefChip atoms for @{uuid}/@{uuid:subcat} tokens in wildcard surface", () => {
    // Surface enum gates which atom kinds chipify:
    //   - "wildcard": @{uuid} chips, $var stays plain text (wildcards
    //     don't expand $name substitution)
    //   - "combine"/"derivation"/"assembler": $var chips, @{uuid} stays
    //     plain text (template surfaces don't expand nested wildcards)
    // This test covers the wildcard side. See the next test for combine.
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "$person sees @{aabbccdd} and @{deadbeef:warm} of {red|blue}",
        surface: "wildcard",
        uuidToName: new Map([["aabbccdd", "color"]]),
      },
    });
    const chips = wrap.findAll(".wp-refchip");
    // 2 refs chip — $person collapses to text since this is wildcard surface.
    expect(chips.length).toBe(2);
    expect(chips[0].text()).toContain("@color");
    expect(chips[1].text()).toContain("?");  // deadbeef unresolved
    expect(chips[1].text()).toContain("deadbeef");
  });

  it("renders RefChip atoms for $var tokens in template surface, ignores @{uuid}", () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "$person sees @{aabbccdd}",
        surface: "combine",
        varSuggestions: ["person"],
        uuidToName: new Map([["aabbccdd", "color"]]),
      },
    });
    const chips = wrap.findAll(".wp-refchip");
    // Only the $person var chip — @{uuid} stays as plain text on
    // template surfaces (no nested wildcard expansion at runtime).
    expect(chips.length).toBe(1);
    expect(chips[0].text()).toContain("$person");
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
    expect(events[events.length - 1]?.[0]).toBe("@{aabbccdd#outfit}");
    expect(document.querySelector('[data-test="subcat-picker"]')).toBeNull();
    wrap.unmount();
  });

  it("subcat picker Apply with selection inserts @{uuid#name:warm} chip", async () => {
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
    expect(events[events.length - 1]?.[0]).toBe("@{aabbccdd#color:warm}");
    expect(document.querySelector('[data-test="subcat-picker"]')).toBeNull();
    wrap.unmount();
  });

  it("subcat picker Skip inserts plain @{uuid#name} chip", async () => {
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
    expect(events[events.length - 1]?.[0]).toBe("@{aabbccdd#color}");
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
    const overlay = document.querySelector(".wp-subcat-picker__backdrop") as HTMLElement;
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

  it("autocomplete-pick preserves earlier chips when trigger sits after a chip", async () => {
    // Reproduces the "template breaks after each edit" bug. The user has
    // a chip + trailing text containing a `$te` trigger. Previous code
    // stored acStart as the offset INSIDE the local text node, but the
    // insert path slices the RAW host text (which includes the
    // serialised chip). When chips precede the trigger, local and raw
    // diverge and the slice nukes content between offset 0 and caret.
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "$outfit, $te",
        surface: "combine",
        varSuggestions: ["outfit", "test"],
      },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    // Place the selection at the end of the trailing text span (after
    // `$te`). The wp-rt__text spans hold the trailing run.
    const spans = host.querySelectorAll(".wp-rt__text");
    const trailing = spans[spans.length - 1] as HTMLElement;
    const tn = trailing.firstChild as Text | null;
    const sel = window.getSelection();
    const range = document.createRange();
    if (tn) {
      range.setStart(tn, (tn.textContent ?? "").length);
    } else {
      range.setStart(trailing, 0);
    }
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
    // Drive an input event so refreshAutocompleteFromHost runs in raw-text space.
    await wrap.find(".wp-rt__host").trigger("input");
    // Now apply the picked suggestion.
    (wrap.vm as unknown as { __applyAutocompleteForTest: (label: string) => void })
      .__applyAutocompleteForTest("test");
    await flushPromises();
    const events = wrap.emitted("update:modelValue") ?? [];
    // The earlier chip + comma must survive — only the typed `$te` trigger
    // fragment gets replaced with the picked `$test` chip.
    expect(events[events.length - 1]?.[0]).toBe("$outfit, $test");
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
    // The boolean editor seeds its expression input from the ref's
    // existing `:expr` segment.
    const exprInput = document.querySelector('[data-test="expr-input"]') as HTMLInputElement;
    expect(exprInput).not.toBeNull();
    expect(exprInput.value).toBe("warm");
    wrap.unmount();
  });

  it("apply in edit mode rewrites the chip's filter expression in place", async () => {
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
    // Type a new boolean expression into the editor.
    const exprInput = document.querySelector('[data-test="expr-input"]') as HTMLInputElement;
    exprInput.value = "warm or cool";
    exprInput.dispatchEvent(new Event("input"));
    await flushPromises();
    // Apply.
    (document.querySelector('[data-test="picker-apply"]') as HTMLElement).click();
    await flushPromises();
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("hi @{aabbccdd#color:warm or cool} foo");
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

  // --- SP2a: $var.K list-accessor chip stability ---

  it("preserves the .K accessor when a $mood.0 chip round-trips through readHostAsText", async () => {
    // Bug A regression: readHostAsText dropped atom.index, so any edit that
    // re-read the host (input/blur/settle) silently rewrote `$mood.0`→`$mood`.
    const wrap = mount(RichTextInput, {
      props: { modelValue: "a $mood.0 b", surface: "combine", varSuggestions: ["mood"] },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host");
    const spans = (host.element as HTMLElement).querySelectorAll(".wp-rt__text");
    const trailing = spans[spans.length - 1];
    trailing.textContent = " bz";
    await host.trigger("input");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("a $mood.0 bz");
    wrap.unmount();
  });

  it("Backspace after a $mood.0 chip deletes the whole accessor atomically", async () => {
    // Bug B regression: the chip-delete regex stopped at the identifier, so
    // `$mood.0` fell through to single-char delete (removing `0`→`$mood.`).
    const wrap = mount(RichTextInput, {
      props: { modelValue: "a $mood.0 b", surface: "combine", varSuggestions: ["mood"] },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    host.focus();
    const spans = host.querySelectorAll(".wp-rt__text");
    const trailing = spans[spans.length - 1];
    const tn = trailing.firstChild;
    const range = document.createRange();
    if (tn) range.setStart(tn, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    if (tn) sel?.addRange(range);
    await wrap.find(".wp-rt__host").trigger("keydown", { key: "Backspace" });
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("a  b");
    wrap.unmount();
  });

  it("typing $mood.0 does not chip prematurely on the dot; settles on the next boundary", async () => {
    // Symptom #1 regression: `.` was a settle delimiter, so `$mood` chipped
    // the instant the user typed `.`, stranding the accessor. `.` is no
    // longer a settle char — the token waits for the digit + a real boundary,
    // then chips as a single `$mood.0`.
    const wrap = mount(RichTextInput, {
      props: { modelValue: "", surface: "combine", varSuggestions: [] },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host");
    const span = (host.element as HTMLElement).querySelector(".wp-rt__text") as HTMLElement;
    span.textContent = "$mood.";
    await host.trigger("input", { inputType: "insertText", data: "." });
    expect(wrap.findAll(".wp-refchip--var")).toHaveLength(0);  // no premature chip
    span.textContent = "$mood.0 ";
    await host.trigger("input", { inputType: "insertText", data: " " });
    await flushPromises();
    const chips = wrap.findAll(".wp-refchip--var");
    expect(chips.length).toBe(1);
    expect(chips[0].text()).toContain("$mood.0");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]?.[0]).toBe("$mood.0 ");
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
    expect(events[events.length - 1]?.[0]).toBe("alpha @{aabbccdd#color} beta");
    wrap.unmount();
  });

  // Regression: chip duplication after Enter-without-probe-set-acStart.
  // Path: user types `$testo` into the wp-rt__text span (browser DOM
  // path, bypasses Vue reactivity), then triggers chip insertion via
  // Enter or a code path where `refreshAutocompleteFromHost` hadn't
  // yet set `acStart`. Pre-fix, `insertChipAtCaret` left `cutFrom` at
  // `caret` (default for acStart === -1), so the chip got APPENDED
  // after the user-typed text — emit became `$testo$testo`. Each
  // subsequent blur saw the same raw text + chip, parsed → 2 var
  // atoms, added another chip, compounding.
  //
  // Two fixes layered:
  //   1. Scan-backward fallback in `insertChipAtCaret` re-derives the
  //      `$<query>` / `@<query>` slice when `acStart` is unset or
  //      doesn't point at a trigger char.
  //   2. `renderTick` bump on every programmatic atom apply forces Vue
  //      to mint fresh `:key`s and tear down stale DOM spans whose
  //      `textContent` had been mutated outside the v-for diff.
  it("Backspace on `$name` in wildcard surface deletes ONE char at a time, not the whole token", async () => {
    // Pre-fix: chip-deletion regex always matched `$ident` regardless of
    // surface, so a single Backspace in a wildcard option value eat the
    // whole `$variable` even though $vars don't chip on that surface.
    const wrap = mount(RichTextInput, {
      props: { modelValue: "$testo", surface: "wildcard" },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host");
    // Place caret at end (after "$testo" plain text).
    const sp = (host.element as HTMLElement).querySelector(".wp-rt__text");
    if (sp && sp.firstChild) {
      const range = document.createRange();
      range.setStart(sp.firstChild, (sp.firstChild.textContent ?? "").length);
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    await host.trigger("keydown", { key: "Backspace" });
    await flushPromises();
    // Imperative single-char delete: handler removes ONE char (last "o"),
    // emits "$test". The chip-atomic-delete path is gated on surface; on
    // wildcard with `$name`, chipRegex doesn't match → falls through to
    // the single-char delete branch. Assertion: last emit is `$test` (one
    // char removed), NOT "" (which would mean atomic-delete fired).
    const events = wrap.emitted("update:modelValue") ?? [];
    const last = events[events.length - 1]?.[0];
    expect(last).toBe("$test");
    // Sanity: no chip rendered (wildcard surface keeps $name as text).
    expect(wrap.findAll(".wp-refchip").length).toBe(0);
    wrap.unmount();
  });

  it("Delete (forward) immediately before a chip removes it atomically", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "$x hello", varSuggestions: ["x"] },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host");
    // Place caret at offset 0 (before the $x chip in raw text).
    const range = document.createRange();
    const sp = (host.element as HTMLElement).querySelector(".wp-rt__text");
    if (sp && sp.firstChild) {
      range.setStart(sp.firstChild, 0);
      range.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    await host.trigger("keydown", { key: "Delete" });
    await flushPromises();
    const events = wrap.emitted("update:modelValue") ?? [];
    // After forward-delete on the chip, only " hello" remains.
    expect(events[events.length - 1]?.[0]).toBe(" hello");
    wrap.unmount();
  });

  it("typed $name + chip insert without probe-set acStart emits a single chip (no duplication)", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "", varSuggestions: [] },
      attachTo: document.body,
    });
    const host = wrap.find(".wp-rt__host");

    // Simulate user typing "$testo" directly into the empty span. This
    // mirrors what real browsers do on contenteditable: the existing
    // span's textContent is extended in place, no input event involves
    // Vue's reactivity for atoms[0].text (stays "").
    const span = (host.element as HTMLElement).querySelector(".wp-rt__text");
    if (span) span.textContent = "$testo";
    await host.trigger("input");

    // Test-seam path: __triggerAutocompleteForTest does NOT set acStart
    // (it only flips acOpen/acTrigger). This reproduces the event-order
    // race where Enter fires before `refreshAutocompleteFromHost` has
    // probed the latest text. Without the scan-backward fallback, the
    // chip would land AFTER the typed text.
    await (wrap.vm as unknown as { __triggerAutocompleteForTest: (t: "@" | "$") => Promise<void> })
      .__triggerAutocompleteForTest("$");
    await (wrap.vm as unknown as { __applyAutocompleteForTest: (label: string) => Promise<void> })
      .__applyAutocompleteForTest("testo");
    await flushPromises();
    const events = wrap.emitted("update:modelValue") ?? [];
    // Critical assertion: emit equals "$testo" (one chip), NOT
    // "$testo$testo" (text + chip).
    expect(events[events.length - 1]?.[0]).toBe("$testo");
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
    // The filter expression is NOT shown inline (§4.1) — a funnel marks
    // "filtered" and the expression lives in the hover title.
    expect(chips[1].text()).not.toContain("warm");
    expect(chips[1].find('[data-test="refchip-filter"]').exists()).toBe(true);
    expect(chips[1].attributes("title")).toContain("warm");
  });
});

describe("RichTextInput / RichTextPreview — useResolveWarnings merge", () => {
  // The store is a module-level singleton — wipe before each case so
  // a left-over push from a prior test can't poison this suite. Tests
  // use a unique module_id per case as a belt-and-suspenders.
  beforeEach(() => {
    useResolveWarnings().clearAll();
  });

  it("RichTextInput merges store warnings when moduleId is provided", async () => {
    useResolveWarnings().push([
      {
        type: "broken_ref_on_import", severity: "warn",
        module_id: "wc_target", source_field: "options[0].value",
        position: 5, token_index: null, detail: {}, message: "broken",
      },
    ]);
    const wrap = mount(RichTextInput, {
      props: { modelValue: "hello", moduleId: "wc_target", varSuggestions: [] },
    });
    await flushPromises();
    // Warning bucket renders one marker per warning.
    const markers = wrap.findAll(".wp-rt-warn-marker");
    expect(markers.length).toBe(1);
    expect(markers[0]?.attributes("data-warning-position")).toBe("5");
    wrap.unmount();
  });

  it("RichTextInput ignores store warnings without moduleId prop", async () => {
    useResolveWarnings().push([
      {
        type: "broken_ref_on_import", severity: "warn",
        module_id: "wc_target", source_field: "options[0].value",
        position: 5, token_index: null, detail: {}, message: "broken",
      },
    ]);
    const wrap = mount(RichTextInput, {
      props: { modelValue: "hello", varSuggestions: [] },
    });
    await flushPromises();
    expect(wrap.findAll(".wp-rt-warn-marker").length).toBe(0);
    wrap.unmount();
  });

  it("RichTextPreview merges store warnings when moduleId is provided", async () => {
    useResolveWarnings().push([
      {
        type: "broken_ref_on_import", severity: "warn",
        module_id: "wc_p", source_field: "options[0].value",
        position: 0, token_index: null, detail: {}, message: "preview",
      },
    ]);
    const wrap = mount(RichTextPreview, {
      props: { modelValue: "x", moduleId: "wc_p" },
    });
    await flushPromises();
    expect(wrap.findAll(".wp-rt-warn-marker").length).toBe(1);
    wrap.unmount();
  });

  it("Prop warnings remain when moduleId not set (prop-only path preserved)", async () => {
    const wrap = mount(RichTextPreview, {
      props: {
        modelValue: "y",
        warnings: [{
          type: "unknown_ref", severity: "warn",
          module_id: "other", source_field: "f", position: 0,
          token_index: null, detail: {}, message: "prop-only",
        }],
      },
    });
    await flushPromises();
    expect(wrap.findAll(".wp-rt-warn-marker").length).toBe(1);
    wrap.unmount();
  });
});
