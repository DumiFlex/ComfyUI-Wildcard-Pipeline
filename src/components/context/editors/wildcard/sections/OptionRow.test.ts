import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import OptionRow from "./OptionRow.vue";
import { _resetForTests, _setForTests } from "../../../../../extension/preview-resolver";

const baseOption = { id: "o1", value: "red", weight: 1, sub_category: "warm" };
const allOptions = [
  baseOption,
  { id: "o2", value: "blue", weight: 1, sub_category: "cool" },
];

describe("OptionRow", () => {
  beforeEach(() => _resetForTests());

  it("renders option name + category label", () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: {} },
    });
    expect(w.find('[data-test="opt-name"]').text()).toBe("red");
    expect(w.find('[data-test="opt-cat"]').text().toLowerCase()).toBe("warm");
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
      props: { option: baseOption, allOptions, instance: { category_filter: ["cool"] } },
    });
    // baseOption.sub_category = "warm", filter only allows "cool"
    expect(w.classes()).toContain("opt--filtered");
  });

  it("category-filtered row does NOT emit toggle on checkbox click", async () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: { category_filter: ["cool"] } },
    });
    await w.find('[data-test="opt-check"]').trigger("click");
    expect(w.emitted("toggle")).toBeUndefined();
  });

  it("category-filtered row exposes aria-disabled=true on checkbox", () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: { category_filter: ["cool"] } },
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
    // Weight 0 / negative never picks (probability normalises away),
    // so the editor floors at 0.01. To disable an option entirely,
    // use the per-row toggle — engine respects that.
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
    const opt = { id: "o9", value: "city @{a361dbdc} dusk", weight: 1, sub_category: "warm" };
    const w = mount(OptionRow, { props: { option: opt, allOptions: [opt], instance: {} } });
    const ref = w.find('[data-test="opt-name"] .opt__tok--ref');
    expect(ref.exists()).toBe(true);
    expect(ref.attributes("data-uuid")).toBe("a361dbdc");
    // Until preview-resolver lands the lookup, raw form is the fallback.
    // Read the identity-text span so the chip icon prefix doesn't bleed in.
    expect(ref.find(".opt__tok-label").text()).toBe("@{a361dbdc}");
  });

  it("renders @{uuid} ref as @<varBinding> once resolver caches the entry", () => {
    _setForTests("a361dbdc", { name: "subject", varBinding: "subject_name" });
    const opt = { id: "o9", value: "city @{a361dbdc} dusk", weight: 1, sub_category: "warm" };
    const w = mount(OptionRow, { props: { option: opt, allOptions: [opt], instance: {} } });
    const ref = w.find('[data-test="opt-name"] .opt__tok--ref');
    expect(ref.find(".opt__tok-label").text()).toBe("@subject_name");
  });

  it("renders {a|b|c} brace block as a brace token (warn colour)", () => {
    const opt = { id: "o9", value: "color {a|b|c}", weight: 1, sub_category: "warm" };
    const w = mount(OptionRow, { props: { option: opt, allOptions: [opt], instance: {} } });
    expect(w.find('[data-test="opt-name"] .opt__tok--brace').exists()).toBe(true);
  });

  it("renders {N$$,$$a|b|c} multi-pick block as a multi token (distinct from brace)", () => {
    const opt = { id: "o10", value: "{2$$,$$silver|gold|pearl}", weight: 1, sub_category: "warm" };
    const w = mount(OptionRow, { props: { option: opt, allOptions: [opt], instance: {} } });
    expect(w.find('[data-test="opt-name"] .opt__tok--multi').exists()).toBe(true);
    // Brace-class should NOT match — multi gets its own visual treatment.
    expect(w.find('[data-test="opt-name"] .opt__tok--brace').exists()).toBe(false);
  });

  it("renders $varname as a var token", () => {
    const opt = { id: "o9", value: "uses $style here", weight: 1, sub_category: "warm" };
    const w = mount(OptionRow, { props: { option: opt, allOptions: [opt], instance: {} } });
    expect(w.find('[data-test="opt-name"] .opt__tok--var .opt__tok-label').text()).toBe("$style");
  });

  it("typing weight back to library default clears the override (null)", async () => {
    const w = mount(OptionRow, {
      props: { option: baseOption, allOptions, instance: { option_weights: { o1: 1.8 } } },
    });
    const input = w.find<HTMLInputElement>('[data-test="opt-weight"]');
    // baseOption.weight = 1 — matching library default should drop override
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
    // 1.1 - 0.1 = 1.0 = library default → cleared
    expect(w.emitted("weight")?.[0]).toEqual(["o1", null]);
  });

  describe("null option row", () => {
    const nullOpt = { id: "n1", value: "", weight: 1, is_null: true } as typeof baseOption & { is_null: boolean };

    it("renders the pi-ban chip in place of tokens", () => {
      const w = mount(OptionRow, {
        props: { option: nullOpt, allOptions: [nullOpt], instance: {} },
      });
      expect(w.find(".opt__null-chip").exists()).toBe(true);
      expect(w.find(".opt__null-chip .pi-ban").exists()).toBe(true);
      // Label literal "null" inside the chip.
      expect(w.find(".opt__null-chip").text()).toMatch(/null/i);
    });

    it("sub-category cell is empty", () => {
      const w = mount(OptionRow, {
        props: { option: nullOpt, allOptions: [nullOpt], instance: {} },
      });
      expect(w.find('[data-test="opt-cat"]').text()).toBe("");
    });

    it("weight + check still render", () => {
      const w = mount(OptionRow, {
        props: { option: nullOpt, allOptions: [nullOpt], instance: {} },
      });
      expect(w.find('[data-test="opt-weight"]').exists()).toBe(true);
      expect(w.find('[data-test="opt-check"]').exists()).toBe(true);
    });
  });
});
