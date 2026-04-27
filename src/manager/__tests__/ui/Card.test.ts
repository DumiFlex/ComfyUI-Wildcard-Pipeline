import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Card from "../../components/ui/Card.vue";

describe("Card.vue", () => {
  it("renders title and actions slot", () => {
    const wrap = mount(Card, {
      props: { title: "Settings" },
      slots: {
        default: "<p>Body</p>",
        actions: "<button data-test='action'>Edit</button>",
      },
    });
    expect(wrap.get(".wp-card__title").text()).toBe("Settings");
    expect(wrap.find("[data-test='action']").exists()).toBe(true);
  });

  it("omits header when no title and no actions slot", () => {
    const wrap = mount(Card, { slots: { default: "<p>Just body</p>" } });
    expect(wrap.find(".wp-card__header").exists()).toBe(false);
  });
});
