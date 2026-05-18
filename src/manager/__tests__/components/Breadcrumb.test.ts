import { mount, RouterLinkStub } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Breadcrumb from "../../components/Breadcrumb.vue";

describe("Breadcrumb", () => {
  it("renders all segments in order", () => {
    const wrap = mount(Breadcrumb, {
      props: {
        items: [
          { to: "/", label: "Library" },
          { to: "/wildcards", label: "Wildcards" },
          { label: "mood" },
        ],
      },
      global: { stubs: { RouterLink: RouterLinkStub } },
    });
    const texts = wrap.findAll('[data-test="bc-segment"]').map((n) => n.text());
    expect(texts).toEqual(["Library", "Wildcards", "mood"]);
  });

  it("last segment is text (not a link), aria-current=page", () => {
    const wrap = mount(Breadcrumb, {
      props: {
        items: [
          { to: "/", label: "Library" },
          { label: "Editing X" },
        ],
      },
      global: { stubs: { RouterLink: RouterLinkStub } },
    });
    const segs = wrap.findAll('[data-test="bc-segment"]');
    expect(segs[0].findComponent(RouterLinkStub).exists()).toBe(true);
    expect(segs[1].findComponent(RouterLinkStub).exists()).toBe(false);
    expect(segs[1].attributes("aria-current")).toBe("page");
  });

  it("renders separators between segments", () => {
    const wrap = mount(Breadcrumb, {
      props: {
        items: [
          { to: "/", label: "Library" },
          { to: "/wildcards", label: "Wildcards" },
          { label: "mood" },
        ],
      },
      global: { stubs: { RouterLink: RouterLinkStub } },
    });
    const seps = wrap.findAll(".wp-breadcrumb__sep");
    // 3 segments → 2 separators
    expect(seps.length).toBe(2);
  });

  it("non-final segment with `to` is a link; without `to` renders as text", () => {
    const wrap = mount(Breadcrumb, {
      props: {
        items: [
          { label: "Library" },  // no `to` → still text even though not last
          { to: "/wildcards", label: "Wildcards" },
          { label: "mood" },
        ],
      },
      global: { stubs: { RouterLink: RouterLinkStub } },
    });
    const segs = wrap.findAll('[data-test="bc-segment"]');
    expect(segs[0].findComponent(RouterLinkStub).exists()).toBe(false);
    expect(segs[1].findComponent(RouterLinkStub).exists()).toBe(true);
  });
});
