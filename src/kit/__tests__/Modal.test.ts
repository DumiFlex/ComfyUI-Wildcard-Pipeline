import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, it } from "vitest";
import Modal from "../Modal.vue";

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

  it("moves focus in, keeps Tab inside, and gives it back on close", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const wrap = mount(Modal, {
      props: { open: false, title: "Edit" },
      slots: { default: '<input data-test="a" /><button data-test="b">B</button>' },
      attachTo: document.body,
    });
    await wrap.setProps({ open: true });
    await nextTick();
    const a = document.body.querySelector("[data-test='a']") as HTMLElement;
    const b = document.body.querySelector("[data-test='b']") as HTMLElement;
    const close = document.body.querySelector("[aria-label='Close']") as HTMLElement;
    expect(document.activeElement).toBe(a);
    const dialog = document.body.querySelector("[role='dialog']") as HTMLElement;
    expect(dialog.getAttribute("aria-labelledby")).toBe(document.body.querySelector(".wp-modal__title")?.id);
    // Close is first in the dialog, B last: Tab from B wraps to Close.
    b.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", cancelable: true }));
    expect(document.activeElement).toBe(close);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, cancelable: true }));
    expect(document.activeElement).toBe(b);
    await wrap.setProps({ open: false });
    expect(document.activeElement).toBe(opener);
    wrap.unmount();
    opener.remove();
  });
});
