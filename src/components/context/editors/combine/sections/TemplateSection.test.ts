// Combine TemplateSection — RichTextInput bound to
// instance.template_override (falling back to payload.template), detected
// $vars pills, multi-token preview using shared preview-tokens, "stored
// as $name" line, and per-section reset button when override active.

import { describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import TemplateSection from "./TemplateSection.vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";

// RichTextInput is async-loaded by TemplateSection (defineAsyncComponent
// chunk-split for bundle-size). Tests stub it with a tiny shim so we can
// assert prop wiring + simulate emits without waiting for the dynamic
// import resolver in jsdom.
const RichTextInputStub = {
  name: "RichTextInput",
  props: ["modelValue", "varSuggestions", "multiline", "rows", "surface", "placeholder", "ariaLabel"],
  emits: ["update:modelValue"],
  template: `<div class="wp-rt-stub" :data-model-value="modelValue"></div>`,
};

const globalStubs = { RichTextInput: RichTextInputStub };

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "ab12cd34",
    type: "combine",
    enabled: true,
    meta: { name: "final_prompt" },
    entries: [],
    payload: { output_var: "final_prompt", template: "$style portrait" },
    instance: {},
    ...overrides,
  };
}

describe("combine TemplateSection", () => {
  it("RichTextInput modelValue reads payload.template when no override is set", () => {
    const w = mount(TemplateSection, {
      props: { module: makeModule() },
      global: { stubs: globalStubs },
    });
    expect(w.findComponent(RichTextInputStub).props("modelValue")).toBe("$style portrait");
  });

  it("RichTextInput modelValue reads instance.template_override when set", () => {
    const w = mount(TemplateSection, {
      props: {
        module: makeModule({
          instance: { template_override: "{moody|cinematic} $style portrait of $subject" },
        }),
      },
      global: { stubs: globalStubs },
    });
    expect(w.findComponent(RichTextInputStub).props("modelValue"))
      .toBe("{moody|cinematic} $style portrait of $subject");
  });

  it("typing emits instance.template_override patch", async () => {
    const w = mount(TemplateSection, {
      props: { module: makeModule() },
      global: { stubs: globalStubs },
    });
    w.findComponent(RichTextInputStub).vm.$emit("update:modelValue", "$style epic shot of $subject");
    await flushPromises();
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.template_override).toBe("$style epic shot of $subject");
  });

  it("typing back to library default collapses override to null", async () => {
    const w = mount(TemplateSection, {
      props: {
        module: makeModule({ instance: { template_override: "$style epic shot" } }),
      },
      global: { stubs: globalStubs },
    });
    w.findComponent(RichTextInputStub).vm.$emit("update:modelValue", "$style portrait");
    await flushPromises();
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.template_override).toBeNull();
  });

  it("renders detected $var pills when template has vars", () => {
    const w = mount(TemplateSection, {
      props: {
        module: makeModule({
          payload: { output_var: "out", template: "$style portrait of $subject in $mood" },
        }),
      },
    });
    const pills = w.findAll('[data-test="tpl-detected-pill"]');
    expect(pills).toHaveLength(3);
    expect(pills[0].text()).toContain("style");
    expect(pills[1].text()).toContain("subject");
    expect(pills[2].text()).toContain("mood");
  });

  it("preview renders alt-token highlighted with tpl-tok--alt class", () => {
    const w = mount(TemplateSection, {
      props: {
        module: makeModule({
          payload: { output_var: "out", template: "{moody|cinematic} portrait" },
        }),
      },
    });
    const altSpans = w.findAll(".tpl-tok--alt");
    expect(altSpans.length).toBeGreaterThan(0);
    expect(altSpans[0].text()).toBe("{moody|cinematic}");
  });

  it("preview flags @{uuid} REF token with tpl-tok--ref-error class on combine surface", () => {
    // REF refs don't resolve on combine surface (binding consumer, not
    // wildcard chain). Tokenizer marks invalid → renderer applies error
    // class with dashed underline + tooltip.
    const w = mount(TemplateSection, {
      props: {
        module: makeModule({
          payload: { output_var: "out", template: "see @{abcdef12} ref" },
        }),
      },
    });
    expect(w.find(".tpl-tok--ref-error").exists()).toBe(true);
  });

  it("renders 'stored as $output_var' line below preview", () => {
    const w = mount(TemplateSection, {
      props: {
        module: makeModule({
          payload: { output_var: "final_prompt", template: "$style portrait" },
        }),
      },
    });
    const out = w.find('[data-test="tpl-stored-as"]');
    expect(out.exists()).toBe(true);
    expect(out.text()).toContain("final_prompt");
  });

  it("section reset button is hidden when no override + visible when overridden", () => {
    const noOverride = mount(TemplateSection, { props: { module: makeModule() } });
    expect(noOverride.find('[data-test="tpl-reset"]').exists()).toBe(false);

    const overridden = mount(TemplateSection, {
      props: {
        module: makeModule({ instance: { template_override: "different template" } }),
      },
    });
    expect(overridden.find('[data-test="tpl-reset"]').exists()).toBe(true);
  });

  it("section reset button clears template_override (null)", async () => {
    const w = mount(TemplateSection, {
      props: {
        module: makeModule({ instance: { template_override: "different template" } }),
      },
    });
    await w.find('[data-test="tpl-reset"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.template_override).toBeNull();
  });

  // ── varSuggestions wiring ───────────────────────────────────────
  // The insert-var dropdown was removed when the textarea was replaced
  // with RichTextInput: the chip editor's `$`-trigger autocomplete now
  // surfaces the same list. We verify the suggestion list is wired
  // through to the editor with the same dedupe + sort behaviour.

  it("wires empty varSuggestions when no upstream/sibling vars", () => {
    const w = mount(TemplateSection, {
      props: { module: makeModule() },
      global: { stubs: globalStubs },
    });
    expect(w.findComponent(RichTextInputStub).props("varSuggestions")).toEqual([]);
  });

  it("dedupes upstream + sibling vars and sorts alphabetically before passing to RichTextInput", () => {
    const w = mount(TemplateSection, {
      props: {
        module: makeModule(),
        upstreamVars: ["zebra", "alpha"],
        siblingVars: ["alpha", "mango"],
      },
      global: { stubs: globalStubs },
    });
    expect(w.findComponent(RichTextInputStub).props("varSuggestions"))
      .toEqual(["alpha", "mango", "zebra"]);
  });

  // ── Live-preview pane (upstream-resolved) ───────────────────────

  it("live preview pane hidden when no upstreamResolved provided", () => {
    const w = mount(TemplateSection, {
      props: {
        module: makeModule({
          payload: { output_var: "out", template: "$style portrait" },
        }),
      },
    });
    expect(w.find('[data-test="tpl-preview-resolved"]').exists()).toBe(false);
  });

  it("live preview pane hidden when template has no resolvable $var", () => {
    const w = mount(TemplateSection, {
      props: {
        module: makeModule({
          payload: { output_var: "out", template: "no vars here" },
        }),
        upstreamResolved: { color: "red" },
      },
    });
    expect(w.find('[data-test="tpl-preview-resolved"]').exists()).toBe(false);
  });

  it("live preview substitutes $var with resolved value", () => {
    const w = mount(TemplateSection, {
      props: {
        module: makeModule({
          payload: { output_var: "out", template: "a $color $shape" },
        }),
        upstreamResolved: { color: "red", shape: "circle" },
      },
    });
    const pane = w.find('[data-test="tpl-preview-resolved"]');
    expect(pane.exists()).toBe(true);
    expect(pane.text()).toBe("a red circle");
    expect(pane.findAll(".tpl-tok--var-resolved")).toHaveLength(2);
  });

  it("live preview flags unresolved vars with --var-unresolved class", () => {
    const w = mount(TemplateSection, {
      props: {
        module: makeModule({
          payload: { output_var: "out", template: "$known $unknown" },
        }),
        upstreamResolved: { known: "hi" },
      },
    });
    const pane = w.find('[data-test="tpl-preview-resolved"]');
    expect(pane.exists()).toBe(true);
    expect(pane.find(".tpl-tok--var-resolved").text()).toBe("hi");
    const unresolved = pane.find(".tpl-tok--var-unresolved");
    expect(unresolved.exists()).toBe(true);
    expect(unresolved.text()).toBe("$unknown");
  });

  it("live preview leaves alternations + repeats raw (need RNG to resolve)", () => {
    const w = mount(TemplateSection, {
      props: {
        module: makeModule({
          payload: {
            output_var: "out",
            template: "{red|blue} $color",
          },
        }),
        upstreamResolved: { color: "shiny" },
      },
    });
    const pane = w.find('[data-test="tpl-preview-resolved"]');
    expect(pane.exists()).toBe(true);
    // Alt stays raw, $color resolves.
    expect(pane.text()).toBe("{red|blue} shiny");
  });

  it("resolves a $color.0 list accessor without leaking the .K literal (SP2a)", () => {
    const w = mount(TemplateSection, {
      props: {
        module: makeModule({ payload: { output_var: "out", template: "$color.0 hat" } }),
        upstreamResolved: { color: "red" },
      },
    });
    const pane = w.find('[data-test="tpl-preview-resolved"]');
    expect(pane.exists()).toBe(true);
    // `$color.0` resolves via the shared accessor (string = 1-element list,
    // `.0` == itself); the literal ".0" must NOT survive as a text token.
    expect(pane.text()).toBe("red hat");
    expect(pane.find(".tpl-tok--var-resolved").text()).toBe("red");
  });
});
