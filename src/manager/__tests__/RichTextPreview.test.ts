// RichTextPreview — read-only chip renderer used by canvas modals,
// TestRunner, and the SPA wildcard / combine editors. Pins two
// behaviors that the constraint-modal QA caught regressions on:
//   1. Nested-ref tokens written as `@{uuid:subcat}` MUST render with
//      the sub-category suffix span. Dropping it would silently strip
//      the chosen sub-cat from the chip even though the underlying
//      value string still carries it.
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

  it("renders a nested-ref chip with the sub-category suffix when the value carries `:subcat`", () => {
    const w = mount(RichTextPreview, {
      props: {
        value: "i love @{c0f09840:test8}",
        uuidToName: new Map([["c0f09840", "test2"]]),
      },
    });
    const label = w.find(".wp-refchip__label");
    const suffix = w.find(".wp-refchip__suffix");
    expect(label.exists()).toBe(true);
    expect(label.text()).toBe("@test2");
    expect(suffix.exists()).toBe(true);
    expect(suffix.text()).toContain("test8");
  });

  it("renders multiple sub-categories joined by comma", () => {
    const w = mount(RichTextPreview, {
      props: {
        value: "@{c0f09840:warm,bright}",
        uuidToName: new Map([["c0f09840", "color"]]),
      },
    });
    expect(w.find(".wp-refchip__suffix").text()).toContain("warm");
    expect(w.find(".wp-refchip__suffix").text()).toContain("bright");
  });

  it("omits the suffix span when the ref has no sub-category filter", () => {
    const w = mount(RichTextPreview, {
      props: {
        value: "@{c0f09840}",
        uuidToName: new Map([["c0f09840", "test2"]]),
      },
    });
    expect(w.find(".wp-refchip__label").text()).toBe("@test2");
    expect(w.find(".wp-refchip__suffix").exists()).toBe(false);
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
