import { describe, it, expect } from "vitest";
import { renderSection, getEmittedUpdate, emittedReset } from "../test-utils";
import ValuesOverrideSection from "./ValuesOverrideSection.vue";

interface Row { id: string; name: string; value: string }
const lib: Row[] = [
  { id: "v1", name: "title", value: "Hello" },
  { id: "v2", name: "subtitle", value: "World" },
];

describe("ValuesOverrideSection", () => {
  it("renders library rows read-only with override button when modelValue is null", () => {
    const wrapper = renderSection(ValuesOverrideSection, {
      library: lib, modelValue: null,
    });
    expect(wrapper.find('[data-test="vo-override-btn"]').exists()).toBe(true);
    const rows = wrapper.findAll('[data-test^="vo-row-"]');
    expect(rows).toHaveLength(2);
    expect(wrapper.findAll('input[data-test^="vo-name-"]')).toHaveLength(0);
    expect(wrapper.find('[data-test="vo-reset"]').exists()).toBe(false);
  });

  it("renders editable rows when modelValue is non-null", () => {
    const wrapper = renderSection(ValuesOverrideSection, {
      library: lib, modelValue: lib,
    });
    expect(wrapper.findAll('input[data-test^="vo-name-"]')).toHaveLength(2);
    expect(wrapper.findAll('input[data-test^="vo-value-"]')).toHaveLength(2);
    expect(wrapper.find('[data-test="vo-reset"]').exists()).toBe(true);
  });

  it("clicking override button copies library to a working override", async () => {
    const wrapper = renderSection(ValuesOverrideSection, {
      library: lib, modelValue: null,
    });
    await wrapper.find('[data-test="vo-override-btn"]').trigger("click");
    const next = getEmittedUpdate<Row[] | null>(wrapper);
    expect(next).toEqual(lib);
  });

  it("editing a name input emits update:modelValue", async () => {
    const wrapper = renderSection(ValuesOverrideSection, {
      library: lib, modelValue: lib,
    });
    const inp = wrapper.find('input[data-test="vo-name-v1"]');
    (inp.element as HTMLInputElement).value = "renamed";
    await inp.trigger("input");
    const next = getEmittedUpdate<Row[] | null>(wrapper);
    expect(next?.[0].name).toBe("renamed");
    expect(next?.[1]).toEqual(lib[1]);
  });

  it("editing a value input emits update:modelValue", async () => {
    const wrapper = renderSection(ValuesOverrideSection, {
      library: lib, modelValue: lib,
    });
    const inp = wrapper.find('input[data-test="vo-value-v2"]');
    (inp.element as HTMLInputElement).value = "Universe";
    await inp.trigger("input");
    const next = getEmittedUpdate<Row[] | null>(wrapper);
    expect(next?.[1].value).toBe("Universe");
  });

  it("delete row button removes that row", async () => {
    const wrapper = renderSection(ValuesOverrideSection, {
      library: lib, modelValue: lib,
    });
    await wrapper.find('[data-test="vo-delete-v1"]').trigger("click");
    const next = getEmittedUpdate<Row[] | null>(wrapper);
    expect(next).toHaveLength(1);
    expect(next?.[0].id).toBe("v2");
  });

  it("add row button appends a fresh row", async () => {
    const wrapper = renderSection(ValuesOverrideSection, {
      library: lib, modelValue: lib,
    });
    await wrapper.find('[data-test="vo-add"]').trigger("click");
    const next = getEmittedUpdate<Row[] | null>(wrapper);
    expect(next).toHaveLength(3);
    expect(next?.[2].name).toBe("");
    expect(next?.[2].value).toBe("");
    expect(typeof next?.[2].id).toBe("string");
  });

  it("emits reset event on reset-button click", async () => {
    const wrapper = renderSection(ValuesOverrideSection, {
      library: lib, modelValue: lib,
    });
    await wrapper.find('[data-test="vo-reset"]').trigger("click");
    expect(emittedReset(wrapper)).toBe(true);
  });
});
