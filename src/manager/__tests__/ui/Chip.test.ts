import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Chip from "../../components/ui/Chip.vue";

describe("Chip.vue", () => {
  it("emits remove when close button clicked", async () => {
    const wrap = mount(Chip, {
      props: { removable: true },
      slots: { default: "tag" },
    });
    await wrap.get(".wp-chip__close").trigger("click");
    expect(wrap.emitted("remove")).toBeTruthy();
  });

  it("applies tone class", () => {
    const wrap = mount(Chip, { props: { tone: "success" }, slots: { default: "ok" } });
    expect(wrap.get("span.wp-chip").classes()).toContain("wp-chip--success");
  });
});
