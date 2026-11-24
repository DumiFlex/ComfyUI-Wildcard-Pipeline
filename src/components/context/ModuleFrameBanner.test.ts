import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ModuleFrameBanner from "./ModuleFrameBanner.vue";
import type { ModuleEntry } from "../../widgets/_shared";

const mod = (extra: Partial<ModuleEntry> = {}): ModuleEntry => ({
  id: "m1", type: "wildcard", enabled: true, meta: { name: "x" }, entries: [], instance: {}, ...extra,
});

describe("ModuleFrameBanner", () => {
  it("on a picked frame says so and offers Revert", async () => {
    const w = mount(ModuleFrameBanner, { props: { module: mod(), currentFrame: 2 } });
    expect(w.get('[data-test="modal-frame-banner"]').text()).toContain("Editing frame #3");
    await w.get('[data-test="modal-frame-revert"]').trigger("click");
    expect(w.emitted("revert-frame")).toHaveLength(1);
  });

  it("on Base names the frames that override the module", () => {
    const w = mount(ModuleFrameBanner, {
      props: {
        module: mod({ iteration_overrides: { "3": { pinned_option_id: "0" } }, frame_enabled: { "1": false } }),
        currentFrame: null,
      },
    });
    const banner = w.get('[data-test="modal-base-frames"]');
    expect(banner.text()).toContain("2 frames override this module");
    expect(w.get('[data-test="modal-base-frame-1"]').text()).toBe("#2 off");
    expect(w.get('[data-test="modal-base-frame-3"]').text()).toBe("#4 1 change");
  });

  it("shows nothing on Base without overrides", () => {
    const w = mount(ModuleFrameBanner, { props: { module: mod(), currentFrame: null } });
    expect(w.html()).not.toContain("wp-modal-frame-banner");
  });
});
