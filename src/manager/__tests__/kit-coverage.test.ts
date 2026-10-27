import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import Kit from "../views/Kit.vue";
import { KIT_ENTRIES, KIT_EXEMPT, KIT_FOLDERS, KIT_GROUPS } from "../kit/registry";

const ROOT = resolve(__dirname, "../../..");

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
});

describe("component kit registry", () => {
  it("lists every component in a kit folder, or says why not", () => {
    const listed = new Set([...KIT_ENTRIES.map((e) => e.file), ...Object.keys(KIT_EXEMPT)]);
    const missing: string[] = [];
    for (const folder of KIT_FOLDERS) {
      for (const name of readdirSync(join(ROOT, folder))) {
        if (!name.endsWith(".vue")) continue;
        const file = `${folder}/${name}`;
        if (!listed.has(file)) missing.push(file);
      }
    }
    expect(missing, "Add these to KIT_ENTRIES (src/manager/kit/registry.ts) with a demo on the kit page").toEqual([]);
  });

  it("points every entry and exemption at a file that exists", () => {
    const gone = [...KIT_ENTRIES.map((e) => e.file), ...Object.keys(KIT_EXEMPT)].filter((f) => !existsSync(join(ROOT, f)));
    expect(gone).toEqual([]);
  });

  it("has unique ids, a known group and text for every entry", () => {
    const ids = KIT_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(KIT_GROUPS.map((g) => g.id));
    for (const e of KIT_ENTRIES) {
      expect(groups.has(e.group), e.id).toBe(true);
      expect(e.use.length, e.id).toBeGreaterThan(20);
      expect(e.surfaces.length, e.id).toBeGreaterThan(0);
    }
  });
});

describe("Kit.vue", () => {
  it("shows every entry, and a live demo for each one the manager can show", () => {
    const wrap = mount(Kit, { attachTo: document.body });
    for (const e of KIT_ENTRIES) {
      const card = wrap.find(`[data-kit-entry="${e.id}"]`);
      expect(card.exists(), e.id).toBe(true);
      const canvasOnly = card.find('[data-test="kit-canvas-only"]').exists();
      expect(canvasOnly, `${e.id}: ${canvasOnly ? "has no demo" : "is canvas only but has a demo"}`).toBe(
        !e.surfaces.includes("manager"),
      );
    }
    wrap.unmount();
  });

  it("filters the sample list with ListFilter", async () => {
    const wrap = mount(Kit);
    const box = wrap.find('[data-test="kit-filter-search"]');
    await box.setValue("mood");
    expect(wrap.find('[data-kit-entry="list-filter"]').findAll("li")).toHaveLength(2);
    wrap.unmount();
  });
});
