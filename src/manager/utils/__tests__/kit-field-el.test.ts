import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Input from "@/kit/Input.vue";
import Textarea from "@/kit/Textarea.vue";
import { inputEl, textareaEl } from "../kit-field-el";

describe("kit field elements", () => {
  it("finds the textarea of a kit Textarea and the input of a kit Input, plain or wrapped", () => {
    const t = mount(Textarea, { props: { modelValue: "a" } });
    expect(textareaEl(t.vm)?.value).toBe("a");
    const plain = mount(Input, { props: { modelValue: "b" } });
    expect(inputEl(plain.vm)?.value).toBe("b");
    const wrapped = mount(Input, { props: { modelValue: "c", prefix: "$" } });
    expect(inputEl(wrapped.vm)?.value).toBe("c");
  });

  it("takes a bare element too, and gives null for anything else", () => {
    const el = document.createElement("input");
    expect(inputEl(el)).toBe(el);
    expect(inputEl(null)).toBeNull();
    expect(textareaEl({})).toBeNull();
    expect(textareaEl(el)).toBeNull();
  });
});
