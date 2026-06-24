import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import RuntimeSection from "./RuntimeSection.vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "fv012345",
    type: "fixed_values",
    enabled: true,
    meta: { name: "presets" },
    entries: [],
    payload: { values: [] },
    instance: {},
    ...overrides,
  };
}

function lastPatch(w: ReturnType<typeof mount>): Partial<ModuleEntry> {
  const updates = w.emitted("update")! as unknown[][];
  return updates[updates.length - 1][0] as Partial<ModuleEntry>;
}

describe("fixed-values RuntimeSection", () => {
  it("renders Hide-from-prompt toggle", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    expect(w.find('[data-test="runtime-hide"]').exists()).toBe(true);
  });

  it("toggle off → click → emits internal=true", async () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    await w.find('[data-test="runtime-hide"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.internal).toBe(true);
  });

  it("toggle on → click → emits internal=false", async () => {
    const w = mount(RuntimeSection, {
      props: { module: makeModule({ instance: { internal: true } }) },
    });
    await w.find('[data-test="runtime-hide"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(patch.instance?.internal).toBe(false);
  });

  it("toggle reflects internal=true with --on class + aria-checked", () => {
    const w = mount(RuntimeSection, {
      props: { module: makeModule({ instance: { internal: true } }) },
    });
    const btn = w.find('[data-test="runtime-hide"]');
    expect(btn.classes()).toContain("toggle--on");
    expect(btn.attributes("aria-checked")).toBe("true");
  });

  // ── Lock seed (added in 2026-05-08 syntax-parity cycle) ─────────────
  // fixed_values now resolves `{a|b|c}` per value, so it gains seed-lock
  // parity with wildcard + combine. RuntimeSection copies the combine
  // RuntimeSection 1:1 — same Lock seed UX (toggle, seed input, roll
  // button, ±1 spinner, _ui memory).

  it("renders Lock seed + Hide toggles together", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    const lock = w.find('[data-test="runtime-lock"]');
    expect(lock.exists()).toBe(true);
    expect(lock.text()).toContain("Lock seed");
    expect(w.find('[data-test="runtime-hide"]').exists()).toBe(true);
  });

  it("Lock toggle off → click → emits a numeric locked_seed", async () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    await w.find('[data-test="runtime-lock"]').trigger("click");
    const updates = w.emitted("update")!;
    const patch = updates[updates.length - 1][0] as Partial<ModuleEntry>;
    expect(typeof patch.instance?.locked_seed).toBe("number");
    expect(Number.isInteger(patch.instance?.locked_seed)).toBe(true);
  });

  it("seed input visible only when locked_seed is set", () => {
    const off = mount(RuntimeSection, { props: { module: makeModule() } });
    expect(off.find('[data-test="runtime-seed"]').exists()).toBe(false);
    const on = mount(RuntimeSection, {
      props: { module: makeModule({ instance: { locked_seed: 42 } }) },
    });
    expect(on.find('[data-test="runtime-seed"]').exists()).toBe(true);
  });

  it("seed-scope toggle is off (vary) by default", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    expect(w.find('[data-test="runtime-hold"]').classes()).not.toContain("toggle--on");
  });

  it("clicking seed-scope toggle emits patch with seed_scope = hold", async () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    await w.find('[data-test="runtime-hold"]').trigger("click");
    expect(lastPatch(w).instance?.seed_scope).toBe("hold");
  });

  it("clicking seed-scope toggle when held emits seed_scope = vary", async () => {
    const w = mount(RuntimeSection, { props: { module: makeModule({ instance: { seed_scope: "hold" } }) } });
    await w.find('[data-test="runtime-hold"]').trigger("click");
    expect(lastPatch(w).instance?.seed_scope).toBe("vary");
  });
});
