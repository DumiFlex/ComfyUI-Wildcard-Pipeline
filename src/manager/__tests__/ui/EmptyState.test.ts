import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import EmptyState from "../../components/ui/EmptyState.vue";

describe("EmptyState.vue", () => {
  it("renders icon, headline, body", () => {
    const wrap = mount(EmptyState, {
      props: {
        icon: "pi-sparkles",
        headline: "No wildcards yet",
        body: "Create your first wildcard to get started.",
      },
    });
    expect(wrap.find(".pi-sparkles").exists()).toBe(true);
    expect(wrap.text()).toContain("No wildcards yet");
    expect(wrap.text()).toContain("Create your first wildcard");
  });

  it("renders cta slot when provided", () => {
    const wrap = mount(EmptyState, {
      props: { icon: "pi-sparkles", headline: "X", body: "" },
      slots: { cta: '<button data-test="cta">New</button>' },
    });
    expect(wrap.find('[data-test="cta"]').exists()).toBe(true);
  });

  it("library variant is default", () => {
    const wrap = mount(EmptyState, {
      props: { icon: "pi-sparkles", headline: "X", body: "" },
    });
    expect(wrap.classes()).toContain("wp-empty--library");
  });

  it("supports no-results variant", () => {
    const wrap = mount(EmptyState, {
      props: { icon: "pi-sparkles", headline: "X", body: "", variant: "no-results" },
    });
    expect(wrap.classes()).toContain("wp-empty--no-results");
  });

  it("omits body when not provided", () => {
    const wrap = mount(EmptyState, {
      props: { icon: "pi-sparkles", headline: "X" },
    });
    expect(wrap.find(".wp-empty__body").exists()).toBe(false);
  });
});
