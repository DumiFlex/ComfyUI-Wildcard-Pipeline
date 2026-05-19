import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import RichTextInput from "../../components/RichTextInput.vue";
import RichTextPreview from "../../components/RichTextPreview.vue";
import type { ResolveWarning } from "../../utils/resolveTokens";

// `tick` (alias for flushPromises) and `popoverExists` were used by the
// surface-prop autocomplete tests skipped in Task 5; Task 6 will reintroduce
// equivalent helpers when it rewires autocomplete onto the host.

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
// ---------------------------------------------------------------------------

describe("RichTextInput — surface prop", () => {
  // OBSOLETE (Task 5 rewrite) — rewired in Task 6 (autocomplete on host).
  it.skip("defaults surface to wildcard — @ autocomplete enabled (rewired in Task 6)", () => {});

  // OBSOLETE (Task 5 rewrite) — rewired in Task 6 (autocomplete on host).
  it.skip("surface=wildcard: @ autocomplete shows suggestions (rewired in Task 6)", () => {});

  // OBSOLETE (Task 5 rewrite) — rewired in Task 6 (autocomplete on host).
  it.skip("surface=combine: @ autocomplete is disabled (rewired in Task 6)", () => {});

  // OBSOLETE (Task 5 rewrite) — rewired in Task 6 (autocomplete on host).
  it.skip("surface=derivation: @ autocomplete is disabled (rewired in Task 6)", () => {});

  // OBSOLETE (Task 5 rewrite) — rewired in Task 6 (autocomplete on host).
  it.skip("surface=assembler: @ autocomplete is disabled (rewired in Task 6)", () => {});

  // OBSOLETE (Task 5 rewrite) — rewired in Task 6 (autocomplete on host).
  it.skip("non-wildcard surface: $ autocomplete still works (rewired in Task 6)", () => {});

  // OBSOLETE (Task 5 rewrite) — mirror layer removed; surface-conditional
  // ref styling moves onto RefChip (likely via a new prop) in Task 13.
  it.skip("non-wildcard surface: @{uuid} tokens in mirror get wp-rt-ref--ignored class (rewired in Task 13)", () => {});

  // OBSOLETE (Task 5 rewrite) — mirror layer removed; see comment on prior test.
  it.skip("wildcard surface: @{uuid} tokens in mirror do NOT get wp-rt-ref--ignored class (rewired in Task 13)", () => {});
});

// ---------------------------------------------------------------------------
// UUID → name display in mirror
// ---------------------------------------------------------------------------

describe("RichTextInput — UUID name display", () => {
  // OBSOLETE (Task 5 rewrite) — mirror layer removed; UUID → name display is
  // now handled by RefChip via the host's atom render path. Task 13 will
  // restore an equivalent assertion against the chip label.
  it.skip("renders @name display form when uuidToName provides a match (rewired in Task 13)", () => {});

  // OBSOLETE (Task 5 rewrite) — see prior test. Unresolved fallback now
  // surfaces as the RefChip `?` icon + uuid label.
  it.skip("falls back to raw @{uuid} when uuid not in map (rewired in Task 13)", () => {});
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
