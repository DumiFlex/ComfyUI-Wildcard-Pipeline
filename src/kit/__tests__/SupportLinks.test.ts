import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SupportLinks from "../SupportLinks.vue";

const LINKS = [
  { id: "github", label: "Sponsor on GitHub", detail: "Monthly or one-time.", icon: "pi-heart", href: "https://github.com/sponsors/x" },
  { id: "paypal", label: "PayPal", icon: "pi-paypal", href: "https://paypal.me/x" },
];

describe("SupportLinks.vue", () => {
  it("draws one outside link per entry", () => {
    const wrap = mount(SupportLinks, { props: { links: LINKS } });
    const links = wrap.findAll("a");
    expect(links).toHaveLength(2);
    expect(links[0]?.attributes()).toMatchObject({ href: LINKS[0]?.href, target: "_blank", rel: "noopener", "data-kind": "github" });
    expect(links[0]?.find(".pi-heart").exists()).toBe(true);
    expect(links[0]?.text()).toContain("Monthly or one-time.");
  });

  it("leaves the detail line out when there is none, and names the list", () => {
    const wrap = mount(SupportLinks, { props: { links: LINKS, label: "Donate" } });
    expect(wrap.findAll(".wp-support__detail")).toHaveLength(1);
    expect(wrap.find("ul").attributes("aria-label")).toBe("Donate");
    expect(wrap.text()).toContain("(opens in a new tab)");
  });
});
