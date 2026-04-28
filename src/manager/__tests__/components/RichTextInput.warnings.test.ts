import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import RichTextInput from "../../components/RichTextInput.vue";
import RichTextPreview from "../../components/RichTextPreview.vue";
import type { ResolveWarning } from "../../utils/resolveTokens";

const tick = flushPromises;

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

function popoverExists(): boolean {
  return document.querySelector(".wp-rt-suggestions") !== null;
}

describe("RichTextInput — surface prop", () => {
  it("defaults surface to wildcard — @ autocomplete enabled", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "",
        refSuggestions: ["1a2b3c4d"],
      },
      attachTo: document.body,
    });
    const input = wrap.find("input");
    const el = input.element as HTMLInputElement;
    el.value = "@1";
    el.setSelectionRange(2, 2);
    await input.trigger("input");
    await tick();
    expect(popoverExists()).toBe(true);
    wrap.unmount();
  });

  it("surface=wildcard: @ autocomplete shows suggestions", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "",
        surface: "wildcard" as const,
        refSuggestions: ["aabbccdd", "11223344"],
      },
      attachTo: document.body,
    });
    const input = wrap.find("input");
    const el = input.element as HTMLInputElement;
    el.value = "@aa";
    el.setSelectionRange(3, 3);
    await input.trigger("input");
    await tick();
    expect(popoverExists()).toBe(true);
    wrap.unmount();
  });

  it("surface=combine: @ autocomplete is disabled", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "",
        surface: "combine" as const,
        refSuggestions: ["aabbccdd"],
      },
      attachTo: document.body,
    });
    const input = wrap.find("input");
    const el = input.element as HTMLInputElement;
    el.value = "@aa";
    el.setSelectionRange(3, 3);
    await input.trigger("input");
    await tick();
    expect(popoverExists()).toBe(false);
    wrap.unmount();
  });

  it("surface=derivation: @ autocomplete is disabled", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "",
        surface: "derivation" as const,
        refSuggestions: ["aabbccdd"],
      },
      attachTo: document.body,
    });
    const input = wrap.find("input");
    const el = input.element as HTMLInputElement;
    el.value = "@aa";
    el.setSelectionRange(3, 3);
    await input.trigger("input");
    await tick();
    expect(popoverExists()).toBe(false);
    wrap.unmount();
  });

  it("surface=assembler: @ autocomplete is disabled", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "",
        surface: "assembler" as const,
        refSuggestions: ["aabbccdd"],
      },
      attachTo: document.body,
    });
    const input = wrap.find("input");
    const el = input.element as HTMLInputElement;
    el.value = "@aa";
    el.setSelectionRange(3, 3);
    await input.trigger("input");
    await tick();
    expect(popoverExists()).toBe(false);
    wrap.unmount();
  });

  it("non-wildcard surface: $ autocomplete still works", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "",
        surface: "combine" as const,
        varSuggestions: ["person"],
      },
      attachTo: document.body,
    });
    const input = wrap.find("input");
    const el = input.element as HTMLInputElement;
    el.value = "$pe";
    el.setSelectionRange(3, 3);
    await input.trigger("input");
    await tick();
    expect(popoverExists()).toBe(true);
    wrap.unmount();
  });

  it("non-wildcard surface: @{uuid} tokens in mirror get wp-rt-ref--ignored class", () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "@{1a2b3c4d} text",
        surface: "combine" as const,
      },
    });
    const mirror = wrap.find(".wp-rt__mirror");
    expect(mirror.html()).toContain("wp-rt-ref--ignored");
  });

  it("wildcard surface: @{uuid} tokens in mirror do NOT get wp-rt-ref--ignored class", () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "@{1a2b3c4d} text",
        surface: "wildcard" as const,
      },
    });
    const mirror = wrap.find(".wp-rt__mirror");
    expect(mirror.html()).not.toContain("wp-rt-ref--ignored");
  });
});

// ---------------------------------------------------------------------------
// UUID → name display in mirror
// ---------------------------------------------------------------------------

describe("RichTextInput — UUID name display", () => {
  it("renders @name display form when uuidToName provides a match", () => {
    const map = new Map([["1a2b3c4d", "hat"]]);
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "wear @{1a2b3c4d}",
        uuidToName: map,
      },
    });
    const mirror = wrap.find(".wp-rt__mirror");
    expect(mirror.html()).toContain("@hat");
  });

  it("falls back to raw @{uuid} when uuid not in map", () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "wear @{1a2b3c4d}",
        uuidToName: new Map(),
      },
    });
    const mirror = wrap.find(".wp-rt__mirror");
    expect(mirror.html()).toContain("@{1a2b3c4d}");
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
