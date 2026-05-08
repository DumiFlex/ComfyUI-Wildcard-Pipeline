import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OptionRow from "./OptionRow.vue";

const baseOption = { id: "o1", value: "red", weight: 1, sub_category: "warm" };
const allOptions = [
  baseOption,
  { id: "o2", value: "blue", weight: 1, sub_category: "cool" },
];

describe("OptionRow", () => {
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
});
