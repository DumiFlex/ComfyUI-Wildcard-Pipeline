import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import InstanceIdChip from "./InstanceIdChip.vue";

describe("InstanceIdChip", () => {
  beforeEach(() => {
    // jsdom has no clipboard by default — stub a resolving writeText.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => undefined) },
      configurable: true,
    });
  });

  it("renders the library id as the visible label", () => {
    const w = mount(InstanceIdChip, { props: { id: "ab12cd34" } });
    const chip = w.get('[data-test="instance-id-chip"]');
    expect(chip.text()).toContain("ab12cd34");
  });

  it("renders nothing when id is empty (unlinked/inline module)", () => {
    const w = mount(InstanceIdChip, { props: { id: "" } });
    expect(w.find('[data-test="instance-id-chip"]').exists()).toBe(false);
  });

  it("surfaces both id and _uid in the tooltip", () => {
    const w = mount(InstanceIdChip, { props: { id: "ab12cd34", uid: "uid-9f9f9f" } });
    const title = w.get('[data-test="instance-id-chip"]').attributes("title") ?? "";
    expect(title).toContain("ab12cd34");
    expect(title).toContain("uid-9f9f9f");
  });

  it("copies the id to the clipboard and flips to a copied state on click", async () => {
    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    const w = mount(InstanceIdChip, { props: { id: "ab12cd34" } });
    await w.get('[data-test="instance-id-chip"]').trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith("ab12cd34");
    expect(w.get('[data-test="instance-id-chip"]').classes()).toContain("wp-idchip--copied");
    expect(w.get('[data-test="instance-id-chip"]').text()).toContain("copied");
  });
});
