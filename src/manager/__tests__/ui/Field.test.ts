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

  it("exposes ariaInvalid=true via slot prop when error is set", () => {
    // Consumers destructure `{ ariaInvalid }` and pass it as :aria-invalid on their input.
    let slotAriaInvalid: boolean | undefined;
    mount(Field, {
      props: { error: "Oops" },
      slots: {
        default: ({ ariaInvalid }: { ariaInvalid: boolean }) => {
          slotAriaInvalid = ariaInvalid;
          return [];
        },
      },
    });
    expect(slotAriaInvalid).toBe(true);
  });

  it("exposes ariaInvalid=false via slot prop when no error", () => {
    let slotAriaInvalid: boolean | undefined;
    mount(Field, {
      props: {},
      slots: {
        default: ({ ariaInvalid }: { ariaInvalid: boolean }) => {
          slotAriaInvalid = ariaInvalid;
          return [];
        },
      },
    });
    expect(slotAriaInvalid).toBe(false);
  });
});
