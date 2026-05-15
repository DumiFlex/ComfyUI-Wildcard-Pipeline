import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import IdentityCard from "../../components/IdentityCard.vue";

beforeEach(() => setActivePinia(createPinia()));

describe("IdentityCard.vue · nameLeading slot", () => {
  it("renders the nameLeading slot when provided", () => {
    const wrap = mount(IdentityCard, {
      props: {
        name: "Foo",
        description: "",
        categoryId: null,
        tags: [],
      },
      slots: {
        nameLeading: '<div data-test="nameLeading-marker">ASIDE_CONTENT</div>',
      },
    });
    expect(wrap.find('[data-test="nameLeading-marker"]').exists()).toBe(true);
    expect(wrap.text()).toContain("ASIDE_CONTENT");
  });

  it("renders without nameLeading slot when none provided", () => {
    const wrap = mount(IdentityCard, {
      props: {
        name: "Foo",
        description: "",
        categoryId: null,
        tags: [],
      },
    });
    expect(wrap.find('[data-test="nameLeading-marker"]').exists()).toBe(false);
    // Sanity: identity inputs still render.
    expect(wrap.find('[data-test="identity-name"]').exists()).toBe(true);
  });
});
