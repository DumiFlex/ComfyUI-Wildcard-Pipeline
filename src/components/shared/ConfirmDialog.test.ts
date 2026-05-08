import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ConfirmDialog from "./ConfirmDialog.vue";

const mountOpts = { global: { stubs: { teleport: true } } } as const;

describe("ConfirmDialog", () => {
  it("renders nothing when not visible", () => {
    const w = mount(ConfirmDialog, {
      ...mountOpts,
      props: { visible: false, title: "Test" },
    });
    expect(w.find('[data-test="confirm-overlay"]').exists()).toBe(false);
  });

  it("renders title + body when visible", () => {
    const w = mount(ConfirmDialog, {
      ...mountOpts,
      props: { visible: true, title: "Reset?", body: "Are you sure?" },
    });
    expect(w.find('[data-test="confirm-title"]').text()).toBe("Reset?");
    expect(w.find('[data-test="confirm-body"]').text()).toBe("Are you sure?");
  });

  it("body is hidden when prop omitted", () => {
    const w = mount(ConfirmDialog, {
      ...mountOpts,
      props: { visible: true, title: "Reset?" },
    });
    expect(w.find('[data-test="confirm-body"]').exists()).toBe(false);
  });

  it("emits confirm when Confirm button clicked", async () => {
    const w = mount(ConfirmDialog, {
      ...mountOpts,
      props: { visible: true, title: "Reset?" },
    });
    await w.find('[data-test="confirm-confirm"]').trigger("click");
    expect(w.emitted("confirm")).toBeTruthy();
    expect(w.emitted("cancel")).toBeUndefined();
  });

  it("emits cancel when Cancel button clicked", async () => {
    const w = mount(ConfirmDialog, {
      ...mountOpts,
      props: { visible: true, title: "Reset?" },
    });
    await w.find('[data-test="confirm-cancel"]').trigger("click");
    expect(w.emitted("cancel")).toBeTruthy();
    expect(w.emitted("confirm")).toBeUndefined();
  });

  it("emits cancel on overlay click", async () => {
    const w = mount(ConfirmDialog, {
      ...mountOpts,
      props: { visible: true, title: "Reset?" },
    });
    await w.find('[data-test="confirm-overlay"]').trigger("click");
    expect(w.emitted("cancel")).toBeTruthy();
  });

  it("renders custom labels", () => {
    const w = mount(ConfirmDialog, {
      ...mountOpts,
      props: {
        visible: true,
        title: "Save?",
        confirmLabel: "Push",
        cancelLabel: "Keep local",
      },
    });
    expect(w.find('[data-test="confirm-confirm"]').text()).toBe("Push");
    expect(w.find('[data-test="confirm-cancel"]').text()).toBe("Keep local");
  });

  it("danger variant adds danger class to Confirm button", () => {
    const w = mount(ConfirmDialog, {
      ...mountOpts,
      props: { visible: true, title: "Discard?", variant: "danger" },
    });
    expect(w.find('[data-test="confirm-confirm"]').classes()).toContain("wp-confirm__btn--danger");
  });
});
