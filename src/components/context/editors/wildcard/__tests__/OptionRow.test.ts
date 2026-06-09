import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import OptionRow from "../sections/OptionRow.vue";
import { _resetForTests, _setForTests } from "@/extension/preview-resolver";

const baseOption = { id: "o1", value: "red", weight: 1, sub_categories: ["warm"] };
const allOptions = [
  baseOption,
  { id: "o2", value: "blue", weight: 1, sub_categories: ["cool"] },
];

describe("OptionRow", () => {
  beforeEach(() => _resetForTests());

  it("renders option name + a category chip per sub-category", () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: {} },
    });
    expect(w.find('[data-test="opt-name"]').text()).toBe("red");
    const chip = w.find('[data-test="opt-cat-warm"]');
    expect(chip.exists()).toBe(true);
    expect(chip.text().toLowerCase()).toBe("warm");
  });

  it("renders multiple category chips for a multi-tag option", () => {
    const opt = { id: "m", value: "lynx", weight: 1, sub_categories: ["feline", "warm"] };
    const w = mount(OptionRow, { props: { option: opt, allOptions: [opt], instance: {} } });
    expect(w.find('[data-test="opt-cat-feline"]').exists()).toBe(true);
    expect(w.find('[data-test="opt-cat-warm"]').exists()).toBe(true);
  });

  it("decomposes a {N$$…} block into scaffolding + an inner ref chip (SP2b #6)", () => {
    _setForTests("ad00acd5", { name: "mood", varBinding: "mood" });
    const opt = { id: "b1", value: "{2$$, $$@{ad00acd5}|warm}", weight: 1, sub_categories: [] };
    const w = mount(OptionRow, { props: { option: opt, allOptions: [opt], instance: {} } });
    // The inner @{uuid} arm renders as a resolved ref chip, not raw uuid text.
    const ref = w.find(".opt__tok--ref");
    expect(ref.exists()).toBe(true);
    expect(ref.text()).toContain("@mood");
    expect(w.find(".opt__tok--multi").exists()).toBe(true); // scaffolding coloured
    expect(w.find('[data-test="opt-name"]').text()).not.toContain("ad00acd5");
  });

  it("shows the null-excluded ban mark on an inner ref carrying !null (SP2b #1)", () => {
    _setForTests("ad00acd5", { name: "mood", varBinding: "mood" });
    const opt = { id: "b3", value: "{3$$, $$@{ad00acd5#mood!null}}", weight: 1, sub_categories: [] };
    const w = mount(OptionRow, { props: { option: opt, allOptions: [opt], instance: {} } });
    const ref = w.find(".opt__tok--ref");
    expect(ref.exists()).toBe(true);
    // The leaked `!null` is detected → ban (null-excluded) indicator shows.
    expect(ref.find(".opt__tok-filter").exists()).toBe(true);
    expect(ref.find(".opt__tok-nonull").exists()).toBe(true);
    // Label is the clean name, not `@mood!null`.
    expect(ref.text()).toContain("@mood");
    expect(ref.text()).not.toContain("!null");
  });

  it("decomposes a plain {a|@{uuid}} alternation into an inner ref chip (SP2b #6)", () => {
    _setForTests("ad00acd5", { name: "hair", varBinding: "hair" });
    const opt = { id: "b2", value: "{warm|@{ad00acd5}}", weight: 1, sub_categories: [] };
    const w = mount(OptionRow, { props: { option: opt, allOptions: [opt], instance: {} } });
    expect(w.find(".opt__tok--ref").exists()).toBe(true);
    expect(w.find(".opt__tok--brace").exists()).toBe(true);
    expect(w.find('[data-test="opt-name"]').text()).not.toContain("ad00acd5");
  });

  it("checkbox is checked when enabled_options is null (library default)", () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: {} },
    });
    expect(w.find('[data-test="opt-check"]').classes()).toContain("opt__check--on");
  });

  it("checkbox is unchecked when option id is NOT in enabled_options", () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: { enabled_options: ["o2"] } },
    });
    expect(w.find('[data-test="opt-check"]').classes()).not.toContain("opt__check--on");
  });

  it("emits toggle event with option id when checkbox clicked", async () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: {} },
    });
    await w.find('[data-test="opt-check"]').trigger("click");
    expect(w.emitted("toggle")?.[0]).toEqual(["o1"]);
  });

  it("shows weight input with library default when no override", () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: {} },
    });
    const input = w.find<HTMLInputElement>('[data-test="opt-weight"]').element;
    expect(input.value).toBe("1");
  });

  it("shows weight input with override when present", () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: { option_weights: { o1: 1.8 } } },
    });
    const input = w.find<HTMLInputElement>('[data-test="opt-weight"]').element;
    expect(input.value).toBe("1.8");
  });

  it("emits weight event when weight input changes", async () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: {} },
    });
    const input = w.find<HTMLInputElement>('[data-test="opt-weight"]');
    input.element.value = "2.5";
    await input.trigger("input");
    expect(w.emitted("weight")?.[0]).toEqual(["o1", 2.5]);
  });

  it("emits weight with null when input is cleared to empty", async () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: { option_weights: { o1: 1.8 } } },
    });
    const input = w.find<HTMLInputElement>('[data-test="opt-weight"]');
    input.element.value = "";
    await input.trigger("input");
    expect(w.emitted("weight")?.[0]).toEqual(["o1", null]);
  });

  it("renders probability percentage label", () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: {} },
    });
    // 1 of 2 enabled, equal weights → 50%
    expect(w.find('[data-test="opt-prob-pct"]').text()).toBe("50%");
  });

  it("disabled row shows 0% probability + line-through styling", () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: { enabled_options: ["o2"] } },
    });
    expect(w.find('[data-test="opt-prob-pct"]').text()).toBe("0%");
    expect(w.classes()).toContain("opt--off");
  });

  it("weighted row gets weighted modifier class", () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: { option_weights: { o1: 1.8 } } },
    });
    expect(w.classes()).toContain("opt--weighted");
  });

  it("category-filtered row gets opt--filtered modifier class", () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: { category_filter: "cool" } },
    });
    // baseOption.sub_categories = ["warm"], filter only allows "cool"
    expect(w.classes()).toContain("opt--filtered");
  });

  it("category-filtered row does NOT emit toggle on checkbox click", async () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: { category_filter: "cool" } },
    });
    await w.find('[data-test="opt-check"]').trigger("click");
    expect(w.emitted("toggle")).toBeUndefined();
  });

  it("category-filtered row exposes aria-disabled=true on checkbox", () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: { category_filter: "cool" } },
    });
    expect(w.find('[data-test="opt-check"]').attributes("aria-disabled")).toBe("true");
  });

  it("up spinner button bumps weight by +0.1", async () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: {} },
    });
    await w.find('[data-test="opt-weight-up"]').trigger("click");
    // Library weight = 1.0, +0.1 = 1.1
    expect(w.emitted("weight")?.[0]).toEqual(["o1", 1.1]);
  });

  it("down spinner button bumps weight by -0.1", async () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: { option_weights: { o1: 1.5 } } },
    });
    await w.find('[data-test="opt-weight-down"]').trigger("click");
    expect(w.emitted("weight")?.[0]).toEqual(["o1", 1.4]);
  });

  it("down spinner clamps weight to floor 0.01 (no zero/negative weights)", async () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: { option_weights: { o1: 0 } } },
    });
    await w.find('[data-test="opt-weight-down"]').trigger("click");
    expect(w.emitted("weight")?.[0]).toEqual(["o1", 0.01]);
  });

  it("spinner buttons disabled when option is unchecked", () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: { enabled_options: ["o2"] } },
    });
    const up = w.find<HTMLButtonElement>('[data-test="opt-weight-up"]').element;
    const down = w.find<HTMLButtonElement>('[data-test="opt-weight-down"]').element;
    expect(up.disabled).toBe(true);
    expect(down.disabled).toBe(true);
  });

  it("renders @{uuid} ref token with raw uuid form when name not yet cached", () => {
    const opt = { id: "o9", value: "city @{a361dbdc} dusk", weight: 1, sub_categories: ["warm"] };
    const w = mount(OptionRow, { props: { option: opt, allOptions: [opt], instance: {} } });
    const ref = w.find('[data-test="opt-name"] .opt__tok--ref');
    expect(ref.exists()).toBe(true);
    expect(ref.attributes("data-uuid")).toBe("a361dbdc");
    expect(ref.find(".opt__tok-label").text()).toBe("@{a361dbdc}");
  });

  it("renders @{uuid} ref as @<varBinding> once resolver caches the entry", () => {
    _setForTests("a361dbdc", { name: "subject", varBinding: "subject_name" });
    const opt = { id: "o9", value: "city @{a361dbdc} dusk", weight: 1, sub_categories: ["warm"] };
    const w = mount(OptionRow, { props: { option: opt, allOptions: [opt], instance: {} } });
    const ref = w.find('[data-test="opt-name"] .opt__tok--ref');
    expect(ref.find(".opt__tok-label").text()).toBe("@subject_name");
  });

  it("renders a v2 boolean ref filter as funnel + ban, not inline !null text", () => {
    _setForTests("a361dbdc", { name: "mood", varBinding: "mood" });
    const opt = {
      id: "o9",
      value: "wolf @{a361dbdc:warm or intense!null}",
      weight: 1,
      sub_categories: ["canine"],
    };
    const w = mount(OptionRow, { props: { option: opt, allOptions: [opt], instance: {} } });
    const ref = w.find('[data-test="opt-name"] .opt__tok--ref');
    expect(ref.exists()).toBe(true);
    // The raw expression + `!null` marker must NOT appear inline anymore.
    expect(ref.text()).not.toContain("!null");
    expect(ref.text()).not.toContain("warm or intense");
    // Compact indicators instead — funnel (expression) + ban (exclude-null),
    // matching the SPA RefChip grammar.
    expect(ref.find(".opt__tok-funnel").exists()).toBe(true);
    expect(ref.find(".opt__tok-nonull").exists()).toBe(true);
    // Full normalized expression lives in the hover title, `!null` peeled.
    expect(ref.attributes("title")).toContain("warm or intense");
    expect(ref.attributes("title")).not.toContain("!null");
  });

  it("renders {a|b|c} brace block as a brace token (warn colour)", () => {
    const opt = { id: "o9", value: "color {a|b|c}", weight: 1, sub_categories: ["warm"] };
    const w = mount(OptionRow, { props: { option: opt, allOptions: [opt], instance: {} } });
    expect(w.find('[data-test="opt-name"] .opt__tok--brace').exists()).toBe(true);
  });

  it("renders {N$$,$$a|b|c} multi-pick block as a multi token (distinct from brace)", () => {
    const opt = { id: "o10", value: "{2$$,$$silver|gold|pearl}", weight: 1, sub_categories: ["warm"] };
    const w = mount(OptionRow, { props: { option: opt, allOptions: [opt], instance: {} } });
    expect(w.find('[data-test="opt-name"] .opt__tok--multi').exists()).toBe(true);
    expect(w.find('[data-test="opt-name"] .opt__tok--brace').exists()).toBe(false);
  });

  it("renders $varname as a var token", () => {
    const opt = { id: "o9", value: "uses $style here", weight: 1, sub_categories: ["warm"] };
    const w = mount(OptionRow, { props: { option: opt, allOptions: [opt], instance: {} } });
    expect(w.find('[data-test="opt-name"] .opt__tok--var .opt__tok-label').text()).toBe("$style");
  });

  it("typing weight back to library default clears the override (null)", async () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: { option_weights: { o1: 1.8 } } },
    });
    const input = w.find<HTMLInputElement>('[data-test="opt-weight"]');
    input.element.value = "1";
    await input.trigger("input");
    expect(w.emitted("weight")?.[0]).toEqual(["o1", null]);
  });

  it("up-spinner from library default emits +0.1 (modified)", async () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: {} },
    });
    await w.find('[data-test="opt-weight-up"]').trigger("click");
    expect(w.emitted("weight")?.[0]).toEqual(["o1", 1.1]);
  });

  it("down-spinner returning to library default clears override", async () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: { option_weights: { o1: 1.1 } } },
    });
    await w.find('[data-test="opt-weight-down"]').trigger("click");
    expect(w.emitted("weight")?.[0]).toEqual(["o1", null]);
  });

  it("colors a category chip by its tag_groups axis when provided", () => {
    const opt = { id: "m", value: "lynx", weight: 1, sub_categories: ["feline", "warm"] };
    const w = mount(OptionRow, {
      props: {
        option: opt,
        allOptions: [opt],
        instance: {},
        tagGroups: { family: ["feline"], temp: ["warm"] },
      },
    });
    // Two distinct axes → the two chips carry different axis style hooks.
    const feline = w.find('[data-test="opt-cat-feline"]');
    const warm = w.find('[data-test="opt-cat-warm"]');
    expect(feline.attributes("style")).not.toBe(warm.attributes("style"));
  });

  describe("null option row", () => {
    const nullOpt = { id: "n1", value: "", weight: 1, is_null: true, sub_categories: [] };

    it("renders the pi-ban chip in place of tokens", () => {
      const w = mount(OptionRow, {
        props: { option: nullOpt, allOptions: [nullOpt], instance: {} },
      });
      expect(w.find(".opt__null-chip").exists()).toBe(true);
      expect(w.find(".opt__null-chip .pi-ban").exists()).toBe(true);
      expect(w.find(".opt__null-chip").text()).toMatch(/null/i);
    });

    it("category cell renders no sub-category chips", () => {
      const w = mount(OptionRow, {
        props: { option: nullOpt, allOptions: [nullOpt], instance: {} },
      });
      expect(w.findAll('[data-test^="opt-cat-"]')).toHaveLength(0);
    });

    it("weight + check still render", () => {
      const w = mount(OptionRow, {
        props: { option: nullOpt, allOptions: [nullOpt], instance: {} },
      });
      expect(w.find('[data-test="opt-weight"]').exists()).toBe(true);
      expect(w.find('[data-test="opt-check"]').exists()).toBe(true);
    });

    it("null row is disabled (opt--off) when exclude_null is set", () => {
      const w = mount(OptionRow, {
        props: { option: nullOpt, allOptions: [nullOpt], instance: { exclude_null: true } },
      });
      expect(w.classes()).toContain("opt--off");
    });

    it("null row is disabled + non-toggleable when multiActive (SP2a)", () => {
      const w = mount(OptionRow, {
        props: { option: nullOpt, allOptions: [nullOpt], instance: {}, multiActive: true },
      });
      expect(w.classes()).toContain("opt--off");
      expect(w.find('[data-test="opt-check"]').attributes("aria-disabled")).toBe("true");
      // The checkbox must not READ as checked — the bug was the glyph + tick
      // bound to `enabled` alone, leaving a filled blue box on the disabled
      // null row in multi-pick.
      expect(w.find('[data-test="opt-check"]').classes()).not.toContain("opt__check--on");
      expect(w.find(".opt__check-tick").exists()).toBe(false);
    });

    it("null row stays interactive when not multiActive", () => {
      const w = mount(OptionRow, {
        props: { option: nullOpt, allOptions: [nullOpt], instance: {} },
      });
      expect(w.find('[data-test="opt-check"]').attributes("aria-disabled")).toBe("false");
    });
  });

  it("real option row is unaffected by multiActive", () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: {}, multiActive: true },
    });
    expect(w.find('[data-test="opt-check"]').attributes("aria-disabled")).toBe("false");
    // Not over-gated: a real (enabled, non-null) option keeps its checked
    // glyph even while a sibling null row is locked out of the multi pool.
    expect(w.find('[data-test="opt-check"]').classes()).toContain("opt__check--on");
  });
});
