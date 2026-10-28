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

  it("groups an empty search under short headings, Recent first", () => {
    localStorage.removeItem("wp-palette-recent");
    const items = [
      { id: "route:a", label: "Dashboard", kind: "route" as const, icon: "pi-home", run: vi.fn() },
      { id: "action:new-wildcard", label: "New wildcard", kind: "action" as const, icon: "pi-plus", run: vi.fn() },
      { id: "action:toggle-theme", label: "Toggle theme", kind: "action" as const, icon: "pi-sun", run: vi.fn() },
      { id: "module:m1", label: "Hair", kind: "module" as const, icon: "pi-sparkles", run: vi.fn() },
      { id: "module:m2", label: "Eyes", kind: "module" as const, icon: "pi-sparkles", run: vi.fn() },
    ];
    wrap = mount(CommandPalette, { props: { open: true, items, recentIds: ["module:m2"] }, attachTo: document.body });
    const heads = [...document.body.querySelectorAll('[data-test="cp-group"]')].map((h) => h.textContent);
    expect(heads).toEqual(["Recent", "Go to", "Create", "Actions", "Library"]);
    const rows = [...document.body.querySelectorAll('[data-test="cp-result"]')].map((r) => r.textContent?.trim());
    expect(rows[0]).toContain("Eyes");
    expect(rows.filter((r) => r?.includes("Eyes"))).toHaveLength(1);
  });

  it("remembers what it ran and lists it under Recent next time", async () => {
    localStorage.removeItem("wp-palette-recent");
    const items = [
      { id: "route:a", label: "Dashboard", kind: "route" as const, icon: "pi-home", run: vi.fn() },
      { id: "route:b", label: "Settings", kind: "route" as const, icon: "pi-cog", run: vi.fn() },
    ];
    wrap = mount(CommandPalette, { props: { open: true, items }, attachTo: document.body });
    (document.body.querySelectorAll('[data-test="cp-result"]')[1] as HTMLElement).click();
    expect(items[1].run).toHaveBeenCalled();
    await wrap.setProps({ open: false });
    await wrap.setProps({ open: true });
    const first = document.body.querySelector('[data-test="cp-group"]');
    expect(first?.textContent).toBe("Recent");
    expect(document.body.querySelector('[data-test="cp-result"]')?.textContent).toContain("Settings");
  });

  it("shows one ranked list without headings while searching", async () => {
    const items = [
      { id: "route:a", label: "Alpha page", kind: "route" as const, icon: "pi-home", run: vi.fn() },
      { id: "module:a", label: "Alpha", kind: "module" as const, icon: "pi-sparkles", run: vi.fn() },
    ];
    wrap = mount(CommandPalette, { props: { open: true, items }, attachTo: document.body });
    const input = document.body.querySelector('[data-test="cp-input"]') as HTMLInputElement;
    input.value = "alpha";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await wrap.vm.$nextTick();
    expect(document.body.querySelectorAll('[data-test="cp-group"]')).toHaveLength(0);
    expect(document.body.querySelectorAll('[data-test="cp-result"]')).toHaveLength(2);
  });
});
