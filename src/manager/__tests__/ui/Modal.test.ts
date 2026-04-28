import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Modal from "../../components/ui/Modal.vue";

describe("Modal.vue", () => {
  it("renders teleported when open=true", () => {
    const wrap = mount(Modal, {
      props: { open: true, title: "Confirm" },
      slots: { default: "<p>Body</p>" },
      attachTo: document.body,
    });
    expect(document.body.querySelector(".wp-modal")).not.toBeNull();
    expect(document.body.querySelector(".wp-modal__title")?.textContent).toBe("Confirm");
    wrap.unmount();
  });

  it("emits update:open=false on backdrop click", async () => {
    const wrap = mount(Modal, {
      props: { open: true },
      slots: { default: "<p>x</p>" },
      attachTo: document.body,
    });
    const backdrop = document.body.querySelector("[data-test='modal-backdrop']") as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(wrap.emitted("update:open")?.[0]).toEqual([false]);
    wrap.unmount();
  });
});
