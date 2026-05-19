import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import RichTextInput from "../components/RichTextInput.vue";
import RichTextPreview from "../components/RichTextPreview.vue";

// NOTE: `flushPromises` / `popoverItems` / `popoverExists` helpers were
// removed in Task 5 along with the autocomplete tests that used them.
// Task 6 will reintroduce equivalents when it rewires autocomplete onto
// the contenteditable host.

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

  // OBSOLETE (Task 5 rewrite) — rewired in Task 6 against contenteditable host.
  it.skip("emits update:modelValue on input (rewired in Task 6)", () => {});

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

  // OBSOLETE (Task 5 rewrite) — rewired in Task 13 (multiline contenteditable host).
  it.skip("renders multiline as <textarea> when multiline=true (rewired in Task 13)", () => {});

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

  // OBSOLETE (Task 5 rewrite) — rewired in Task 13 (escape rendering on host).
  it.skip("renders $$ escapes as escape spans (not vars) (rewired in Task 13)", () => {});

  // OBSOLETE (task-19 confirmed): Comment token kind was removed in the locked grammar.
  // `# lines` are now plain text. This test can never pass with the current tokenizer.
  // Keeping skipped rather than deleted so the intent is visible in git history.
  it.skip("renders # comment lines greyed out [OBSOLETE — comment syntax removed]", () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "# noted", multiline: true },
    });
    expect(wrap.find(".wp-rt__mirror").html()).toContain("wp-rt-comment");
  });

  // OBSOLETE (Task 5 rewrite) — rewired in Task 13 against contenteditable host focus/blur.
  it.skip("toggles wp-rt--focused / wp-rt--rest classes on focus / blur (rewired in Task 13)", () => {});

  // Autocomplete-popover tests below all depend on the legacy <input>/<textarea>
  // dispatching `@input` to drive `probeAutocomplete`. Task 6 rewires the probe
  // to read from the contenteditable host + Selection API. Until then these
  // are mechanically broken (no <input> element to setValue against). Keep
  // the intent visible in git rather than deleting.
  // OBSOLETE (Task 5 rewrite) — rewired in Task 6 (autocomplete on host).
  it.skip("opens autocomplete and filters by prefix when typing $ (rewired in Task 6)", () => {});

  // OBSOLETE (Task 5 rewrite) — rewired in Task 6 (autocomplete on host).
  it.skip("opens autocomplete with refSuggestions when typing @ (rewired in Task 6)", () => {});

  // OBSOLETE (Task 5 rewrite) — rewired in Task 6 (autocomplete on host).
  it.skip("inserts a suggestion on Enter (rewired in Task 6)", () => {});

  // OBSOLETE (Task 5 rewrite) — rewired in Task 6 (autocomplete on host).
  it.skip("`@` autocomplete filters by display name and inserts the UUID (rewired in Task 6)", () => {});

  // OBSOLETE (Task 5 rewrite) — rewired in Task 6 (autocomplete on host).
  it.skip("closes autocomplete on Escape (rewired in Task 6)", () => {});

  // OBSOLETE (Task 5 rewrite) — rewired in Task 6 (autocomplete on host).
  it.skip("ArrowDown advances suggestion selection (rewired in Task 6)", () => {});

  // OBSOLETE (Task 5 rewrite) — rewired in Task 6 (autocomplete on host).
  it.skip("typing $ followed by space without picking closes the popup (rewired in Task 6)", () => {});

  // OBSOLETE (Task 5 rewrite) — mirror layer removed; caret alignment is no
  // longer a textarea-overlay concern. Task 13 will re-pin host rendering.
  it.skip("keeps mirror text identical to value while focused (no chip padding drift) (rewired in Task 13)", () => {});

  // OBSOLETE (Task 5 rewrite) — underlying <input> removed; aria/disabled
  // forwarding moves to the contenteditable host in Task 10/13.
  it.skip("forwards aria-label and disabled to the underlying input (rewired in Task 13)", () => {});
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
});
