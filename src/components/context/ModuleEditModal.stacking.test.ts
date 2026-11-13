import { describe, it, expect, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import ModuleEditModal from "./ModuleEditModal.vue";
import type { ModuleEntry } from "../../widgets/_shared";

// Real teleports: the confirm a window raises must land on top of that window. Every kit modal sits
// at the same z-index, so the one later in <body> wins.
const wildcard: ModuleEntry = {
  id: "ab12cd34",
  type: "wildcard",
  enabled: true,
  meta: { name: "outfit" },
  entries: [],
  payload: { options: [{ id: "o1", value: "red", weight: 1 }, { id: "o2", value: "blue", weight: 2 }] },
  payload_hash: "deadbeefcafef00d",
  instance: { option_weights: { o1: 5 } },
};

let wrapper: VueWrapper | null = null;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

describe("ModuleEditModal confirm stacking", () => {
  it("puts the Reset overrides confirm above the editor that opened it", async () => {
    // The Context mounts the editor hidden and shows it later, so the editor's window is teleported
    // after the editor's own (always mounted) confirm.
    wrapper = mount(ModuleEditModal, { attachTo: document.body, props: { visible: false, module: wildcard } });
    await nextTick();
    await wrapper.setProps({ visible: true });
    await nextTick();
    const reset = document.querySelector<HTMLElement>('[data-test="wcm-clear-all"]');
    expect(reset).not.toBeNull();
    reset?.click();
    await nextTick();
    await nextTick();
    const overlays = [...document.querySelectorAll(".wp-modal-overlay")];
    expect(overlays.length).toBeGreaterThanOrEqual(2);
    expect(overlays[overlays.length - 1]?.textContent).toContain("Reset overrides?");
  });
});
