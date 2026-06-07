// RichTextPreview — read-only chip renderer used by canvas modals,
// TestRunner, and the SPA wildcard / combine editors. Pins two
// behaviors that the constraint-modal QA caught regressions on:
//   1. Nested-ref tokens written as `@{uuid:expr}` MUST surface their
//      filter. Per SP1 §4.1 the expression is NOT inline (it can be
//      long) — a funnel indicator (`refchip-filter`) marks "filtered"
//      and the normalized "reads as" expression lives in the hover
//      title. Dropping the indicator would silently hide that the chip
//      is narrowed even though the value string still carries it.
//   2. Refs whose name isn't in the caller-supplied `uuidToName` map
//      fall through to the preview-resolver cache. Refs known to
//      neither source render as the red "unresolved" chip; resolved
//      ones render as the purple ref chip with the chosen name.

import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import RichTextPreview from "../components/RichTextPreview.vue";
import { _resetForTests, _setForTests } from "../../extension/preview-resolver";

describe("RichTextPreview", () => {
  beforeEach(() => _resetForTests());

  it("renders a nested-ref chip with the funnel filter indicator when the value carries `:expr` (not inline)", () => {
    // SP1 (§4.1): the filter expression is NOT shown inline (it can be
    // long) — a funnel indicator marks "filtered" and the expression
    // lives in the hover title via "reads as".
    const w = mount(RichTextPreview, {
      props: {
        value: "i love @{c0f09840:test8}",
        uuidToName: new Map([["c0f09840", "test2"]]),
      },
    });
    const label = w.find(".wp-refchip__label");
    expect(label.exists()).toBe(true);
    expect(label.text()).toBe("@test2");
    expect(w.find('[data-test="refchip-filter"]').exists()).toBe(true);
    expect(w.find(".wp-refchip").text()).not.toContain("test8");
    expect(w.find(".wp-refchip").attributes("title")).toContain("test8");
  });

  it("surfaces a multi-term expression in the hover title (reads-as)", () => {
    const w = mount(RichTextPreview, {
      props: {
        value: "@{c0f09840:warm,bright}",
        uuidToName: new Map([["c0f09840", "color"]]),
      },
    });
    // `warm,bright` (comma shorthand) reads as `warm or bright`.
    const title = w.find(".wp-refchip").attributes("title") ?? "";
    expect(title).toContain("warm");
    expect(title).toContain("bright");
    expect(w.find('[data-test="refchip-filter"]').exists()).toBe(true);
  });

  it("omits the filter indicator when the ref has no sub-category filter", () => {
    const w = mount(RichTextPreview, {
      props: {
        value: "@{c0f09840}",
        uuidToName: new Map([["c0f09840", "test2"]]),
      },
    });
    expect(w.find(".wp-refchip__label").text()).toBe("@test2");
    expect(w.find('[data-test="refchip-filter"]').exists()).toBe(false);
  });

  it("falls back to the preview-resolver cache when the uuid isn't in the caller map", () => {
    // Mirrors Bug 1 fix: constraint modal's `uuidToName` is built from
    // sibling modules only; refs targeting library-only or cross-node
    // wildcards must still resolve via the cache, otherwise the chip
    // renders red even though the wildcard exists.
    _setForTests("c0f09840", { name: "library_test2", varBinding: "lib_var" });
    const w = mount(RichTextPreview, {
      props: {
        value: "@{c0f09840}",
        uuidToName: new Map(),
      },
    });
    const chip = w.find(".wp-refchip");
    expect(chip.exists()).toBe(true);
    expect(chip.classes()).not.toContain("wp-refchip--unresolved");
    expect(w.find(".wp-refchip__label").text()).toBe("@lib_var");
  });

  it("renders the red unresolved chip when neither uuidToName nor the cache knows the uuid", () => {
    const w = mount(RichTextPreview, {
      props: {
        value: "@{deadbeef}",
        uuidToName: new Map(),
      },
    });
    const chip = w.find(".wp-refchip");
    expect(chip.classes()).toContain("wp-refchip--unresolved");
  });
});
