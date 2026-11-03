import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import DisplayPlaygroundModal from "../DisplayPlaygroundModal.vue";
import { closePlayground, openPlayground, playgroundOpen } from "../playground-store";

let wrap: VueWrapper | null = null;

afterEach(() => {
  closePlayground();
  wrap?.unmount();
  wrap = null;
  document.body.innerHTML = "";
});

async function open(): Promise<HTMLElement> {
  const trigger = document.createElement("button");
  trigger.textContent = "Open playground";
  document.body.appendChild(trigger);
  trigger.focus();
  wrap = mount(DisplayPlaygroundModal, { attachTo: document.body });
  openPlayground();
  await nextTick();
  await nextTick();
  return trigger;
}

const overlay = (): HTMLElement | null => document.body.querySelector<HTMLElement>(".wp-modal-overlay");

describe("DisplayPlaygroundModal", () => {
  it("opens in the kit dialog, named by its title", async () => {
    await open();
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-labelledby")).toBe("wp-pg-title");
    expect(document.getElementById("wp-pg-title")?.textContent).toBe("Display Playground");
    expect(document.body.querySelector('[data-test="playground-controls"]')).not.toBeNull();
    expect(document.body.querySelector('[data-test="playground-preview"]')).not.toBeNull();
  });

  it("keeps working over ComfyUI's Settings dialog: the overlay takes pointer events back", async () => {
    // reka sets body pointer-events none while its modal is open.
    document.body.style.pointerEvents = "none";
    await open();
    expect(overlay()?.style.pointerEvents).toBe("auto");
    // The host's outside-pointer event is stopped so Settings stays open.
    const outside = new CustomEvent("dismissableLayer.pointerDownOutside", { cancelable: true, bubbles: true });
    document.body.querySelector(".wp-pg")?.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(true);
    document.body.style.pointerEvents = "";
  });

  it("Escape closes it and the host dialog never sees an unhandled Escape", async () => {
    await open();
    const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.body.querySelector(".wp-pg")?.dispatchEvent(ev);
    await nextTick();
    expect(ev.defaultPrevented).toBe(true);
    expect(playgroundOpen.value).toBe(false);
  });

  it("a backdrop click closes it; a click inside does not", async () => {
    await open();
    const panel = document.body.querySelector<HTMLElement>(".wp-pg");
    panel?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    panel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(playgroundOpen.value).toBe(true);
    const back = overlay();
    back?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    back?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(playgroundOpen.value).toBe(false);
  });

  it("Done closes it and focus goes back to what opened it", async () => {
    const trigger = await open();
    expect(document.body.querySelector(".wp-pg")?.contains(document.activeElement)).toBe(true);
    const done = [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Done");
    done?.click();
    await nextTick();
    await nextTick();
    expect(playgroundOpen.value).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
});
