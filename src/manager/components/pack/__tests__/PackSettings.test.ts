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
  it("offers the run style, LoRA, model and subject settings, and frames for a story", async () => {
    const w = mount(PackSettings, { props: { modelValue: { ...DEFAULT_SETTINGS }, detailed: true } });
    const sel = (key: string) => w.findAllComponents(Select).find((c) => c.attributes("data-test") === `pack-setting-${key}`)!;
    for (const key of ["run", "loras", "model", "inputs"]) expect(sel(key).exists()).toBe(true);
    expect((sel("loras").props("options") as Array<{ value: unknown }>).map((o) => o.value))
      .toEqual(["none", "style", "character", "both"]);
    expect(w.find('[data-test="pack-setting-frames"]').exists()).toBe(false);
    sel("run").vm.$emit("update:modelValue", "story");
    const story = last(w.emitted("update:modelValue"));
    expect(story.run).toBe("story");
    await w.setProps({ modelValue: story });
    expect(w.get('[data-test="pack-setting-hint-run"]').text()).toContain("story beat per frame");
    const frames = w.get('[data-test="pack-setting-frames"] input, input[data-test="pack-setting-frames"]');
    await frames.setValue("30");
    expect((last(w.emitted("update:modelValue"))).frames).toBe(12);
  });
});
