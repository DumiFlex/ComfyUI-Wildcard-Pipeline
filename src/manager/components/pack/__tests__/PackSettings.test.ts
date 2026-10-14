import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PackSettings from "../PackSettings.vue";
import Select from "../../ui/Select.vue";
import { DEFAULT_SETTINGS } from "../../../composables/usePackBuilder";
import type { AiPackSettings } from "../../../api/types";

function last(e: unknown[][] | undefined): AiPackSettings {
  return e![e!.length - 1]![0] as AiPackSettings;
}

describe("PackSettings", () => {
  it("holds only preferences that apply to any pack", async () => {
    const w = mount(PackSettings, { props: { modelValue: { ...DEFAULT_SETTINGS }, detailed: true } });
    const keys = w.findAllComponents(Select).map((c) => c.attributes("data-test"));
    expect(keys).toEqual(["library", "negatives", "structure", "style", "rating", "model"]
      .map((k) => `pack-setting-${k}`));
    // What a pack is about (subject, LoRAs, a story) is the planner's, not a setting.
    for (const k of ["run", "loras", "inputs", "frames"]) {
      expect(w.find(`[data-test="pack-setting-${k}"]`).exists()).toBe(false);
    }
    const model = w.findAllComponents(Select).find((c) => c.attributes("data-test") === "pack-setting-model")!;
    model.vm.$emit("update:modelValue", "family");
    expect(last(w.emitted("update:modelValue")).model).toBe("family");
  });
});
