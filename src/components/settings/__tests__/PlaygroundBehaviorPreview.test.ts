import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import PlaygroundBehaviorPreview from "../PlaygroundBehaviorPreview.vue";
import { dismissToast, toasts } from "@/components/shared/toast-store";

const base = {
  validation: "strict" as const,
  maxSuggestions: "20",
  minChars: "3",
  separator: false,
  spaces: false,
  escape: false,
};

async function typeInto(wrapper: ReturnType<typeof mount>, text: string): Promise<void> {
  const input = wrapper.get("[data-test=pg-ac-input]");
  (input.element as HTMLInputElement).value = text;
  (input.element as HTMLInputElement).setSelectionRange(text.length, text.length);
  await input.trigger("input");
}

describe("PlaygroundBehaviorPreview", () => {
  afterEach(() => {
    for (const t of [...toasts.value]) dismissToast(t.id);
  });

  it("pushes one toast of each severity", async () => {
    const wrapper = mount(PlaygroundBehaviorPreview, { props: base });
    await wrapper.get("[data-test=pg-sample-toasts]").trigger("click");
    expect(toasts.value.map((t) => t.severity)).toEqual(["info", "warning", "error"]);
  });

  it("waits for the minimum characters and caps the list", async () => {
    const wrapper = mount(PlaygroundBehaviorPreview, { props: { ...base, minChars: "4", maxSuggestions: "5" } });
    await typeInto(wrapper, "bl");
    expect(wrapper.find("[data-test=pg-ac-list]").exists()).toBe(false);
    await typeInto(wrapper, "_hai");
    expect(wrapper.findAll("[role=option]").length).toBeLessThanOrEqual(5);
    expect(wrapper.findAll("[role=option]").length).toBeGreaterThan(0);
  });

  it("writes a pick in the chosen style with the separator", async () => {
    const wrapper = mount(PlaygroundBehaviorPreview, {
      props: { ...base, spaces: true, escape: true, separator: true },
    });
    await typeInto(wrapper, "fate");
    await wrapper.get("[role=option]").trigger("mousedown");
    expect((wrapper.get("[data-test=pg-ac-input]").element as HTMLInputElement).value)
      .toBe("fate \\(series\\), ");
  });

  it("filters the sample conflicts by strictness", async () => {
    const wrapper = mount(PlaygroundBehaviorPreview, { props: base });
    expect(wrapper.findAll(".wp-pg-behave__conflict")).toHaveLength(3);
    await wrapper.setProps({ validation: "relaxed" });
    expect(wrapper.findAll(".wp-pg-behave__conflict")).toHaveLength(2);
    await wrapper.setProps({ validation: "permissive" });
    expect(wrapper.find("[data-test=pg-conflicts-off]").exists()).toBe(true);
  });
});
