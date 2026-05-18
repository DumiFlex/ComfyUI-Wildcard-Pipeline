import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import CommandPalette from "../components/CommandPalette.vue";

let wrap: VueWrapper | null = null;

afterEach(() => {
  wrap?.unmount();
  wrap = null;
});

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    wrap = mount(CommandPalette, {
      props: { open: false, items: [] },
      attachTo: document.body,
    });
    expect(document.body.querySelector('[data-test="cp-input"]')).toBeNull();
  });

  it("renders input + items when open", async () => {
    const items = [
      { id: "a", label: "Alpha", kind: "module" as const, icon: "pi-sparkles", run: vi.fn() },
      { id: "b", label: "Beta",  kind: "route"  as const, icon: "pi-cog",      run: vi.fn() },
    ];
    wrap = mount(CommandPalette, { props: { open: true, items }, attachTo: document.body });
    expect(document.body.querySelector('[data-test="cp-input"]')).not.toBeNull();
    expect(document.body.querySelectorAll('[data-test="cp-result"]').length).toBe(2);
  });

  it("filters items by input value", async () => {
    const items = [
      { id: "a", label: "Alpha", kind: "module" as const, icon: "pi-sparkles", run: vi.fn() },
      { id: "b", label: "Beta",  kind: "route"  as const, icon: "pi-cog",      run: vi.fn() },
    ];
    wrap = mount(CommandPalette, { props: { open: true, items }, attachTo: document.body });
    const input = document.body.querySelector('[data-test="cp-input"]') as HTMLInputElement;
    input.value = "Alp";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await wrap.vm.$nextTick();
    const results = document.body.querySelectorAll('[data-test="cp-result"]');
    expect(results.length).toBe(1);
  });

  it("runs item action on Enter", async () => {
    const run = vi.fn();
    const items = [
      { id: "a", label: "Alpha", kind: "module" as const, icon: "pi-sparkles", run },
    ];
    wrap = mount(CommandPalette, { props: { open: true, items }, attachTo: document.body });
    const input = document.body.querySelector('[data-test="cp-input"]') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await wrap.vm.$nextTick();
    expect(run).toHaveBeenCalled();
  });

  it("emits update:open(false) on Esc", async () => {
    wrap = mount(CommandPalette, { props: { open: true, items: [] }, attachTo: document.body });
    const input = document.body.querySelector('[data-test="cp-input"]') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wrap.vm.$nextTick();
    expect(wrap.emitted("update:open")).toBeTruthy();
    expect(wrap.emitted("update:open")?.[0]).toEqual([false]);
  });

  it("ArrowDown moves selection", async () => {
    const items = [
      { id: "a", label: "Alpha", kind: "module" as const, icon: "pi-sparkles", run: vi.fn() },
      { id: "b", label: "Beta",  kind: "route"  as const, icon: "pi-cog",      run: vi.fn() },
    ];
    wrap = mount(CommandPalette, { props: { open: true, items }, attachTo: document.body });
    const input = document.body.querySelector('[data-test="cp-input"]') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await wrap.vm.$nextTick();
    const results = document.body.querySelectorAll('[data-test="cp-result"]');
    expect(results[1].getAttribute("aria-selected")).toBe("true");
  });
});
