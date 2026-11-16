import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ContextWidget from "./ContextWidget.vue";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 })));
});
afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
  vi.unstubAllGlobals();
});

const json = (extra: Record<string, unknown> = {}): string => JSON.stringify({ version: 1, modules: [], ...extra });

function menuItem(label: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')]
    .find((el) => el.textContent?.includes(label));
}

describe("ContextWidget Seed from", () => {
  it("is hidden with nothing upstream to pick", () => {
    const w = mount(ContextWidget, {
      props: { nodeId: 1, initialJson: json(), upstreamVars: [], onChange: () => {}, seedSources: { loop: false, rows: [] } },
    });
    expect(w.find('[data-test="seed-from"]').exists()).toBe(false);
    w.unmount();
  });

  it("reports the stored choice to the mount glue, Auto when absent", () => {
    const seen: string[] = [];
    const a = mount(ContextWidget, {
      props: { nodeId: 1, initialJson: json(), upstreamVars: [], onChange: () => {}, onSeedFrom: (v: string) => seen.push(v) },
    });
    const b = mount(ContextWidget, {
      props: { nodeId: 2, initialJson: json({ seed_from: "row:Hero" }), upstreamVars: [], onChange: () => {}, onSeedFrom: (v: string) => seen.push(v) },
    });
    expect(seen).toEqual(["auto", "row:Hero"]);
    a.unmount();
    b.unmount();
  });

  it("picks a WP Seeds row and writes it into the value", async () => {
    const changes: string[] = [];
    const w = mount(ContextWidget, {
      attachTo: document.body,
      props: {
        nodeId: 1, initialJson: json(), upstreamVars: [], onChange: (j: string) => changes.push(j),
        seedSources: { loop: true, rows: ["Hero", "Background"] },
      },
    });
    const chip = w.find('[data-test="seed-from"]');
    expect(chip.text()).toContain("Auto");
    await chip.trigger("click");
    await flushPromises();
    menuItem("Background")?.click();
    await flushPromises();
    expect(w.find('[data-test="seed-from"]').text()).toContain("Background");
    expect(JSON.parse(changes.at(-1) ?? "{}").seed_from).toBe("row:Background");
    w.unmount();
  });

  it("drops the key when set back to Auto", async () => {
    const changes: string[] = [];
    const w = mount(ContextWidget, {
      attachTo: document.body,
      props: {
        nodeId: 1, initialJson: json({ seed_from: "own" }), upstreamVars: [], onChange: (j: string) => changes.push(j),
        seedSources: { loop: true, rows: [] },
      },
    });
    await w.find('[data-test="seed-from"]').trigger("click");
    await flushPromises();
    menuItem("Auto")?.click();
    await flushPromises();
    expect("seed_from" in JSON.parse(changes.at(-1) ?? "{}")).toBe(false);
    w.unmount();
  });

  it("warns when the picked row is no longer upstream", () => {
    const w = mount(ContextWidget, {
      props: {
        nodeId: 1, initialJson: json({ seed_from: "row:Gone" }), upstreamVars: [], onChange: () => {},
        seedSources: { loop: true, rows: ["Hero"] },
      },
    });
    expect(w.find('[data-test="seed-from"]').classes()).toContain("wp-node-id__seed--missing");
    w.unmount();
  });
});
