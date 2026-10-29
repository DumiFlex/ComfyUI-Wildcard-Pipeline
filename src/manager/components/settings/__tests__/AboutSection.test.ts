import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AboutSection from "../sections/AboutSection.vue";
import { KIT_SITE, kitVersion } from "../../../config/links";

describe("kitVersion", () => {
  it("names a release tag with its commit and links the release", () => {
    expect(kitVersion({ ref: "v0.1.0", sha: "f3841a344deba5f9" })).toEqual({
      label: "v0.1.0 · f3841a3",
      href: "https://github.com/DumiFlex/wp-kit/releases/tag/v0.1.0",
    });
  });

  it("names a branch or commit pull by its short commit and links the tree", () => {
    expect(kitVersion({ ref: "dev", sha: "f3841a344deba5f9" })).toEqual({
      label: "f3841a3",
      href: "https://github.com/DumiFlex/wp-kit/tree/f3841a344deba5f9",
    });
  });
});

describe("AboutSection", () => {
  it("shows the kit version and links the kit site", () => {
    const wrap = mount(AboutSection);
    expect(wrap.get('[data-test="about-kit-version"]').text()).toBe("wp-kit v0.0.0-test · 0123456");
    expect(wrap.get('[data-test="about-kit-site"]').attributes("href")).toBe(KIT_SITE);
  });
});
