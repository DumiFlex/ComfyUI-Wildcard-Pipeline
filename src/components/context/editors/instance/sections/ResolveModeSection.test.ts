import { describe, it, expect } from "vitest";
import { renderSection, getEmittedUpdate, emittedReset } from "../test-utils";
import ResolveModeSection from "./ResolveModeSection.vue";

type ResolveLibrary = { mode: "random"; options: { id: string }[] };
type ResolveOverride = { mode: "random" | "subcategory" | "pinned" | null; pinned_option_id: string | null };

const lib: ResolveLibrary = {
  mode: "random",
  options: [{ id: "o1" }, { id: "o2" }, { id: "o3" }],
};

describe("ResolveModeSection", () => {
  it("renders with random selected when modelValue is null", () => {
    const wrapper = renderSection(ResolveModeSection, {
      library: lib, modelValue: null,
    });
    const random = wrapper.find('input[data-test="rm-random"]');
    expect((random.element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.find('[data-test="rm-reset"]').exists()).toBe(false);
  });

  it("renders with override mode selected when modelValue is non-null", () => {
    const wrapper = renderSection(ResolveModeSection, {
      library: lib, modelValue: { mode: "pinned", pinned_option_id: "o2" },
    });
    const pinned = wrapper.find('input[data-test="rm-pinned"]');
    expect((pinned.element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.find('[data-test="rm-reset"]').exists()).toBe(true);
  });

  it("emits update with mode change to subcategory clears pinned id", async () => {
    const wrapper = renderSection(ResolveModeSection, {
      library: lib, modelValue: { mode: "pinned", pinned_option_id: "o2" },
    });
    const sub = wrapper.find('input[data-test="rm-subcategory"]');
    (sub.element as HTMLInputElement).checked = true;
    await sub.trigger("change");
    const next = getEmittedUpdate<ResolveOverride>(wrapper);
    expect(next?.mode).toBe("subcategory");
    expect(next?.pinned_option_id).toBeNull();
  });

  it("emits update with pinned mode + first option when switching to pinned", async () => {
    const wrapper = renderSection(ResolveModeSection, {
      library: lib, modelValue: null,
    });
    const pinned = wrapper.find('input[data-test="rm-pinned"]');
    (pinned.element as HTMLInputElement).checked = true;
    await pinned.trigger("change");
    const next = getEmittedUpdate<ResolveOverride>(wrapper);
    expect(next?.mode).toBe("pinned");
    expect(next?.pinned_option_id).toBe("o1");
  });

  it("changes pinned id via select while staying in pinned mode", async () => {
    const wrapper = renderSection(ResolveModeSection, {
      library: lib, modelValue: { mode: "pinned", pinned_option_id: "o1" },
    });
    const sel = wrapper.find('select[data-test="rm-pinned-select"]');
    (sel.element as HTMLSelectElement).value = "o3";
    await sel.trigger("change");
    const next = getEmittedUpdate<ResolveOverride>(wrapper);
    expect(next?.mode).toBe("pinned");
    expect(next?.pinned_option_id).toBe("o3");
  });

  it("emits reset event on reset-button click", async () => {
    const wrapper = renderSection(ResolveModeSection, {
      library: lib, modelValue: { mode: "pinned", pinned_option_id: "o1" },
    });
    await wrapper.find('[data-test="rm-reset"]').trigger("click");
    expect(emittedReset(wrapper)).toBe(true);
  });
});
