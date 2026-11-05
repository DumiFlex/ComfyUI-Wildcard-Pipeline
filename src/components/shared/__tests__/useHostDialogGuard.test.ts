import { describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { useHostDialogGuard } from "../useHostDialogGuard";

/**
 * Stand-in for ComfyUI's reka Settings dialog: body pointer-events off, a
 * document listener that would dismiss on an outside pointerdown, one that
 * would pull focus back, and a window Escape listener that dismisses unless
 * the key was default-prevented.
 */
function fakeHost() {
  const log: string[] = [];
  document.body.style.pointerEvents = "none";
  const onFocus = (): void => { log.push("focus-trap"); };
  const onEsc = (e: KeyboardEvent): void => { if (e.key === "Escape" && !e.defaultPrevented) log.push("host-closed"); };
  document.addEventListener("focusin", onFocus);
  document.addEventListener("focusout", onFocus);
  window.addEventListener("keydown", onEsc);
  return {
    log,
    outside(target: Element): boolean {
      const ev = new CustomEvent("dismissableLayer.pointerDownOutside", { bubbles: false, cancelable: true });
      target.dispatchEvent(ev);
      return ev.defaultPrevented;
    },
    done(): void {
      document.body.style.pointerEvents = "";
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onFocus);
      window.removeEventListener("keydown", onEsc);
    },
  };
}

const Overlay = defineComponent({
  props: { open: { type: Boolean, default: true } },
  setup(props) {
    const el = ref<HTMLElement | null>(null);
    useHostDialogGuard(el, () => props.open);
    return () => props.open
      ? h("div", { ref: el, class: "ov" }, [h("button", { class: "inner" }, "x")])
      : null;
  },
});

describe("useHostDialogGuard", () => {
  it("re-enables clicks and keeps the host dialog from closing or grabbing focus", async () => {
    const host = fakeHost();
    const outsideBtn = document.createElement("button");
    document.body.appendChild(outsideBtn);
    const w = mount(Overlay, { attachTo: document.body });
    await nextTick();
    const ov = w.find(".ov").element as HTMLElement;
    const inner = w.find(".inner").element as HTMLButtonElement;
    expect(ov.style.pointerEvents).toBe("auto");
    expect(host.outside(inner)).toBe(true);

    outsideBtn.focus();
    host.log.length = 0;
    inner.focus();
    expect(host.log).toEqual([]);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    expect(host.log).toEqual([]);

    w.unmount();
    outsideBtn.remove();
    host.done();
  });

  it("lets everything through again once closed", async () => {
    const host = fakeHost();
    const w = mount(Overlay, { attachTo: document.body, props: { open: true } });
    await nextTick();
    await w.setProps({ open: false });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    expect(host.log).toEqual(["host-closed"]);
    w.unmount();
    host.done();
  });
});
