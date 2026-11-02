import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import ConfirmModal from "../ConfirmModal.vue";

/** The element, or a failed test that names what was missing. */
function must<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`missing ${what}`);
  return v;
}

let w: VueWrapper | null = null;
afterEach(() => {
  w?.unmount();
  w = null;
  document.body.innerHTML = "";
});

const btn = (name: string) => must(document.body.querySelector<HTMLButtonElement>(`[data-test="confirm-${name}"]`), name);

describe("ConfirmModal", () => {
  it("confirms and cancels", async () => {
    w = mount(ConfirmModal, { props: { open: true, title: "Delete?" }, attachTo: document.body });
    btn("confirm").click();
    btn("cancel").click();
    expect(w.emitted("confirm")).toHaveLength(1);
    expect(w.emitted("cancel")).toHaveLength(1);
  });

  it("holds Confirm off until the word is typed", async () => {
    w = mount(ConfirmModal, { props: { open: true, title: "Delete @mira?", requireType: "mira", tone: "danger" }, attachTo: document.body });
    expect(btn("confirm").disabled).toBe(true);
    const input = must(document.body.querySelector<HTMLInputElement>('[data-test="confirm-type"] input, input[data-test="confirm-type"]'), "type field");
    input.value = "mir";
    input.dispatchEvent(new Event("input"));
    await w.vm.$nextTick();
    expect(btn("confirm").disabled).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(w.emitted("confirm")).toBeUndefined();
    input.value = "mira";
    input.dispatchEvent(new Event("input"));
    await w.vm.$nextTick();
    expect(btn("confirm").disabled).toBe(false);
    btn("confirm").click();
    expect(w.emitted("confirm")).toHaveLength(1);
  });

  it("clears the typed word when it opens again", async () => {
    w = mount(ConfirmModal, { props: { open: true, title: "x", requireType: "go" }, attachTo: document.body });
    const input = () => must(document.body.querySelector<HTMLInputElement>('[data-test="confirm-type"] input, input[data-test="confirm-type"]'), "type field");
    input().value = "go";
    input().dispatchEvent(new Event("input"));
    await w.setProps({ open: false });
    await w.setProps({ open: true });
    expect(input().value).toBe("");
  });

  it("holds Confirm off for the page's own gate and uses an outlined button for warn", async () => {
    w = mount(ConfirmModal, { props: { open: true, title: "Ban?", tone: "warn", confirmDisabled: true }, attachTo: document.body });
    expect(btn("confirm").disabled).toBe(true);
    expect(btn("confirm").className).toContain("outline");
    expect(document.body.querySelector(".wp-confirm-modal__head--warn")).not.toBeNull();
    await w.setProps({ confirmDisabled: false });
    expect(btn("confirm").disabled).toBe(false);
  });
});
