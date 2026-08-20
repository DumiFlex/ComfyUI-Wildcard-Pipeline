/**
 * The info card's action footer (item #9): a resolved ref chip's hover card is
 * interactive — copy the id, open the linked module in a new window. The card
 * used to be pointer-events:none (unreachable) and 10px (unreadable).
 */
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RefChip from "./RefChip.vue";

function mountRef(props: Record<string, unknown> = {}) {
  return mount(RefChip, {
    props: { kind: "ref", name: "outfit", uuid: "abc12345", resolved: true, ...props },
    attachTo: document.body,
  });
}

/** Open the teleported hover card by hovering the chip past its delay. */
async function openCard(wrap: ReturnType<typeof mountRef>) {
  await wrap.find(".wp-refchip").trigger("mouseenter");
  vi.advanceTimersByTime(400);
  await wrap.vm.$nextTick();
}

describe("RefChip — info card actions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

  it("copies the uuid to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const wrap = mountRef();
    await openCard(wrap);
    const btn = document.querySelector("[data-test='refchip-copy-id']") as HTMLElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(writeText).toHaveBeenCalledWith("abc12345");
    wrap.unmount();
  });

  it("opens the linked module's SPA editor in a new window", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const wrap = mountRef({ moduleKind: "wildcard" });
    await openCard(wrap);
    (document.querySelector("[data-test='refchip-open-new']") as HTMLElement).click();
    expect(open).toHaveBeenCalledWith("/wp/wildcards/abc12345/edit", "_blank", "noopener");
    vi.unstubAllGlobals();
    wrap.unmount();
  });

  it("offers Copy but NOT Open for a broken (unresolved) ref", async () => {
    const wrap = mountRef({ resolved: false, name: "gone" });
    await openCard(wrap);
    expect(document.querySelector("[data-test='refchip-copy-id']")).toBeTruthy();
    expect(document.querySelector("[data-test='refchip-open-new']")).toBeNull();
    wrap.unmount();
  });

  it("keeps the card open when the pointer moves from chip into the card", async () => {
    const wrap = mountRef();
    await openCard(wrap);
    // Leaving the chip arms a delayed close...
    await wrap.find(".wp-refchip").trigger("mouseleave");
    // ...but entering the card cancels it.
    const card = document.querySelector("[data-test='refchip-hover']") as HTMLElement;
    card.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    vi.advanceTimersByTime(400);
    await wrap.vm.$nextTick();
    expect(document.querySelector("[data-test='refchip-hover']")).toBeTruthy();
    wrap.unmount();
  });
});
