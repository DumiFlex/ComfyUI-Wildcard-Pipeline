import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref, withDirectives, type Ref } from "vue";
import ContextMenu from "./ContextMenu.vue";
import DropdownMenu from "./DropdownMenu.vue";
import Popover from "./Popover.vue";
import { vTooltip } from "./tooltip";

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function popoverHost() {
  return defineComponent({
    setup() {
      const open = ref(false);
      return () => h("div", [
        h(Popover, { open: open.value, label: "Filter", "onUpdate:open": (v: boolean) => { open.value = v; } }, {
          trigger: ({ props }: { props: Record<string, unknown> }) => h("button", { ...props, type: "button", class: "trig" }, "Filter"),
          default: () => h("input", { class: "inside", "aria-label": "Name" }),
        }),
        h("button", { type: "button", class: "outside" }, "Elsewhere"),
      ]);
    },
  });
}

describe("Popover", () => {
  it("opens from the trigger, focuses the first control and wires aria", async () => {
    const w = mount(popoverHost(), { attachTo: document.body });
    const trig = w.find(".trig");
    expect(trig.attributes("aria-expanded")).toBe("false");
    await trig.trigger("click");
    await nextTick();
    const panel = document.querySelector<HTMLElement>(".wp-popover");
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("role")).toBe("dialog");
    expect(trig.attributes("aria-expanded")).toBe("true");
    expect(trig.attributes("aria-controls")).toBe(panel?.id);
    expect(document.activeElement?.classList.contains("inside")).toBe(true);
    w.unmount();
  });

  it("closes on Escape and gives focus back to the trigger", async () => {
    const w = mount(popoverHost(), { attachTo: document.body });
    await w.find(".trig").trigger("click");
    await nextTick();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(document.querySelector(".wp-popover")).toBeNull();
    expect(document.activeElement).toBe(w.find(".trig").element);
    w.unmount();
  });

  it("closes on a click outside but not on one inside", async () => {
    const w = mount(popoverHost(), { attachTo: document.body });
    await w.find(".trig").trigger("click");
    await nextTick();
    document.querySelector(".inside")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    await nextTick();
    expect(document.querySelector(".wp-popover")).not.toBeNull();
    w.find(".outside").element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    await nextTick();
    expect(document.querySelector(".wp-popover")).toBeNull();
    w.unmount();
  });
});

describe("DropdownMenu", () => {
  function menuHost(onSelect: () => void) {
    return defineComponent({
      setup() {
        return () => h(DropdownMenu, { items: [{ label: "Rename", onSelect }, { label: "Delete", danger: true, onSelect: () => undefined }], label: "Actions" }, {
          trigger: ({ props }: { props: Record<string, unknown> }) => h("button", { ...props, type: "button", class: "trig" }, "⋯"),
        });
      },
    });
  }

  it("toggles from its trigger and picks with the keyboard", async () => {
    const pick = vi.fn();
    const w = mount(menuHost(pick), { attachTo: document.body });
    const trig = w.find(".trig");
    expect(trig.attributes("aria-haspopup")).toBe("menu");
    expect(trig.attributes("aria-label")).toBe("Actions");
    await trig.trigger("click");
    await nextTick();
    expect(document.querySelectorAll(".wp-ctxmenu__item")).toHaveLength(2);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    await nextTick();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await nextTick();
    expect(pick).toHaveBeenCalledOnce();
    expect(document.querySelector(".wp-ctxmenu")).toBeNull();
    expect(document.activeElement).toBe(trig.element);
    w.unmount();
  });

  it("opens with ArrowDown on the trigger, and a second click closes it", async () => {
    const w = mount(menuHost(() => undefined), { attachTo: document.body });
    const trig = w.find(".trig");
    await trig.trigger("keydown", { key: "ArrowDown" });
    await nextTick();
    expect(document.querySelector(".wp-ctxmenu")).not.toBeNull();
    trig.element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    await trig.trigger("click");
    await nextTick();
    expect(document.querySelector(".wp-ctxmenu")).toBeNull();
    w.unmount();
  });
});

describe("menus on scroll", () => {
  it("a menu opened from a trigger follows it", async () => {
    const trig = document.createElement("button");
    document.body.append(trig);
    let top = 100;
    trig.getBoundingClientRect = () => ({ left: 40, top, width: 30, height: 20, right: 70, bottom: top + 20, x: 40, y: top, toJSON: () => ({}) });
    const w = mount(ContextMenu, { attachTo: document.body, props: { visible: false, x: 0, y: 0, anchor: trig, items: [{ label: "Rename", onSelect: () => undefined }] } });
    await w.setProps({ visible: true });
    await nextTick(); await nextTick();
    const menu = document.querySelector<HTMLElement>(".wp-ctxmenu");
    const before = menu?.style.top;
    top = 40;
    window.dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(menu?.style.top).not.toBe(before);
    expect(w.emitted("close")).toBeUndefined();
    w.unmount();
  });

  it("a menu opened at the pointer closes", async () => {
    const w = mount(ContextMenu, { attachTo: document.body, props: { visible: false, x: 10, y: 10, items: [{ label: "Rename", onSelect: () => undefined }] } });
    await w.setProps({ visible: true });
    await nextTick();
    window.dispatchEvent(new Event("scroll"));
    expect(w.emitted("close")).toHaveLength(1);
    w.unmount();
  });
});

describe("v-tooltip", () => {
  function tipHost(text: Ref<string>) {
    return defineComponent({
      render: () => withDirectives(h("button", { type: "button", class: "b" }, "Copy"), [[vTooltip, text.value]]),
    });
  }

  it("shows after a short wait on hover, and hides on leave", async () => {
    vi.useFakeTimers();
    const text = ref<string>("Copy the prompt");
    const w = mount(tipHost(text), { attachTo: document.body });
    const b = w.find(".b").element;
    b.dispatchEvent(new PointerEvent("pointerenter"));
    expect(document.querySelector(".wp-tooltip[data-open]")).toBeNull();
    vi.advanceTimersByTime(500);
    const tip = document.querySelector(".wp-tooltip[data-open]");
    expect(tip?.textContent).toBe("Copy the prompt");
    expect(b.getAttribute("aria-describedby")).toBe(tip?.id);
    b.dispatchEvent(new PointerEvent("pointerleave"));
    expect(document.querySelector(".wp-tooltip[data-open]")).toBeNull();
    expect(b.hasAttribute("aria-describedby")).toBe(false);
    w.unmount();
  });

  it("shows a shortcut after the text", () => {
    vi.useFakeTimers();
    const w = mount(defineComponent({
      render: () => withDirectives(h("button", { type: "button", class: "k" }, "Copy"), [[vTooltip, { text: "Copy to clipboard", kbd: "Ctrl C" }]]),
    }), { attachTo: document.body });
    w.find(".k").element.dispatchEvent(new PointerEvent("pointerenter"));
    vi.advanceTimersByTime(500);
    expect(document.querySelector(".wp-tooltip[data-open] .wp-tooltip__kbd")?.textContent).toBe("Ctrl C");
    w.unmount();
  });

  it("follows a changed text and hides on Escape", async () => {
    vi.useFakeTimers();
    const text = ref<string>("One");
    const w = mount(tipHost(text), { attachTo: document.body });
    const b = w.find(".b").element;
    b.dispatchEvent(new PointerEvent("pointerenter"));
    vi.advanceTimersByTime(500);
    text.value = "Two";
    await nextTick();
    expect(document.querySelector(".wp-tooltip")?.textContent).toBe("Two");
    b.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".wp-tooltip[data-open]")).toBeNull();
    w.unmount();
  });
});

