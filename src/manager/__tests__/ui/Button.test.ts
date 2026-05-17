import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Button from "../../components/ui/Button.vue";

describe("Button.vue", () => {
  it("renders variant + size class", () => {
    const wrap = mount(Button, {
      props: { variant: "primary", size: "sm" },
      slots: { default: "Save" },
    });
    const cls = wrap.get("button").classes();
    expect(cls).toContain("wp-btn");
    expect(cls).toContain("wp-btn--primary");
    expect(cls).toContain("wp-btn--sm");
  });

  it("emits click and forwards ariaLabel", async () => {
    const wrap = mount(Button, {
      props: { ariaLabel: "Save changes" },
      slots: { default: "Save" },
    });
    expect(wrap.get("button").attributes("aria-label")).toBe("Save changes");
    await wrap.get("button").trigger("click");
    expect(wrap.emitted("click")).toBeTruthy();
  });

  it("does not emit click when disabled", async () => {
    const wrap = mount(Button, { props: { disabled: true }, slots: { default: "x" } });
    await wrap.get("button").trigger("click");
    expect(wrap.emitted("click")).toBeFalsy();
  });
});

// ---------- Variant × State matrix ----------

const VARIANTS = ["primary", "secondary", "ghost", "danger", "link", "outline"] as const;

describe("Button variants × states", () => {
  for (const variant of VARIANTS) {
    describe(variant, () => {
      it("renders default state", () => {
        const wrap = mount(Button, { props: { variant }, slots: { default: "X" } });
        const btn = wrap.get("button");
        expect(btn.classes()).toContain(`wp-btn--${variant}`);
        expect(btn.attributes("disabled")).toBeUndefined();
        expect(btn.attributes("aria-busy")).toBeUndefined();
      });

      it("renders disabled state", () => {
        const wrap = mount(Button, { props: { variant, disabled: true }, slots: { default: "X" } });
        const btn = wrap.get("button");
        expect(btn.attributes("disabled")).toBeDefined();
        expect(btn.attributes("aria-busy")).toBeUndefined();
      });

      it("renders loading state (aria-busy + disabled + spinner)", () => {
        const wrap = mount(Button, { props: { variant, loading: true }, slots: { default: "X" } });
        const btn = wrap.get("button");
        expect(btn.attributes("aria-busy")).toBe("true");
        expect(btn.attributes("disabled")).toBeDefined();
        expect(btn.find(".pi-spinner").exists()).toBe(true);
      });

      it("does not emit click when loading", async () => {
        const wrap = mount(Button, { props: { variant, loading: true }, slots: { default: "X" } });
        await wrap.get("button").trigger("click");
        expect(wrap.emitted("click")).toBeFalsy();
      });

      it("forwards icon prop and aria-label", () => {
        const wrap = mount(Button, {
          props: { variant, icon: "pi-plus", ariaLabel: `${variant} action` },
        });
        const btn = wrap.get("button");
        expect(btn.attributes("aria-label")).toBe(`${variant} action`);
        expect(btn.find(".pi-plus").exists()).toBe(true);
      });
    });
  }
});
