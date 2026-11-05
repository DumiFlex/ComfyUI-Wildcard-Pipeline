import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import DocAnnotated from "../DocAnnotated.vue";
import { numberedPins } from "../../../docs/pins";

describe("DocAnnotated", () => {
  const src = "/images/docs/wp-toggles.png";

  it("draws a numbered pin per field and a legend line for each", () => {
    const w = mount(DocAnnotated, { props: { src, caption: "WP Toggles", ratio: "1720 / 860" } });
    const want = numberedPins(src);
    const pins = w.findAll('[data-test="doc-pin"]');
    expect(pins).toHaveLength(want.length);
    expect(pins[0]?.text()).toBe("1");
    const rows = w.findAll('[data-test="doc-pin-legend"] li');
    expect(rows).toHaveLength(want.length);
    expect(rows[0]?.text()).toContain(want[0]?.term ?? "");
  });

  it("shows no legend for a picture without pins", () => {
    const w = mount(DocAnnotated, { props: { src: "/images/docs/none.png", caption: "x" } });
    expect(w.find('[data-test="doc-pin-legend"]').exists()).toBe(false);
  });
});
