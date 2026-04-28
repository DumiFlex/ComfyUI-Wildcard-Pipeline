import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import RichTextInput from "../components/RichTextInput.vue";
import RichTextPreview from "../components/RichTextPreview.vue";

// `flushPromises()` from @vue/test-utils gives us reactivity-flush behaviour
// without needing to import `nextTick` from `vue` (the test alias maps `vue`
// to its runtime-only bundler bundle which doesn't re-export it).
const tick = flushPromises;

describe("RichTextInput.vue", () => {
  it("renders bound value inside the input layer", () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "$person walks" },
    });
    const input = wrap.find("input");
    expect(input.exists()).toBe(true);
    expect((input.element as HTMLInputElement).value).toBe("$person walks");
  });

  it("emits update:modelValue on input", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "" },
    });
    const input = wrap.find("input");
    await input.setValue("hello");
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1]).toEqual(["hello"]);
  });

  it("renders multiline as <textarea> when multiline=true", () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "line\nline", multiline: true, rows: 6 },
    });
    expect(wrap.find("textarea").exists()).toBe(true);
    expect(wrap.find("input").exists()).toBe(false);
    expect(wrap.find("textarea").attributes("rows")).toBe("6");
  });

  it("paints chip markup in the mirror layer for $var/@{uuid}/{a|b|c}", () => {
    // Uses @{8hex} UUID form — the locked grammar. Legacy @name falls to text.
    const wrap = mount(RichTextInput, {
      props: { modelValue: "$person sees @{1a2b3c4d} of {red|blue}" },
    });
    const mirror = wrap.find(".wp-rt__mirror");
    expect(mirror.exists()).toBe(true);
    const html = mirror.html();
    expect(html).toContain("wp-rt-var");
    expect(html).toContain("wp-rt-ref");
    expect(html).toContain("wp-rt-dp-brace");
    // dp-pipe is no longer emitted as a separate token; dp-brace covers the whole block.
    // Confirm the brace block is present via dp-brace class:
    expect(html).toContain("wp-rt-dp-brace");
  });

  it("renders $$ escapes as escape spans (not vars)", () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "$$literal" },
    });
    const html = wrap.find(".wp-rt__mirror").html();
    expect(html).toContain("wp-rt-escape");
    // The opening "$$" should not be classified as var.
    expect(html).not.toMatch(/wp-rt-var[^]*\$\$/);
  });

  // OBSOLETE (task-19 confirmed): Comment token kind was removed in the locked grammar.
  // `# lines` are now plain text. This test can never pass with the current tokenizer.
  // Keeping skipped rather than deleted so the intent is visible in git history.
  it.skip("renders # comment lines greyed out [OBSOLETE — comment syntax removed]", () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "# noted", multiline: true },
    });
    expect(wrap.find(".wp-rt__mirror").html()).toContain("wp-rt-comment");
  });

  it("toggles wp-rt--focused / wp-rt--rest classes on focus / blur", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "" },
      attachTo: document.body,
    });
    const input = wrap.find("input");
    expect(wrap.classes()).toContain("wp-rt--rest");
    await input.trigger("focus");
    expect(wrap.classes()).toContain("wp-rt--focused");
    expect(wrap.classes()).not.toContain("wp-rt--rest");
    await input.trigger("blur");
    await flushPromises();
    expect(wrap.classes()).toContain("wp-rt--rest");
    wrap.unmount();
  });

  // The autocomplete popover is teleported to <body>, so we query the
  // document directly rather than via the wrapper's subtree.
  function popoverItems(): string[] {
    return Array.from(document.querySelectorAll(".wp-rt-suggestions__item")).map(
      (el) => (el as HTMLElement).textContent ?? "",
    );
  }
  function popoverExists(): boolean {
    return document.querySelector(".wp-rt-suggestions") !== null;
  }

  it("opens autocomplete and filters by prefix when typing $", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "",
        varSuggestions: ["person", "people", "thing"],
      },
      attachTo: document.body,
    });
    const input = wrap.find("input");
    const el = input.element as HTMLInputElement;
    el.value = "$pe";
    el.setSelectionRange(3, 3);
    await input.trigger("input");
    await tick();
    const labels = popoverItems();
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.some((l) => l.includes("person"))).toBe(true);
    expect(labels.some((l) => l.includes("people"))).toBe(true);
    expect(labels.some((l) => l.includes("thing"))).toBe(false);
    wrap.unmount();
  });

  it("opens autocomplete with refSuggestions when typing @", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "",
        varSuggestions: ["alpha"],
        refSuggestions: ["beta", "betatron"],
      },
      attachTo: document.body,
    });
    const input = wrap.find("input");
    const el = input.element as HTMLInputElement;
    el.value = "@be";
    el.setSelectionRange(3, 3);
    await input.trigger("input");
    await tick();
    const labels = popoverItems();
    expect(labels.some((l) => l.includes("beta"))).toBe(true);
    expect(labels.some((l) => l.includes("alpha"))).toBe(false);
    wrap.unmount();
  });

  it("inserts a suggestion on Enter", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "",
        varSuggestions: ["person"],
      },
      attachTo: document.body,
    });
    const input = wrap.find("input");
    const el = input.element as HTMLInputElement;
    el.value = "$pe";
    el.setSelectionRange(3, 3);
    await input.trigger("input");
    await tick();
    await input.trigger("keydown", { key: "Enter" });
    const events = wrap.emitted("update:modelValue") ?? [];
    expect(events[events.length - 1]).toEqual(["$person"]);
    wrap.unmount();
  });

  it("closes autocomplete on Escape", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "",
        varSuggestions: ["person"],
      },
      attachTo: document.body,
    });
    const input = wrap.find("input");
    const el = input.element as HTMLInputElement;
    el.value = "$p";
    el.setSelectionRange(2, 2);
    await input.trigger("input");
    await tick();
    expect(popoverExists()).toBe(true);
    await input.trigger("keydown", { key: "Escape" });
    await tick();
    expect(popoverExists()).toBe(false);
    wrap.unmount();
  });

  it("ArrowDown advances suggestion selection", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "",
        varSuggestions: ["person", "people"],
      },
      attachTo: document.body,
    });
    const input = wrap.find("input");
    const el = input.element as HTMLInputElement;
    el.value = "$p";
    el.setSelectionRange(2, 2);
    await input.trigger("input");
    await tick();
    const before = document.querySelector<HTMLElement>(
      ".wp-rt-suggestions__item[data-active]",
    );
    expect(before?.textContent).toContain("person");
    await input.trigger("keydown", { key: "ArrowDown" });
    await tick();
    const after = document.querySelector<HTMLElement>(
      ".wp-rt-suggestions__item[data-active]",
    );
    expect(after?.textContent).toContain("people");
    wrap.unmount();
  });

  it("typing $ followed by space without picking closes the popup", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "",
        varSuggestions: ["person"],
      },
      attachTo: document.body,
    });
    const input = wrap.find("input");
    const el = input.element as HTMLInputElement;
    el.value = "$p";
    el.setSelectionRange(2, 2);
    await input.trigger("input");
    await tick();
    expect(popoverExists()).toBe(true);
    el.value = "$p ";
    el.setSelectionRange(3, 3);
    await input.trigger("input");
    await tick();
    expect(popoverExists()).toBe(false);
    wrap.unmount();
  });

  it("keeps mirror text identical to value while focused (no chip padding drift)", async () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "$person and @ref" },
      attachTo: document.body,
    });
    const input = wrap.find("input");
    await input.trigger("focus");
    const mirrorText = wrap.find(".wp-rt__mirror").text();
    // The trailing wp-rt-tail span injects a zero-width space; strip it before
    // comparing so we can assert the visible glyphs match the value exactly.
    expect(mirrorText.replace(/​/g, "")).toBe("$person and @ref");
    wrap.unmount();
  });

  it("forwards aria-label and disabled to the underlying input", () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "x", ariaLabel: "Rule value", disabled: true },
    });
    const input = wrap.find("input");
    expect(input.attributes("aria-label")).toBe("Rule value");
    expect(input.attributes("disabled")).toBeDefined();
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
});
