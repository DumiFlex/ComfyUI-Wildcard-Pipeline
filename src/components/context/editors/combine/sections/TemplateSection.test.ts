// Combine TemplateSection — textarea bound to instance.template_override
// (falling back to payload.template), detected $vars pills, multi-token
// preview using shared preview-tokens, "stored as $name" line, and
// per-section reset button when override active.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import TemplateSection from "./TemplateSection.vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";

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
  it("textarea reads payload.template when no override is set", () => {
    const w = mount(TemplateSection, { props: { module: makeModule() } });
    const ta = w.find<HTMLTextAreaElement>('[data-test="tpl-textarea"]').element;
    expect(ta.value).toBe("$style portrait");
  });

  it("textarea reads instance.template_override when set", () => {
    const w = mount(TemplateSection, {
      props: {
        module: makeModule({
          instance: { template_override: "{moody|cinematic} $style portrait of $subject" },
        }),
      },
    });
    const ta = w.find<HTMLTextAreaElement>('[data-test="tpl-textarea"]').element;
    expect(ta.value).toBe("{moody|cinematic} $style portrait of $subject");
  });

  it("typing emits instance.template_override patch", async () => {
    const w = mount(TemplateSection, { props: { module: makeModule() } });
    const ta = w.find<HTMLTextAreaElement>('[data-test="tpl-textarea"]');
    ta.element.value = "$style epic shot of $subject";
    await ta.trigger("input");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.template_override).toBe("$style epic shot of $subject");
  });

  it("typing back to library default collapses override to null", async () => {
    const w = mount(TemplateSection, {
      props: {
        module: makeModule({ instance: { template_override: "$style epic shot" } }),
      },
    });
    const ta = w.find<HTMLTextAreaElement>('[data-test="tpl-textarea"]');
    ta.element.value = "$style portrait"; // matches library default
    await ta.trigger("input");
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

  // ── Insert-var dropdown ─────────────────────────────────────────

  it("insert-var button hidden when no upstream/sibling vars", () => {
    const w = mount(TemplateSection, { props: { module: makeModule() } });
    expect(w.find('[data-test="tpl-insert-var"]').exists()).toBe(false);
  });

  it("insert-var button visible when upstream vars present, opens menu on click", async () => {
    const w = mount(TemplateSection, {
      props: { module: makeModule(), upstreamVars: ["color", "shape"] },
    });
    expect(w.find('[data-test="tpl-insert-var"]').exists()).toBe(true);
    expect(w.find('[data-test="tpl-var-menu"]').exists()).toBe(false);
    await w.find('[data-test="tpl-insert-var"]').trigger("click");
    expect(w.find('[data-test="tpl-var-menu"]').exists()).toBe(true);
    expect(w.findAll('[data-test^="tpl-var-item-"]')).toHaveLength(2);
  });

  it("clicking a var menu item appends $name to template + emits override", async () => {
    const w = mount(TemplateSection, {
      props: {
        module: makeModule({
          payload: { output_var: "out", template: "" },
        }),
        upstreamVars: ["mood"],
      },
    });
    await w.find('[data-test="tpl-insert-var"]').trigger("click");
    await w.find('[data-test="tpl-var-item-mood"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.template_override).toBe("$mood");
  });

  it("dedupes upstream + sibling vars and sorts alphabetically", () => {
    const w = mount(TemplateSection, {
      props: {
        module: makeModule(),
        upstreamVars: ["zebra", "alpha"],
        siblingVars: ["alpha", "mango"],
      },
    });
    void w.find('[data-test="tpl-insert-var"]').trigger("click");
    return w.vm.$nextTick().then(() => {
      const items = w.findAll('[data-test^="tpl-var-item-"]');
      const names = items.map((i) => i.text());
      expect(names).toEqual(["$alpha", "$mango", "$zebra"]);
    });
  });
});
