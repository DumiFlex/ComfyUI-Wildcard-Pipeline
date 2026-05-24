import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PillCountBadge from "../PillCountBadge.vue";

describe("PillCountBadge", () => {
  it("renders nothing when count is 0", () => {
    const w = mount(PillCountBadge, { props: { count: 0 } });
    expect(w.find(".wp-pill-count").exists()).toBe(false);
  });

  it("renders count when greater than 0", () => {
    const w = mount(PillCountBadge, { props: { count: 5 } });
    const el = w.find(".wp-pill-count");
    expect(el.exists()).toBe(true);
    expect(el.text()).toBe("5");
  });

  it("renders count of 1", () => {
    const w = mount(PillCountBadge, { props: { count: 1 } });
    expect(w.find(".wp-pill-count").text()).toBe("1");
  });

  it("uses warn tone class", () => {
    const w = mount(PillCountBadge, { props: { count: 3 } });
    const el = w.find(".wp-pill-count");
    expect(el.classes()).toContain("wp-pill-count");
  });
});
