import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import RuntimeSection from "./RuntimeSection.vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";

function makeModule(overrides: Partial<ModuleEntry> = {}): ModuleEntry {
  return {
    id: "ab12cd34",
    type: "wildcard",
    enabled: true,
    meta: { name: "outfit" },
    entries: [],
    payload: { var_binding: "outfit", options: [] },
    instance: {},
    ...overrides,
  };
}

function lastPatch(w: ReturnType<typeof mount>): Partial<ModuleEntry> {
  const updates = w.emitted("update")! as unknown[][];
  return updates[updates.length - 1][0] as Partial<ModuleEntry>;
}

describe("RuntimeSection", () => {
  it("renders lock and hide toggles", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    expect(w.find('[data-test="runtime-lock"]').exists()).toBe(true);
    expect(w.find('[data-test="runtime-hide"]').exists()).toBe(true);
  });

  it("seed input is hidden when not locked", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    expect(w.find('[data-test="runtime-seed"]').exists()).toBe(false);
  });

  it("seed input is visible when locked_seed is set", () => {
    const w = mount(RuntimeSection, {
      props: { module: makeModule({ instance: { locked_seed: 12345 } }) },
    });
    const input = w.find<HTMLInputElement>('[data-test="runtime-seed"]').element;
    expect(input.value).toBe("12345");
  });

  it("lock toggle on (when off) emits patch with locked_seed = _ui.last_locked_seed if present", async () => {
    const w = mount(RuntimeSection, {
      props: {
        module: makeModule({ instance: { _ui: { last_locked_seed: 9999 } } }),
      },
    });
    await w.find('[data-test="runtime-lock"]').trigger("click");
    expect(lastPatch(w).instance?.locked_seed).toBe(9999);
  });

  it("lock toggle on (no last_locked_seed) emits patch with a random integer seed", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    await w.find('[data-test="runtime-lock"]').trigger("click");
    const patch = lastPatch(w);
    expect(typeof patch.instance?.locked_seed).toBe("number");
    expect(Number.isInteger(patch.instance?.locked_seed)).toBe(true);
    vi.restoreAllMocks();
  });

  it("lock toggle off emits patch with locked_seed=null and preserves _ui.last_locked_seed", async () => {
    const w = mount(RuntimeSection, {
      props: {
        module: makeModule({
          instance: { locked_seed: 12345, _ui: { last_locked_seed: 9999 } },
        }),
      },
    });
    await w.find('[data-test="runtime-lock"]').trigger("click");
    const patch = lastPatch(w);
    expect(patch.instance?.locked_seed).toBeNull();
    expect(patch.instance?._ui?.last_locked_seed).toBe(9999);
  });

  it("changing the seed input emits patch + updates _ui.last_locked_seed", async () => {
    const w = mount(RuntimeSection, {
      props: { module: makeModule({ instance: { locked_seed: 12345 } }) },
    });
    const input = w.find<HTMLInputElement>('[data-test="runtime-seed"]');
    input.element.value = "67890";
    await input.trigger("input");
    const patch = lastPatch(w);
    expect(patch.instance?.locked_seed).toBe(67890);
    expect(patch.instance?._ui?.last_locked_seed).toBe(67890);
  });

  it("roll button regenerates seed (random) and emits patch", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.42);
    const w = mount(RuntimeSection, {
      props: { module: makeModule({ instance: { locked_seed: 12345 } }) },
    });
    await w.find('[data-test="runtime-roll"]').trigger("click");
    const patch = lastPatch(w);
    expect(patch.instance?.locked_seed).not.toBe(12345);
    expect(typeof patch.instance?.locked_seed).toBe("number");
    vi.restoreAllMocks();
  });

  it("hide toggle on emits patch with internal=true", async () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    await w.find('[data-test="runtime-hide"]').trigger("click");
    expect(lastPatch(w).instance?.internal).toBe(true);
  });

  it("hide toggle off emits patch with internal=false (or null)", async () => {
    const w = mount(RuntimeSection, {
      props: { module: makeModule({ instance: { internal: true } }) },
    });
    await w.find('[data-test="runtime-hide"]').trigger("click");
    const patch = lastPatch(w);
    expect(patch.instance?.internal === false || patch.instance?.internal === null).toBe(true);
  });

  it("seed up button bumps locked_seed by +1 and updates _ui.last_locked_seed", async () => {
    const w = mount(RuntimeSection, {
      props: { module: makeModule({ instance: { locked_seed: 12345 } }) },
    });
    await w.find('[data-test="runtime-seed-up"]').trigger("click");
    const patch = lastPatch(w);
    expect(patch.instance?.locked_seed).toBe(12346);
    expect(patch.instance?._ui?.last_locked_seed).toBe(12346);
  });

  it("seed down button bumps locked_seed by -1", async () => {
    const w = mount(RuntimeSection, {
      props: { module: makeModule({ instance: { locked_seed: 12345 } }) },
    });
    await w.find('[data-test="runtime-seed-down"]').trigger("click");
    expect(lastPatch(w).instance?.locked_seed).toBe(12344);
  });

  it("seed down clamps at 0 (no negative seeds)", async () => {
    const w = mount(RuntimeSection, {
      props: { module: makeModule({ instance: { locked_seed: 0 } }) },
    });
    await w.find('[data-test="runtime-seed-down"]').trigger("click");
    expect(lastPatch(w).instance?.locked_seed).toBe(0);
  });

  it("seed spinner buttons are not rendered when not locked", () => {
    const w = mount(RuntimeSection, { props: { module: makeModule() } });
    expect(w.find('[data-test="runtime-seed-up"]').exists()).toBe(false);
    expect(w.find('[data-test="runtime-seed-down"]').exists()).toBe(false);
  });

  it("seed up button preserves large ComfyUI seeds (>2^31) instead of clamping", async () => {
    // Regression: bump-up on 728_451_244_582_250 used to clamp to
    // 0x7fffffff because the cap was 32-bit. ComfyUI seeds reach into
    // 2^53 — keep the full safe-integer range round-trippable.
    const w = mount(RuntimeSection, {
      props: { module: makeModule({ instance: { locked_seed: 728_451_244_582_250 } }) },
    });
    await w.find('[data-test="runtime-seed-up"]').trigger("click");
    expect(lastPatch(w).instance?.locked_seed).toBe(728_451_244_582_251);
  });

  it("seed up clamps at Number.MAX_SAFE_INTEGER", async () => {
    const w = mount(RuntimeSection, {
      props: { module: makeModule({ instance: { locked_seed: Number.MAX_SAFE_INTEGER } }) },
    });
    await w.find('[data-test="runtime-seed-up"]').trigger("click");
    expect(lastPatch(w).instance?.locked_seed).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("roll button generates a seed inside the safe-integer range", async () => {
    const w = mount(RuntimeSection, {
      props: { module: makeModule({ instance: { locked_seed: 12345 } }) },
    });
    await w.find('[data-test="runtime-roll"]').trigger("click");
    const seed = lastPatch(w).instance?.locked_seed;
    expect(typeof seed).toBe("number");
    expect(Number.isSafeInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });
});
