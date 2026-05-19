import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import RichTextInput from "../../components/RichTextInput.vue";
import RichTextPreview from "../../components/RichTextPreview.vue";
import type { ResolveWarning } from "../../utils/resolveTokens";

// Helper to build a minimal ResolveWarning.
function warn(
  position: number,
  severity: "info" | "warn" | "error",
  message = "test warning",
): ResolveWarning {
  return {
    type: "test",
    severity,
    module_id: "00000000",
    source_field: "value",
    position,
    token_index: null,
    detail: {},
    message,
  };
}

// ---------------------------------------------------------------------------
// Warning marker rendering
// ---------------------------------------------------------------------------

describe("RichTextInput — warning markers", () => {
  it("renders a marker span for each warning with data-warning-position", () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "hello $name",
        warnings: [warn(6, "warn"), warn(0, "info")],
      },
    });
    const markers = wrap.findAll(".wp-rt-warn-marker");
    expect(markers).toHaveLength(2);
    const positions = markers.map((m) => m.attributes("data-warning-position"));
    expect(positions).toContain("6");
    expect(positions).toContain("0");
  });

  it("applies severity → CSS class: info → wp-rt-warn-info", () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "x",
        warnings: [warn(0, "info")],
      },
    });
    const marker = wrap.find(".wp-rt-warn-marker");
    expect(marker.classes()).toContain("wp-rt-warn-info");
    expect(marker.classes()).not.toContain("wp-rt-warn-warn");
    expect(marker.classes()).not.toContain("wp-rt-warn-error");
  });

  it("applies severity → CSS class: warn → wp-rt-warn-warn", () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "x",
        warnings: [warn(0, "warn")],
      },
    });
    const marker = wrap.find(".wp-rt-warn-marker");
    expect(marker.classes()).toContain("wp-rt-warn-warn");
  });

  it("applies severity → CSS class: error → wp-rt-warn-error", () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "x",
        warnings: [warn(0, "error")],
      },
    });
    const marker = wrap.find(".wp-rt-warn-marker");
    expect(marker.classes()).toContain("wp-rt-warn-error");
  });

  it("renders no warning markers when warnings prop is empty", () => {
    const wrap = mount(RichTextInput, {
      props: { modelValue: "x", warnings: [] },
    });
    expect(wrap.findAll(".wp-rt-warn-marker")).toHaveLength(0);
  });

  it("warning marker title matches the warning message", () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "x",
        warnings: [warn(0, "error", "ref not found")],
      },
    });
    const marker = wrap.find(".wp-rt-warn-marker");
    expect(marker.attributes("title")).toBe("ref not found");
  });
});

// ---------------------------------------------------------------------------
// Surface-conditional autocomplete
//
// The legacy autocomplete tests drove input via `setValue` on a <textarea>
// that no longer exists. The host-driven autocomplete path uses test seams
// (`__triggerAutocompleteForTest`, `__applyAutocompleteForTest`) — the
// equivalent surface-gating + insert-shape coverage lives in the main
// RichTextInput test file (e.g. "opens SubcategoryFilterPicker after picking
// an @ ref" / "$var autocomplete pick inserts $var atom directly"). The
// surface-conditional ref styling (`wp-rt-ref--ignored`) is verified against
// RichTextPreview in the bottom describe block below — RichTextInput itself
// no longer renders the mirror layer, so this concept moved.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// UUID → name display via RefChip
// ---------------------------------------------------------------------------

describe("RichTextInput — UUID name display via RefChip", () => {
  it("renders @name display form when uuidToName provides a match", () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "@{aabbccdd}",
        uuidToName: new Map([["aabbccdd", "color"]]),
      },
    });
    const chip = wrap.find(".wp-refchip--ref");
    expect(chip.exists()).toBe(true);
    expect(chip.classes()).not.toContain("wp-refchip--unresolved");
    // Resolved chip renders the human display name with the `@` prefix.
    expect(chip.text()).toContain("@color");
    // The raw uuid is NOT shown when the chip is resolved.
    expect(chip.text()).not.toContain("aabbccdd");
  });

  it("falls back to a `?<uuid>` unresolved chip when uuid is not in the name map", () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "@{deadbeef}",
        // uuidToName intentionally empty — `deadbeef` should be unresolved.
      },
    });
    const chip = wrap.find(".wp-refchip--ref");
    expect(chip.exists()).toBe(true);
    expect(chip.classes()).toContain("wp-refchip--unresolved");
    // Unresolved chip uses the `?` icon + the raw uuid as the label so the
    // user can still debug what's broken.
    expect(chip.text()).toContain("?");
    expect(chip.text()).toContain("deadbeef");
  });
});

// ---------------------------------------------------------------------------
// RichTextPreview — surface + warnings
// ---------------------------------------------------------------------------

describe("RichTextPreview — surface + warnings", () => {
  it("renders warning markers with data-warning-position", () => {
    const wrap = mount(RichTextPreview, {
      props: {
        value: "hello",
        warnings: [warn(0, "warn"), warn(3, "error")],
      },
    });
    const markers = wrap.findAll(".wp-rt-warn-marker");
    expect(markers).toHaveLength(2);
    const positions = markers.map((m) => m.attributes("data-warning-position"));
    expect(positions).toContain("0");
    expect(positions).toContain("3");
  });

  it("non-wildcard surface: ref tokens get wp-rt-ref--ignored class", () => {
    const wrap = mount(RichTextPreview, {
      props: {
        value: "@{1a2b3c4d}",
        surface: "combine" as const,
      },
    });
    expect(wrap.html()).toContain("wp-rt-ref--ignored");
  });

  it("wildcard surface: ref tokens do not get wp-rt-ref--ignored class", () => {
    const wrap = mount(RichTextPreview, {
      props: {
        value: "@{1a2b3c4d}",
        surface: "wildcard" as const,
      },
    });
    expect(wrap.html()).not.toContain("wp-rt-ref--ignored");
  });

  it("renders display name from uuidToName map", () => {
    const wrap = mount(RichTextPreview, {
      props: {
        value: "@{deadbeef}",
        uuidToName: new Map([["deadbeef", "outfit"]]),
      },
    });
    expect(wrap.html()).toContain("@outfit");
  });
});
