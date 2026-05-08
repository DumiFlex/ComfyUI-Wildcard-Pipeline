// Combine RuntimeSection — mirrors wildcard's RuntimeSection 1:1 except
// the lock toggle reads "Lock seed" instead of "Lock pick" because
// combine doesn't pick options, it resolves inline alternations against
// a derived RNG. Behaviour is otherwise identical (lock on/off,
// remembered seed restore, seed input + roll + spinner, hide flip).

import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import RuntimeSection from "./RuntimeSection.vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "ab12cd34",
    type: "combine",
    enabled: true,
    meta: { name: "final_prompt" },
    entries: [],
    payload: { output_var: "final_prompt", template: "$style portrait" },
    instance: {},
    ...overrides,
  };
}

function lastPatch(w: ReturnType<typeof mount>): Partial<ModuleEntry> {
  const updates = w.emitted("update")! as unknown[][];
  return updates[updates.length - 1][0] as Partial<ModuleEntry>;
}

describe("combine RuntimeSection", () => {
  it("renders lock + hide toggles with 'Lock seed' label", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    const lock = w.find('[data-test="runtime-lock"]');
    expect(lock.exists()).toBe(true);
    expect(lock.text()).toContain("Lock seed");
    expect(w.find('[data-test="runtime-hide"]').exists()).toBe(true);
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
