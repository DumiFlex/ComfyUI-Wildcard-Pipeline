import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AboutSection from "../sections/AboutSection.vue";
import { KIT_SITE, kitVersion } from "../../../config/links";

describe("kitVersion", () => {
  it("names the installed package version and links its release", () => {
    expect(kitVersion({ version: "0.3.0" })).toEqual({
      label: "v0.3.0",
      href: "https://github.com/DumiFlex/wp-kit/releases/tag/v0.3.0",
    });
  });
});

describe("AboutSection", () => {
  it("shows the kit version and links the kit site", () => {
    const wrap = mount(AboutSection);
    expect(wrap.get('[data-test="about-kit-version"]').text()).toBe("wp-kit v0.0.0-test");
    expect(wrap.get('[data-test="about-kit-site"]').attributes("href")).toBe(KIT_SITE);
  });
});
