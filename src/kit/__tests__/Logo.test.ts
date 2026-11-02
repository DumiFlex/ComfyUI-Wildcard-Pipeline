import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import Logo from "../Logo.vue";

describe("Logo", () => {
  it("names itself unless decorative", () => {
    expect(mount(Logo).attributes("aria-label")).toBe("Wildcard Pipeline");
    const d = mount(Logo, { props: { decorative: true } });
    expect(d.attributes("aria-label")).toBeUndefined();
    expect(d.attributes("aria-hidden")).toBe("true");
  });

  it("gives every logo its own gradient ids", () => {
    const ids = [mount(Logo), mount(Logo)].map((w) => w.find("linearGradient").attributes("id"));
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("draws the extension colours by default and the community ones on ask", () => {
    expect(mount(Logo).html()).toContain("#a970ff");
    const c = mount(Logo, { props: { brand: "community" } }).html();
    expect(c).toContain("#da7550");
    expect(c).not.toContain("#a970ff");
  });
});
