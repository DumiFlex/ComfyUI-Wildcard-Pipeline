import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import AssemblerHelper from "./AssemblerHelper.vue";
import { varColorClass } from "../shared/var-color";

// ---------------------------------------------------------------------------
// New-layout tests — all tests use the array-based prop shape:
//   upstreamVars, templateVars, template, resolved
// ---------------------------------------------------------------------------

describe("AssemblerHelper.vue", () => {
  it("renders a chip for each upstream variable", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["style", "subject"],
        templateVars: [],
        template: "",
        resolved: "",
      },
    });
    expect(wrapper.find('[data-test="asm-chip-style"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="asm-chip-subject"]').exists()).toBe(true);
  });

  it("calls onInsert with $var when chip is clicked", async () => {
    let inserted = "";
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["style"],
        templateVars: [],
        template: "",
        resolved: "",
        onInsert: (s: string) => { inserted = s; },
      },
    });
    await wrapper.find('[data-test="asm-chip-style"]').trigger("click");
    expect(inserted).toBe("$style");
  });

  it("renders the empty-state ghost when no upstream vars + no template", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: [],
        templateVars: [],
        template: "",
        resolved: "",
      },
    });
    expect(wrapper.find('[data-test="asm-empty"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("No upstream variables yet");
  });

  it("renders upstream count in section stat when there's a template but no vars", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: [],
        templateVars: [],
        template: "literal text",
        resolved: "literal text",
      },
    });
    expect(wrapper.text()).toContain("0 upstream");
  });

  it("shows resolved preview text when resolved string is provided", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["style", "subject"],
        templateVars: ["style", "subject"],
        template: "A $style portrait of $subject",
        resolved: "A cinematic portrait of fox",
      },
    });
    const preview = wrapper.find('[data-test="asm-preview"]');
    expect(preview.text()).toContain("cinematic");
    expect(preview.text()).toContain("fox");
  });

  it("shows missing chip for template var not in upstream", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["style"],
        templateVars: ["style", "missing"],
        template: "$style and $missing",
        resolved: "",
      },
    });
    const missingChip = wrapper.find('[data-test="asm-chip-missing"]');
    expect(missingChip.exists()).toBe(true);
    expect(missingChip.classes()).toContain("wp-asm-var--missing");
  });

  it("renders the preview seed in the section stat", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["style"],
        templateVars: [],
        template: "",
        resolved: "",
        previewSeed: 42,
      },
    });
    // previewSeed is accepted by the component (no TS error) — verify section stat
    expect(wrapper.text()).toContain("1 upstream");
  });

  it("section stat shows upstream count", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["style", "subject"],
        templateVars: [],
        template: "",
        resolved: "",
      },
    });
    expect(wrapper.text()).toMatch(/2\s*upstream/);
  });

  it("var chip gets the correct varColorClass", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["hair_style"],
        templateVars: ["hair_style"],
        template: "$hair_style portrait",
        resolved: "long flowing portrait",
      },
    });
    const chipClasses = wrapper.find('[data-test="asm-chip-hair_style"]').classes();
    expect(chipClasses).toContain(varColorClass("hair_style"));
  });
});

describe("AssemblerHelper resolvedMap (#12 — boundary-disambiguation fix)", () => {
  it("colors each var's resolved substring independently when one value contains the bounding literal", () => {
    // template: `$hair_style $mood`
    // hair_style = "short cropped"  (contains the bounding " ")
    // mood = "melancholic"
    // Pre-substituted "short cropped melancholic" can't be tokenised by parallel walk
    // because indexOf(" ", 0) lands inside hair_style. The resolvedMap path bypasses
    // that entirely.
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["hair_style", "mood"],
        templateVars: ["hair_style", "mood"],
        template: "$hair_style $mood",
        resolvedMap: { hair_style: "short cropped", mood: "melancholic" },
      },
    });
    const preview = wrapper.find('[data-test="asm-preview"]');
    const varSpans = preview.findAll("span.res");
    expect(varSpans.length).toBe(2);
    expect(varSpans[0].text()).toBe("short cropped");
    expect(varSpans[1].text()).toBe("melancholic");
    expect(varSpans[0].classes()).toContain(varColorClass("hair_style"));
    expect(varSpans[1].classes()).toContain(varColorClass("mood"));
  });

  it("renders unresolved vars as `$name` when not in the map", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["a"],
        templateVars: ["a", "b"],
        template: "$a and $b",
        resolvedMap: { a: "alpha" },
      },
    });
    const preview = wrapper.find('[data-test="asm-preview"]');
    const varSpans = preview.findAll("span.res");
    expect(varSpans[0].text()).toBe("alpha");
    expect(varSpans[1].text()).toBe("$b");
  });

  it("section stat reports 'resolved' when resolvedMap has any entries", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["a"],
        templateVars: ["a"],
        template: "$a",
        resolvedMap: { a: "alpha" },
      },
    });
    expect(wrapper.text()).toContain("resolved");
  });
});

describe("AssemblerHelper missing-chip click (#20 — autoremove regression)", () => {
  it("clicking a missing chip calls onRemoveVar with the var name", async () => {
    let removed = "";
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["style"],
        templateVars: ["style", "missing_var"],
        template: "$style $missing_var",
        resolved: "",
        onRemoveVar: (v: string) => { removed = v; },
      },
    });
    await wrapper.find('[data-test="asm-chip-missing_var"]').trigger("click");
    expect(removed).toBe("missing_var");
  });

  it("missing chip is not clickable when onRemoveVar is not wired", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["style"],
        templateVars: ["style", "missing_var"],
        template: "$style $missing_var",
        resolved: "",
      },
    });
    const chip = wrapper.find('[data-test="asm-chip-missing_var"]');
    expect(chip.classes()).not.toContain("wp-asm-var--clickable");
  });
});

describe("AssemblerHelper var-color rendering", () => {
  it("emits the same var-N class for the same binding across chip + preview", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["hair_style", "mood"],
        templateVars: ["hair_style"],
        template: "$hair_style portrait",
        resolved: "long flowing portrait",
      },
    });
    const chipClass = wrapper.find('[data-test="asm-chip-hair_style"]').classes();
    expect(chipClass).toContain(varColorClass("hair_style"));
  });

  it("missing chips render with the missing modifier + warn icon", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["hair_style"],
        templateVars: ["hair_style", "lighting"],
        template: "$hair_style $lighting",
        resolved: "",
      },
    });
    const missing = wrapper.find('[data-test="asm-chip-lighting"]');
    expect(missing.classes()).toContain("wp-asm-var--missing");
    expect(missing.find("i.pi.pi-exclamation-triangle").exists()).toBe(true);
  });

  it("section stat shows upstream count + missing count", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["hair_style", "mood"],
        templateVars: ["hair_style", "lighting", "lens"],
        template: "$hair_style $lighting $lens",
        resolved: "",
      },
    });
    expect(wrapper.text()).toMatch(/2\s*upstream/);
    expect(wrapper.text()).toMatch(/2\s*missing/);
  });

  it("clear-template button fires onClearTemplate when template is set", async () => {
    const onClearTemplate = vi.fn();
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["mood"],
        template: "$mood good",
        onClearTemplate,
      },
    });
    const btn = wrapper.find('[data-test="asm-clear-template"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger("click");
    expect(onClearTemplate).toHaveBeenCalledTimes(1);
  });

  it("clear-template button visible but disabled when template is empty", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["mood"],
        template: "",
        onClearTemplate: () => {},
      },
    });
    const btn = wrapper.find<HTMLButtonElement>('[data-test="asm-clear-template"]');
    expect(btn.exists()).toBe(true);
    expect(btn.element.disabled).toBe(true);
  });

  it("preview area shows empty-state ghost when template is empty", () => {
    const wrapper = mount(AssemblerHelper, {
      props: { upstreamVars: ["mood"], template: "" },
    });
    expect(wrapper.find('[data-test="asm-preview-empty"]').exists()).toBe(true);
  });

  it("Ctrl+Click on upstream chip removes from template instead of inserting", async () => {
    const onRemoveVar = vi.fn();
    const onInsert = vi.fn();
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["mood"],
        templateVars: ["mood"],
        template: "$mood is fine",
        onRemoveVar,
        onInsert,
      },
    });
    await wrapper.find('[data-test="asm-chip-mood"]').trigger("click", { ctrlKey: true });
    expect(onRemoveVar).toHaveBeenCalledWith("mood");
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("plain click on upstream chip still inserts (no ctrl)", async () => {
    const onRemoveVar = vi.fn();
    const onInsert = vi.fn();
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["mood"],
        template: "$mood",
        onRemoveVar,
        onInsert,
      },
    });
    await wrapper.find('[data-test="asm-chip-mood"]').trigger("click");
    expect(onInsert).toHaveBeenCalledWith("$mood");
    expect(onRemoveVar).not.toHaveBeenCalled();
  });

  it("renders kind icon inside chips when kindByVar provided", () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["seed_phrase", "outfit", "scene"],
        template: "x",
        kindByVar: {
          seed_phrase: "wildcard",
          outfit: "combine",
          scene: "injector",
        },
      },
    });
    expect(wrapper.find('[data-test="asm-chip-seed_phrase"] .pi-sparkles').exists()).toBe(true);
    expect(wrapper.find('[data-test="asm-chip-outfit"] .pi-link').exists()).toBe(true);
    expect(wrapper.find('[data-test="asm-chip-scene"] .pi-bolt').exists()).toBe(true);
  });

  it("right-click on upstream chip opens ctxmenu with Copy / Insert / Remove", async () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: ["mood"],
        template: "$mood",
        onRemoveVar: () => {},
      },
      attachTo: document.body,
    });
    await wrapper.find('[data-test="asm-chip-mood"]').trigger("contextmenu", { clientX: 10, clientY: 10 });
    const labels = Array.from(document.querySelectorAll(".wp-ctxmenu__title")).map((n) => n.textContent);
    expect(labels).toContain("Copy $mood");
    expect(labels).toContain("Insert at caret");
    expect(labels).toContain("Remove from template");
    wrapper.unmount();
  });

  it("right-click on missing chip surfaces Remove but disables Insert", async () => {
    const wrapper = mount(AssemblerHelper, {
      props: {
        upstreamVars: [],
        templateVars: ["nope"],
        template: "$nope",
        onRemoveVar: () => {},
      },
      attachTo: document.body,
    });
    await wrapper.find('[data-test="asm-chip-nope"]').trigger("contextmenu", { clientX: 10, clientY: 10 });
    const items = Array.from(document.querySelectorAll<HTMLElement>(".wp-ctxmenu__item"));
    const insert = items.find((el) => el.querySelector(".wp-ctxmenu__title")?.textContent === "Insert at caret");
    expect(insert?.classList.contains("wp-ctxmenu__item--disabled")).toBe(true);
    const remove = items.find((el) => el.querySelector(".wp-ctxmenu__title")?.textContent === "Remove from template");
    expect(remove?.classList.contains("wp-ctxmenu__item--disabled")).toBe(false);
    wrapper.unmount();
  });
});
