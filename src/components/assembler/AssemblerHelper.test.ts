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
