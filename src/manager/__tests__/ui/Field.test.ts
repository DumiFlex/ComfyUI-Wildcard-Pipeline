import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Field from "../../components/ui/Field.vue";

describe("Field.vue", () => {
  it("renders label and forwards default slot", () => {
    const wrap = mount(Field, {
      props: { label: "Name" },
      slots: { default: "<input data-test='in' />" },
    });
    expect(wrap.get("label").text()).toContain("Name");
    expect(wrap.find("[data-test='in']").exists()).toBe(true);
  });

  it("renders error message and applies error class", () => {
    const wrap = mount(Field, {
      props: { label: "Name", error: "Required" },
      slots: { default: "<input />" },
    });
    expect(wrap.get(".wp-field").classes()).toContain("wp-field--error");
    expect(wrap.get(".wp-field__error").text()).toBe("Required");
  });
});
