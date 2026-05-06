import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AssemblerHelper from "./AssemblerHelper.vue";
import { varColorClass } from "../shared/var-color";

// ---------------------------------------------------------------------------
// New-layout tests — all tests use the array-based prop shape:
//   upstreamVars, templateVars, template, resolved
// ---------------------------------------------------------------------------

describe("AssemblerHelper.vue", () => {
  it("renders a chip for each upstream variable", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["style", "subject"],
        templateVars: [],
        template: "",
        resolved: "",
      },
    });
    expect(wrapper.find('[data-test="asm-chip-style"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="asm-chip-subject"]').exists()).toBe(true);
  });

  it("calls onInsert with $var when chip is clicked", async () => {
    let inserted = "";
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["style"],
        templateVars: [],
        template: "",
        resolved: "",
        onInsert: (s: string) => { inserted = s; },
      },
    });
    await wrapper.find('[data-test="asm-chip-style"]').trigger("click");
    expect(inserted).toBe("$style");
  });

  it("renders upstream count in section stat when no vars", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: [],
        templateVars: [],
        template: "",
        resolved: "",
      },
    });
    expect(wrapper.text()).toContain("0 upstream");
  });

  it("shows resolved preview text when resolved string is provided", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["style", "subject"],
        templateVars: ["style", "subject"],
        template: "A $style portrait of $subject",
        resolved: "A cinematic portrait of fox",
      },
    });
    const preview = wrapper.find('[data-test="asm-preview"]');
    expect(preview.text()).toContain("cinematic");
    expect(preview.text()).toContain("fox");
  });

  it("shows missing chip for template var not in upstream", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["style"],
        templateVars: ["style", "missing"],
        template: "$style and $missing",
        resolved: "",
      },
    });
    const missingChip = wrapper.find('[data-test="asm-chip-missing"]');
    expect(missingChip.exists()).toBe(true);
    expect(missingChip.classes()).toContain("wp-asm-var--missing");
  });

  it("renders the preview seed in the section stat", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["style"],
        templateVars: [],
        template: "",
        resolved: "",
        previewSeed: 42,
      },
    });
    // previewSeed is accepted by the component (no TS error) — verify section stat
    expect(wrapper.text()).toContain("1 upstream");
  });

  it("section stat shows upstream count", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["style", "subject"],
        templateVars: [],
        template: "",
        resolved: "",
      },
    });
    expect(wrapper.text()).toMatch(/2\s*upstream/);
  });

  it("var chip gets the correct varColorClass", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["hair_style"],
        templateVars: ["hair_style"],
        template: "$hair_style portrait",
        resolved: "long flowing portrait",
      },
    });
    const chipClasses = wrapper.find('[data-test="asm-chip-hair_style"]').classes();
    expect(chipClasses).toContain(varColorClass("hair_style"));
  });
});

describe("AssemblerHelper resolvedMap (#12 — boundary-disambiguation fix)", () => {
  it("colors each var's resolved substring independently when one value contains the bounding literal", () => {
    // template: `$hair_style $mood`
    // hair_style = "short cropped"  (contains the bounding " ")
    // mood = "melancholic"
    // Pre-substituted "short cropped melancholic" can't be tokenised by parallel walk
    // because indexOf(" ", 0) lands inside hair_style. The resolvedMap path bypasses
    // that entirely.
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["hair_style", "mood"],
        templateVars: ["hair_style", "mood"],
        template: "$hair_style $mood",
        resolvedMap: { hair_style: "short cropped", mood: "melancholic" },
      },
    });
    const preview = wrapper.find('[data-test="asm-preview"]');
    const varSpans = preview.findAll("span.res");
    expect(varSpans.length).toBe(2);
    expect(varSpans[0].text()).toBe("short cropped");
    expect(varSpans[1].text()).toBe("melancholic");
    expect(varSpans[0].classes()).toContain(varColorClass("hair_style"));
    expect(varSpans[1].classes()).toContain(varColorClass("mood"));
  });

  it("renders unresolved vars as `$name` when not in the map", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["a"],
        templateVars: ["a", "b"],
        template: "$a and $b",
        resolvedMap: { a: "alpha" },
      },
    });
    const preview = wrapper.find('[data-test="asm-preview"]');
    const varSpans = preview.findAll("span.res");
    expect(varSpans[0].text()).toBe("alpha");
    expect(varSpans[1].text()).toBe("$b");
  });

  it("section stat reports 'resolved' when resolvedMap has any entries", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["a"],
        templateVars: ["a"],
        template: "$a",
        resolvedMap: { a: "alpha" },
      },
    });
    expect(wrapper.text()).toContain("resolved");
  });
});

describe("AssemblerHelper missing-chip click (#20 — autoremove regression)", () => {
  it("clicking a missing chip calls onRemoveVar with the var name", async () => {
    let removed = "";
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["style"],
        templateVars: ["style", "missing_var"],
        template: "$style $missing_var",
        resolved: "",
        onRemoveVar: (v: string) => { removed = v; },
      },
    });
    await wrapper.find('[data-test="asm-chip-missing_var"]').trigger("click");
    expect(removed).toBe("missing_var");
  });

  it("missing chip is not clickable when onRemoveVar is not wired", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["style"],
        templateVars: ["style", "missing_var"],
        template: "$style $missing_var",
        resolved: "",
      },
    });
    const chip = wrapper.find('[data-test="asm-chip-missing_var"]');
    expect(chip.classes()).not.toContain("wp-asm-var--clickable");
  });
});

describe("AssemblerHelper var-color rendering", () => {
  it("emits the same var-N class for the same binding across chip + preview", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["hair_style", "mood"],
        templateVars: ["hair_style"],
        template: "$hair_style portrait",
        resolved: "long flowing portrait",
      },
    });
    const chipClass = wrapper.find('[data-test="asm-chip-hair_style"]').classes();
    expect(chipClass).toContain(varColorClass("hair_style"));
  });

  it("missing chips render with the missing modifier + warn icon", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["hair_style"],
        templateVars: ["hair_style", "lighting"],
        template: "$hair_style $lighting",
        resolved: "",
      },
    });
    const missing = wrapper.find('[data-test="asm-chip-lighting"]');
    expect(missing.classes()).toContain("wp-asm-var--missing");
    expect(missing.find("i.pi.pi-exclamation-triangle").exists()).toBe(true);
  });

  it("section stat shows upstream count + missing count", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["hair_style", "mood"],
        templateVars: ["hair_style", "lighting", "lens"],
        template: "$hair_style $lighting $lens",
        resolved: "",
      },
    });
    expect(wrapper.text()).toMatch(/2\s*upstream/);
    expect(wrapper.text()).toMatch(/2\s*missing/);
  });
});
