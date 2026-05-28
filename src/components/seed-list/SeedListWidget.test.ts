import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import SeedListWidget from "./SeedListWidget.vue";
import { emptySeedListConfig } from "./types";

describe("SeedListWidget", () => {
  it("renders defaults — hash chip active, all three override switches off", () => {
    const w = mount(SeedListWidget, { props: { modelValue: emptySeedListConfig() } });
    expect(w.find('[data-test="seedlist-strategy-hash_index"]').classes()).toContain(
      "wp-seedlist__chip--active",
    );
    expect(w.find('[data-test="seedlist-strategy-sequential"]').classes()).not.toContain(
      "wp-seedlist__chip--active",
    );
    expect(w.find('[data-test="seedlist-override-seed-toggle"]').classes()).not.toContain(
      "wp-seedlist__switch--on",
    );
    expect(w.find('[data-test="seedlist-override-count-toggle"]').classes()).not.toContain(
      "wp-seedlist__switch--on",
    );
    expect(w.find('[data-test="seedlist-override-strategy-toggle"]').classes()).not.toContain(
      "wp-seedlist__switch--on",
    );
  });

  it("emits new strategy on chip click", async () => {
    const w = mount(SeedListWidget, { props: { modelValue: emptySeedListConfig() } });
    await w.find('[data-test="seedlist-strategy-sequential"]').trigger("click");
    const emitted = w.emitted("update:modelValue")?.[0]?.[0] as { strategy: string };
    expect(emitted.strategy).toBe("sequential");
  });

  it("skip emit when picking the already-active strategy", async () => {
    const w = mount(SeedListWidget, { props: { modelValue: emptySeedListConfig() } });
    await w.find('[data-test="seedlist-strategy-hash_index"]').trigger("click");
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });

  it("emits override_seed toggle on switch click", async () => {
    const w = mount(SeedListWidget, { props: { modelValue: emptySeedListConfig() } });
    await w.find('[data-test="seedlist-override-seed-toggle"]').trigger("click");
    const emitted = w.emitted("update:modelValue")?.[0]?.[0] as { override_seed: boolean };
    expect(emitted.override_seed).toBe(true);
  });

  it("emits override_count toggle on switch click", async () => {
    const w = mount(SeedListWidget, { props: { modelValue: emptySeedListConfig() } });
    await w.find('[data-test="seedlist-override-count-toggle"]').trigger("click");
    const emitted = w.emitted("update:modelValue")?.[0]?.[0] as { override_count: boolean };
    expect(emitted.override_count).toBe(true);
  });

  it("emits override_strategy toggle on switch click", async () => {
    const w = mount(SeedListWidget, { props: { modelValue: emptySeedListConfig() } });
    await w.find('[data-test="seedlist-override-strategy-toggle"]').trigger("click");
    const emitted = w.emitted("update:modelValue")?.[0]?.[0] as { override_strategy: boolean };
    expect(emitted.override_strategy).toBe(true);
  });

  it("preserves other config fields when toggling override_seed", async () => {
    const w = mount(SeedListWidget, {
      props: {
        modelValue: {
          ...emptySeedListConfig(),
          strategy: "prime_stride",
          override_count: true,
          override_strategy: true,
        },
      },
    });
    await w.find('[data-test="seedlist-override-seed-toggle"]').trigger("click");
    const emitted = w.emitted("update:modelValue")?.[0]?.[0] as {
      strategy: string;
      override_seed: boolean;
      override_count: boolean;
      override_strategy: boolean;
    };
    expect(emitted.strategy).toBe("prime_stride");
    expect(emitted.override_seed).toBe(true);
    expect(emitted.override_count).toBe(true);
    expect(emitted.override_strategy).toBe(true);
  });

  it("dims fully when node is muted (mode 2)", () => {
    const w = mount(SeedListWidget, {
      props: { modelValue: emptySeedListConfig(), nodeMode: 2 },
    });
    expect(w.classes()).toContain("wp-seedlist--muted");
  });

  it("dims partially when node is bypassed (mode 4)", () => {
    const w = mount(SeedListWidget, {
      props: { modelValue: emptySeedListConfig(), nodeMode: 4 },
    });
    expect(w.classes()).toContain("wp-seedlist--bypassed");
  });

  it("active chip reflects model value", () => {
    const w = mount(SeedListWidget, {
      props: { modelValue: { ...emptySeedListConfig(), strategy: "prime_stride" } },
    });
    expect(w.find('[data-test="seedlist-strategy-prime_stride"]').classes()).toContain(
      "wp-seedlist__chip--active",
    );
    expect(w.find('[data-test="seedlist-strategy-hash_index"]').classes()).not.toContain(
      "wp-seedlist__chip--active",
    );
  });

  it("locks strategy chips when override_strategy is on", () => {
    const w = mount(SeedListWidget, {
      props: { modelValue: { ...emptySeedListConfig(), override_strategy: true } },
    });
    // Wrapper gets the dim class.
    expect(w.find(".wp-seedlist__chips").classes()).toContain("wp-seedlist__chips--locked");
    // Every chip carries the disabled HTML attr (which is what actually
    // blocks click events — pointer-events:none would kill the hover
    // tooltip + cursor change).
    for (const id of ["hash_index", "sequential", "prime_stride"] as const) {
      const btn = w.find(`[data-test="seedlist-strategy-${id}"]`);
      expect(btn.attributes("disabled")).toBeDefined();
    }
  });

  it("does NOT lock strategy chips when only override_count is on", () => {
    // The toggles are independent — count being overridden shouldn't
    // dim strategy chips.
    const w = mount(SeedListWidget, {
      props: { modelValue: { ...emptySeedListConfig(), override_count: true } },
    });
    expect(w.find(".wp-seedlist__chips").classes()).not.toContain("wp-seedlist__chips--locked");
    expect(
      w.find('[data-test="seedlist-strategy-hash_index"]').attributes("disabled"),
    ).toBeUndefined();
  });

  it("skip strategy emit while locked by override_strategy", async () => {
    const w = mount(SeedListWidget, {
      props: { modelValue: { ...emptySeedListConfig(), override_strategy: true } },
    });
    await w.find('[data-test="seedlist-strategy-sequential"]').trigger("click");
    expect(w.emitted("update:modelValue")).toBeUndefined();
  });
});
