import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import Drawer from "../Drawer.vue";

function host(modal = true) {
  return defineComponent({
    setup() {
      const open = ref(false);
      return () => h("div", [
        h("button", { type: "button", class: "opener", onClick: () => { open.value = true; } }, "Open"),
        h(Drawer, { open: open.value, title: "History", modal, "onUpdate:open": (v: boolean) => { open.value = v; } }, {
          default: () => h("input", { class: "field", "aria-label": "Search history" }),
        }),
      ]);
    },
  });
}

async function openIt(w: ReturnType<typeof mount>) {
  const opener = w.find(".opener").element as HTMLElement;
  opener.focus();
  await w.find(".opener").trigger("click");
  await nextTick();
  await nextTick();
}

describe("Drawer", () => {
  it("opens as a named dialog with focus on its first control", async () => {
    const w = mount(host(), { attachTo: document.body });
    await openIt(w);
    const panel = document.querySelector(".wp-drawer");
    expect(panel?.getAttribute("role")).toBe("dialog");
    expect(panel?.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(panel?.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("History");
    expect(document.activeElement?.classList.contains("field")).toBe(true);
    w.unmount();
  });

  it("closes on Escape and gives focus back", async () => {
    const w = mount(host(), { attachTo: document.body });
    await openIt(w);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    await nextTick();
    expect(document.querySelector(".wp-drawer")).toBeNull();
    expect(document.activeElement).toBe(w.find(".opener").element);
    w.unmount();
  });

  it("closes from the backdrop and the close button", async () => {
    const w = mount(host(), { attachTo: document.body });
    await openIt(w);
    document.querySelector<HTMLElement>('[data-test="drawer-backdrop"]')?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await nextTick();
    expect(document.querySelector(".wp-drawer")).toBeNull();
    await openIt(w);
    document.querySelector<HTMLElement>('[data-test="drawer-close"]')?.click();
    await nextTick();
    expect(document.querySelector(".wp-drawer")).toBeNull();
    w.unmount();
  });

  it("has no backdrop and no Tab trap when it isn't modal", async () => {
    const w = mount(host(false), { attachTo: document.body });
    await openIt(w);
    expect(document.querySelector('[data-test="drawer-backdrop"]')).toBeNull();
    expect(document.querySelector(".wp-drawer")?.hasAttribute("aria-modal")).toBe(false);
    const tab = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    window.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    w.unmount();
  });
});
