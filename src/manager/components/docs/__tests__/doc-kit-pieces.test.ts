import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import DocPage from "../DocPage.vue";
import DocImage from "../DocImage.vue";
import DocCallout from "../DocCallout.vue";
import DocDetails from "../DocDetails.vue";
import DocKeyList from "../DocKeyList.vue";
import type { DocTone } from "../../../docs/registry";

const base = { group: "Nodes", title: "WP Context", icon: "pi pi-sitemap", tone: "node" as DocTone, blurb: "x" };

afterEach(() => { document.body.innerHTML = ""; });

function pageWith(...shots: { src: string; caption: string }[]) {
  return defineComponent({
    render: () => h(DocPage, base, { default: () => shots.map((s) => h(DocImage, s)) }),
  });
}

describe("DocImage on a DocPage", () => {
  it("opens the page's Lightbox at the clicked image and steps through the others in page order", async () => {
    const w = mount(pageWith(
      { src: "images/a.png", caption: "First" },
      { src: "images/b.png", caption: "Second" },
      { src: "images/c.png", caption: "Third" },
    ), { attachTo: document.body });
    await w.findAll("[data-test=doc-image-open]")[1].trigger("click");
    await flushPromises();
    expect(document.querySelector(".wp-lightbox__count")?.textContent).toBe("2 / 3");
    expect(document.querySelector(".wp-lightbox__caption")?.textContent).toBe("Second");
    (document.querySelector('.wp-lightbox__step[data-dir="next"]') as HTMLButtonElement).click();
    await flushPromises();
    expect(document.querySelector(".wp-lightbox__caption")?.textContent).toBe("Third");
    w.unmount();
  });

  it("leaves a placeholder out of the gallery", async () => {
    const w = mount(pageWith({ src: "images/a.png", caption: "Real" }), { attachTo: document.body });
    await w.get("[data-test=doc-image-open]").trigger("click");
    await flushPromises();
    expect(document.querySelector(".wp-lightbox__count")).toBeNull();
    expect(document.querySelector(".wp-lightbox__caption")?.textContent).toBe("Real");
    w.unmount();
  });

  it("opens a Lightbox of its own outside a DocPage", async () => {
    const w = mount(DocImage, { props: { src: "images/a.png", caption: "Alone" }, attachTo: document.body });
    await w.get("[data-test=doc-image-open]").trigger("click");
    await flushPromises();
    expect(document.querySelector(".wp-lightbox__caption")?.textContent).toBe("Alone");
    w.unmount();
  });
});

describe("docs on kit pieces", () => {
  it("DocCallout is a Banner that is page text, not a live region", () => {
    const w = mount(DocCallout, { props: { variant: "danger" }, slots: { default: "Careful" } });
    expect(w.classes()).toContain("wp-banner");
    expect(w.classes()).toContain("wp-doc-callout");
    expect(w.attributes("data-tone")).toBe("danger");
    expect(w.attributes("role")).toBe("note");
  });

  it("DocDetails folds its body under a Disclosure heading", async () => {
    const w = mount(DocDetails, { slots: { default: "<p>Inside</p>" } });
    const btn = w.get(".wp-disclosure__trigger");
    expect(btn.text()).toContain("How it works");
    expect(btn.attributes("aria-expanded")).toBe("false");
    await btn.trigger("click");
    expect(btn.attributes("aria-expanded")).toBe("true");
    expect(w.text()).toContain("Inside");
  });

  it("DocKeyList draws a row's key with Kbd", () => {
    const w = mount(DocKeyList, { props: { items: [{ term: "Keep", kbd: "Enter", desc: "d" }, { term: "Plain", desc: "e" }] } });
    expect(w.findAll(".wp-kbd-keys")).toHaveLength(1);
    expect(w.get(".wp-kbd-keys").attributes("aria-label")).toBe("Enter");
  });
});
