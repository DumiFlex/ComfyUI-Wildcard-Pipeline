import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AssemblerHelper from "./AssemblerHelper.vue";

const baseProps = {
  upstreamVars: [] as string[],
  upstreamValues: {} as Record<string, string>,
  template: "",
  onInsert: () => {},
};

describe("AssemblerHelper.vue", () => {
  it("renders a chip for each upstream variable", () => {
    const wrapper = mount(AssemblerHelper, {
      props: { ...baseProps, upstreamVars: ["style", "subject"] },
    });
    expect(wrapper.findAll('[data-testid="chip"]')).toHaveLength(2);
  });

  it("calls onInsert with $var when chip is clicked", async () => {
    let inserted = "";
    const wrapper = mount(AssemblerHelper, {
      props: { ...baseProps, upstreamVars: ["style"], onInsert: (s: string) => { inserted = s; } },
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
        upstreamVars: ["style", "subject"],
        upstreamValues: { style: "cinematic", subject: "fox" },
        template: "A $style portrait of $subject",
      },
    });
    const html = wrapper.find(".wp-asm__rendered").html();
    expect(html).toContain("wp-tok-resolved");
    expect(html).toContain("cinematic");
    expect(html).toContain("fox");
  });

  it("flags unresolved $name with missing token + UNRESOLVED chip", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        ...baseProps,
        upstreamValues: { style: "noir" },
        upstreamVars: ["style"],
        template: "$style and $missing",
      },
    });
    const rendered = wrapper.find(".wp-asm__rendered").html();
    expect(rendered).toContain("wp-tok-resolved");
    expect(rendered).toContain("wp-tok-miss");
    expect(wrapper.find('[data-testid="missing-chip"]').text()).toBe("$missing");
  });

  it("marks chips of in-template upstream vars as `used` (green) and others as `available` (blue)", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        ...baseProps,
        upstreamVars: ["style", "subject"],
        upstreamValues: { style: "noir", subject: "knight" },
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
        upstreamVars: ["x"],
        upstreamValues: { x: "<script>alert(1)</script>" },
        template: "$x",
      },
    });
    const html = wrapper.find(".wp-asm__rendered").html();
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
