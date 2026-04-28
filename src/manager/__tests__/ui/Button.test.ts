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
