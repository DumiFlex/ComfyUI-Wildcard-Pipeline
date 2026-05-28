import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import DocPage from "../DocPage.vue";
import type { DocTone } from "../../../docs/registry";

const base = { group: "Nodes", title: "WP Context", icon: "pi pi-sitemap", tone: "node" as DocTone, blurb: "x" };

describe("DocPage", () => {
  it("renders title, blurb, breadcrumb", () => {
    const w = mount(DocPage, { props: base, slots: { default: "<p>body</p>" } });
    expect(w.get(".wp-doc-page__title").text()).toBe("WP Context");
    expect(w.text()).toContain("body");
    expect(w.text()).toContain("Nodes");
  });
  it("shows the node-id chip only when nodeId is set", () => {
    expect(mount(DocPage, { props: base }).find(".wp-doc-page__idchip").exists()).toBe(false);
    const w = mount(DocPage, { props: { ...base, nodeId: "WP_Context" } });
    expect(w.get(".wp-doc-page__idchip").text()).toBe("WP_Context");
  });
});
