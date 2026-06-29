// Derivation RuntimeSection — mirrors combine's RuntimeSection 1:1.
// Both kinds resolve `{a|b|c}` inline alternations in their value
// fields (combine.template / derivation.action.value), so the same
// Lock seed UX applies. Engine derivation handler honors locked_seed
// via derive_module_rng — same pattern combine + fixed_values use.

import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import RuntimeSection from "./RuntimeSection.vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "dv012345",
    type: "derivation",
    enabled: true,
    meta: { name: "mood-rules" },
    entries: [],
    payload: { rules: [] },
    instance: {},
    ...overrides,
  };
}

function lastPatch(w: ReturnType<typeof mount>): Partial<ModuleEntry> {
  const updates = w.emitted("update")! as unknown[][];
  return updates[updates.length - 1][0] as Partial<ModuleEntry>;
}

describe("derivation RuntimeSection", () => {
  it("renders lock + hide toggles with 'Lock seed' label", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    const lock = w.find('[data-test="runtime-lock"]');
    expect(lock.exists()).toBe(true);
    expect(lock.text()).toContain("Lock seed");
    expect(w.find('[data-test="runtime-hide"]').exists()).toBe(true);
  });

  it("renders the Hold across run toggle, off by default", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    const hold = w.find('[data-test="runtime-hold"]');
    expect(hold.exists()).toBe(true);
    expect(hold.text()).toContain("Hold across run");
    expect(hold.classes()).not.toContain("toggle--on");
  });

  it("Hold toggle reflects seed_scope=hold as on", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule({ instance: { seed_scope: "hold" } }) } });
    expect(w.find('[data-test="runtime-hold"]').classes()).toContain("toggle--on");
  });

  it("clicking Hold emits seed_scope = hold; clicking when held emits vary", async () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    await w.find('[data-test="runtime-hold"]').trigger("click");
    expect(lastPatch(w).instance?.seed_scope).toBe("hold");
    const held = mount(RuntimeSection, { props: { module: makeModule({ instance: { seed_scope: "hold" } }) } });
    await held.find('[data-test="runtime-hold"]').trigger("click");
    expect(lastPatch(held).instance?.seed_scope).toBe("vary");
  });

  it("Hold toggle is disabled while a loop edit-frame is active", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule(), frameActive: true } });
    expect(w.find('[data-test="runtime-hold"]').attributes("disabled")).toBeDefined();
  });

  it("seed input hidden when not locked", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    expect(w.find('[data-test="runtime-seed"]').exists()).toBe(false);
  });

  it("seed input visible when locked_seed is set", () => {
    const w = mount(RuntimeSection, {
      props: { module: makeModule({ instance: { locked_seed: 4242 } }) },
    });
    const input = w.find<HTMLInputElement>('[data-test="runtime-seed"]').element;
    expect(input.value).toBe("4242");
  });

  it("lock toggle on (no remembered seed) emits a random integer locked_seed", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    await w.find('[data-test="runtime-lock"]').trigger("click");
    const patch = lastPatch(w);
    expect(typeof patch.instance?.locked_seed).toBe("number");
    expect(Number.isInteger(patch.instance?.locked_seed)).toBe(true);
    vi.restoreAllMocks();
  });

  it("lock toggle on (with remembered seed) restores _ui.last_locked_seed", async () => {
    const w = mount(RuntimeSection, {
      props: {
        module: makeModule({ instance: { _ui: { last_locked_seed: 9999 } } }),
      },
    });
    await w.find('[data-test="runtime-lock"]').trigger("click");
    expect(lastPatch(w).instance?.locked_seed).toBe(9999);
  });

  it("lock toggle off emits null + preserves _ui.last_locked_seed", async () => {
    const w = mount(RuntimeSection, {
      props: {
        module: makeModule({
          instance: { locked_seed: 4242, _ui: { last_locked_seed: 4242 } },
        }),
      },
    });
    await w.find('[data-test="runtime-lock"]').trigger("click");
    const patch = lastPatch(w);
    expect(patch.instance?.locked_seed).toBeNull();
    expect(patch.instance?._ui?.last_locked_seed).toBe(4242);
  });

  it("typing in seed input emits locked_seed + updates _ui.last_locked_seed", async () => {
    const w = mount(RuntimeSection, {
      props: { module: makeModule({ instance: { locked_seed: 100 } }) },
    });
    const input = w.find<HTMLInputElement>('[data-test="runtime-seed"]');
    input.element.value = "55555";
    await input.trigger("input");
    const patch = lastPatch(w);
    expect(patch.instance?.locked_seed).toBe(55555);
    expect(patch.instance?._ui?.last_locked_seed).toBe(55555);
  });

  it("roll button regenerates seed", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.7);
    const w = mount(RuntimeSection, {
      props: { module: makeModule({ instance: { locked_seed: 100 } }) },
    });
    await w.find('[data-test="runtime-roll"]').trigger("click");
    const seed = lastPatch(w).instance?.locked_seed;
    expect(typeof seed).toBe("number");
    expect(seed).not.toBe(100);
    vi.restoreAllMocks();
  });

  it("hide toggle flips internal flag", async () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    await w.find('[data-test="runtime-hide"]').trigger("click");
    expect(lastPatch(w).instance?.internal).toBe(true);
  });
});
