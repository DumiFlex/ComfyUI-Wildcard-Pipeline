import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent, h, ref, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { useModalKeyShield } from "./useModalKeyShield";

/**
 * ComfyUI binds `useEventListener(window, 'keydown', keybindHandler)` and only
 * bails for text-editing targets, so a plain letter pressed while focus sits
 * on a button inside one of our modals ran a global keybinding — `r` fired
 * Refresh Node Definitions and froze the page. These pin the shield.
 */
const Harness = defineComponent({
  props: {
    open: { type: Boolean, default: true },
    onKey: { type: Function, default: undefined },
    passThrough: { type: Function, default: undefined },
  },
  setup(props) {
    const root = ref<HTMLElement | null>(null);
    useModalKeyShield(root, {
      onKey: props.onKey as ((e: KeyboardEvent) => void) | undefined,
      passThrough: props.passThrough as ((e: KeyboardEvent) => boolean) | undefined,
    });
    return () => (props.open
      ? h("div", { ref: root, class: "overlay" }, [h("button", { class: "inner" }, "ok")])
      : null);
  },
});

function pressInside(wrapper: ReturnType<typeof mount>, key: string, type = "keydown") {
  const inner = wrapper.element.querySelector(".inner") as HTMLElement;
  inner.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
}

afterEach(() => { document.body.replaceChildren(); });

describe("useModalKeyShield", () => {
  it("stops a keydown from inside the modal reaching window", async () => {
    const atWindow = vi.fn();
    window.addEventListener("keydown", atWindow);
    const wrapper = mount(Harness, { attachTo: document.body });
    await nextTick(); // the shield binds on a post-flush watcher
    pressInside(wrapper, "r");
    expect(atWindow).not.toHaveBeenCalled();
    window.removeEventListener("keydown", atWindow);
    wrapper.unmount();
  });

  it("stops keyup too — extensions bind shortcuts on it", async () => {
    const atWindow = vi.fn();
    window.addEventListener("keyup", atWindow);
    const wrapper = mount(Harness, { attachTo: document.body });
    await nextTick(); // the shield binds on a post-flush watcher
    pressInside(wrapper, "r", "keyup");
    expect(atWindow).not.toHaveBeenCalled();
    window.removeEventListener("keyup", atWindow);
    wrapper.unmount();
  });

  it("hands the key to the modal first — that is where its own handling lives", async () => {
    const onKey = vi.fn();
    const wrapper = mount(Harness, { props: { onKey }, attachTo: document.body });
    await nextTick();
    pressInside(wrapper, "Escape");
    expect(onKey).toHaveBeenCalledTimes(1);
    expect((onKey.mock.calls[0][0] as KeyboardEvent).key).toBe("Escape");
    wrapper.unmount();
  });

  it("never calls preventDefault, so typing and IME still work", async () => {
    const wrapper = mount(Harness, { attachTo: document.body });
    await nextTick(); // the shield binds on a post-flush watcher
    const inner = wrapper.element.querySelector(".inner") as HTMLElement;
    const ev = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    inner.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    wrapper.unmount();
  });

  it("honours passThrough for keys the page should still see", async () => {
    const atWindow = vi.fn();
    window.addEventListener("keydown", atWindow);
    const wrapper = mount(Harness, {
      props: { passThrough: (e: KeyboardEvent) => e.key === "F5" },
      attachTo: document.body,
    });
    await nextTick();
    pressInside(wrapper, "F5");
    expect(atWindow).toHaveBeenCalledTimes(1);
    pressInside(wrapper, "r");
    expect(atWindow).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", atWindow);
    wrapper.unmount();
  });

  it("detaches when the modal closes, so the page gets its keyboard back", async () => {
    const atWindow = vi.fn();
    window.addEventListener("keydown", atWindow);
    const wrapper = mount(Harness, { attachTo: document.body });
    await nextTick(); // the shield binds on a post-flush watcher
    const inner = wrapper.element.querySelector(".inner") as HTMLElement;
    document.body.appendChild(inner); // survives the modal being torn down
    await wrapper.setProps({ open: false });
    await nextTick();
    inner.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
    expect(atWindow).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", atWindow);
    wrapper.unmount();
  });
});
