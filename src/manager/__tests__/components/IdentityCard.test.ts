import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import IdentityCard from "../../components/IdentityCard.vue";

beforeEach(() => setActivePinia(createPinia()));

describe("IdentityCard.vue · aside slot", () => {
  it("renders the aside slot when provided", () => {
    const wrap = mount(IdentityCard, {
      props: {
        name: "Foo",
        description: "",
        categoryId: null,
        tags: [],
      },
      slots: {
        aside: '<div data-test="aside-marker">ASIDE_CONTENT</div>',
      },
    });
    expect(wrap.find('[data-test="aside-marker"]').exists()).toBe(true);
    expect(wrap.text()).toContain("ASIDE_CONTENT");
  });

  it("renders without aside slot when none provided", () => {
    const wrap = mount(IdentityCard, {
      props: {
        name: "Foo",
        description: "",
        categoryId: null,
        tags: [],
      },
    });
    expect(wrap.find('[data-test="aside-marker"]').exists()).toBe(false);
    // Sanity: identity inputs still render.
    expect(wrap.find('[data-test="identity-name"]').exists()).toBe(true);
  });
});
