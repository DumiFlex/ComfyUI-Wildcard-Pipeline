import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AssemblerHelper from "./AssemblerHelper.vue";

const baseProps = {
  upstreamResolved: {} as Record<string, string>,
  template: "",
  onInsert: () => {},
};

describe("AssemblerHelper.vue", () => {
  it("renders a chip for each upstream variable", () => {
    const wrapper = mount(AssemblerHelper, {
      props: { ...baseProps, upstreamResolved: { style: "noir", subject: "fox" } },
    });
    expect(wrapper.findAll('[data-testid="chip"]')).toHaveLength(2);
  });

  it("calls onInsert with $var when chip is clicked", async () => {
    let inserted = "";
    const wrapper = mount(AssemblerHelper, {
      props: {
        ...baseProps,
        upstreamResolved: { style: "noir" },
        onInsert: (s: string) => { inserted = s; },
      },
    });
    await wrapper.find('[data-testid="chip"]').trigger("click");
    expect(inserted).toBe("$style");
  });

  it("renders an empty hint when no upstream vars", () => {
    const wrapper = mount(AssemblerHelper, { props: baseProps });
    expect(wrapper.text()).toContain("Connect a Pipeline Context");
  });

  it("highlights resolved values in the preview HTML", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        ...baseProps,
        upstreamResolved: { style: "cinematic", subject: "fox" },
        template: "A $style portrait of $subject",
      },
    });
    const html = wrapper.find(".wp-asm__rendered").html();
    expect(html).toContain("wp-tok-resolved");
    expect(html).toContain("cinematic");
    expect(html).toContain("fox");
  });

  it("flags unresolved $name with missing token + UNRESOLVED chip", () => {
    // Genuinely unbound: `$missing` is not present in upstreamResolved.
    // The unification means there's no longer a "name known but value
    // unknown" middle state — every var the resolver finds carries a
    // value (option [0] for runtime-random kinds), so missing == truly
    // missing.
    const wrapper = mount(AssemblerHelper, {
      props: {
        ...baseProps,
        upstreamResolved: { style: "noir" },
        template: "$style and $missing",
      },
    });
    const rendered = wrapper.find(".wp-asm__rendered").html();
    expect(rendered).toContain("wp-tok-resolved");
    expect(rendered).toContain("wp-tok-miss");
    // Chip text starts with `$missing` — when an `onRemoveVar` callback
    // is wired the chip becomes a button with a trailing × glyph, so
    // we assert via startsWith rather than equality.
    expect(wrapper.find('[data-testid="missing-chip"]').text()).toContain("$missing");
  });

  it("clicking a missing-chip calls onRemoveVar with the bare varname", async () => {
    let removed = "";
    const wrapper = mount(AssemblerHelper, {
      props: {
        ...baseProps,
        upstreamResolved: {},
        template: "$missing portrait",
        onRemoveVar: (v: string) => { removed = v; },
      },
    });
    await wrapper.find('[data-testid="missing-chip"]').trigger("click");
    expect(removed).toBe("missing");
  });

  it("renders the preview seed in the header label", () => {
    const wrapper = mount(AssemblerHelper, {
      props: { ...baseProps, template: "x", previewSeed: 42 },
    });
    const labelText = wrapper.find(".wp-asm__label-seed").text();
    expect(labelText).toBe("42");
  });

  it("marks chips of in-template vars as `used`, others as `available`", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        ...baseProps,
        upstreamResolved: { style: "noir", subject: "knight" },
        template: "$style only",
      },
    });
    const chips = wrapper.findAll('[data-testid="chip"]');
    expect(chips[0].classes()).toContain("used");
    expect(chips[1].classes()).toContain("available");
  });

  it("$$ escape stays literal and does not produce a missing chip", () => {
    const wrapper = mount(AssemblerHelper, {
      props: { ...baseProps, template: "$$cost is 5" },
    });
    expect(wrapper.find(".wp-asm__rendered").text()).toContain("$cost is 5");
    expect(wrapper.find('[data-testid="missing-chip"]').exists()).toBe(false);
  });

  it("escapes HTML in upstream values to prevent injection", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        ...baseProps,
        upstreamResolved: { x: "<script>alert(1)</script>" },
        template: "$x",
      },
    });
    const html = wrapper.find(".wp-asm__rendered").html();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
