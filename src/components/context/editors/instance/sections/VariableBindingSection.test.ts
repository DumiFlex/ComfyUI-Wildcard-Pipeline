import { describe, it, expect } from "vitest";
import { renderSection, getEmittedUpdate, emittedReset } from "../test-utils";
import VariableBindingSection from "./VariableBindingSection.vue";

describe("VariableBindingSection", () => {
  it("shows library default as placeholder when modelValue is null", () => {
    const wrapper = renderSection(VariableBindingSection, {
      library: "default_var", modelValue: null,
    });
    const input = wrapper.find('input[data-test="vb-input"]');
    expect(input.attributes("placeholder")).toBe("default_var");
  });

  it("shows current override value when modelValue is non-null", () => {
    const wrapper = renderSection(VariableBindingSection, {
      library: "default_var", modelValue: "custom_name",
    });
    const input = wrapper.find('input[data-test="vb-input"]') as { element: HTMLInputElement };
    expect((input.element).value).toBe("custom_name");
  });

  it("emits update:modelValue with the new value on input", async () => {
    const wrapper = renderSection(VariableBindingSection, {
      library: "default_var", modelValue: null,
    });
    const input = wrapper.find('input[data-test="vb-input"]');
    (input.element as HTMLInputElement).value = "new_var";
    await input.trigger("input");
    expect(getEmittedUpdate<string>(wrapper)).toBe("new_var");
  });

  it("emits update:modelValue with null when input is cleared to empty", async () => {
    const wrapper = renderSection(VariableBindingSection, {
      library: "default_var", modelValue: "x",
    });
    const input = wrapper.find('input[data-test="vb-input"]');
    (input.element as HTMLInputElement).value = "";
    await input.trigger("input");
    expect(getEmittedUpdate<string | null>(wrapper)).toBeNull();
  });

  it("renders library-default chip clickable when override is set", async () => {
    const wrapper = renderSection(VariableBindingSection, {
      library: "default_var", modelValue: "custom",
    });
    const chip = wrapper.find('[data-test="vb-default-chip"]');
    expect(chip.exists()).toBe(true);
    await chip.trigger("click");
    expect(getEmittedUpdate<string | null>(wrapper)).toBeNull();
  });

  it("hides library-default chip when modelValue is null", () => {
    const wrapper = renderSection(VariableBindingSection, {
      library: "default_var", modelValue: null,
    });
    expect(wrapper.find('[data-test="vb-default-chip"]').exists()).toBe(false);
  });

  it("emits reset event on reset-button click when override is set", async () => {
    const wrapper = renderSection(VariableBindingSection, {
      library: "default_var", modelValue: "custom",
    });
    await wrapper.find('[data-test="vb-reset"]').trigger("click");
    expect(emittedReset(wrapper)).toBe(true);
  });
});
