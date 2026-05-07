import { describe, it, expect } from "vitest";
import { renderSection, getEmittedUpdate, emittedReset } from "../test-utils";
import DisabledExceptionsSection from "./DisabledExceptionsSection.vue";
import { encodeKey } from "../keys";

interface Exception {
  source_value: string;
  target_value: string;
  mode: string;
  factor: number;
}
const lib: Exception[] = [
  { source_value: "a", target_value: "b", mode: "boost", factor: 2 },
  { source_value: "c", target_value: "d", mode: "ban", factor: 0 },
  { source_value: "e", target_value: "f", mode: "boost", factor: 1.5 },
];

describe("DisabledExceptionsSection", () => {
  it("renders all exceptions enabled when modelValue is null", () => {
    const wrapper = renderSection(DisabledExceptionsSection, {
      library: lib, modelValue: null,
    });
    const checks = wrapper.findAll('input[data-test^="de-cb-"]');
    expect(checks).toHaveLength(3);
    checks.forEach((c) => {
      expect((c.element as HTMLInputElement).checked).toBe(false);
    });
    expect(wrapper.find('[data-test="de-reset"]').exists()).toBe(false);
  });

  it("renders disabled state when modelValue contains encoded keys", () => {
    const k0 = encodeKey(["a", "b"]);
    const wrapper = renderSection(DisabledExceptionsSection, {
      library: lib, modelValue: [k0],
    });
    const cb0 = wrapper.findAll('input[data-test^="de-cb-"]')[0];
    expect((cb0.element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.find('[data-test="de-reset"]').exists()).toBe(true);
  });

  it("checking a row when null builds fresh array with composite key", async () => {
    const wrapper = renderSection(DisabledExceptionsSection, {
      library: lib, modelValue: null,
    });
    const cb1 = wrapper.findAll('input[data-test^="de-cb-"]')[1];
    (cb1.element as HTMLInputElement).checked = true;
    await cb1.trigger("change");
    const next = getEmittedUpdate<string[] | null>(wrapper);
    expect(next).toEqual([encodeKey(["c", "d"])]);
  });

  it("checking another row appends a new key", async () => {
    const k0 = encodeKey(["a", "b"]);
    const wrapper = renderSection(DisabledExceptionsSection, {
      library: lib, modelValue: [k0],
    });
    const cb2 = wrapper.findAll('input[data-test^="de-cb-"]')[2];
    (cb2.element as HTMLInputElement).checked = true;
    await cb2.trigger("change");
    const next = getEmittedUpdate<string[] | null>(wrapper);
    expect(next).toContain(k0);
    expect(next).toContain(encodeKey(["e", "f"]));
    expect(next).toHaveLength(2);
  });

  it("unchecking removes from list; emits null when last key removed", async () => {
    const k0 = encodeKey(["a", "b"]);
    const wrapper = renderSection(DisabledExceptionsSection, {
      library: lib, modelValue: [k0],
    });
    const cb0 = wrapper.findAll('input[data-test^="de-cb-"]')[0];
    (cb0.element as HTMLInputElement).checked = false;
    await cb0.trigger("change");
    const next = getEmittedUpdate<string[] | null>(wrapper);
    expect(next).toBeNull();
  });

  it("emits reset event on reset-button click", async () => {
    const k0 = encodeKey(["a", "b"]);
    const wrapper = renderSection(DisabledExceptionsSection, {
      library: lib, modelValue: [k0],
    });
    await wrapper.find('[data-test="de-reset"]').trigger("click");
    expect(emittedReset(wrapper)).toBe(true);
  });
});
