import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import RefChip from "./RefChip.vue";

describe("RefChip", () => {
  it("renders var kind with $name + green palette", () => {
    const wrap = mount(RefChip, {
      props: { kind: "var", name: "person", resolved: true },
    });
    expect(wrap.text()).toContain("$person");
    expect(wrap.classes()).toContain("wp-refchip");
    expect(wrap.classes()).toContain("wp-refchip--var");
    expect(wrap.classes()).not.toContain("wp-refchip--unresolved");
  });

  it("renders ref kind with @name + purple palette", () => {
    const wrap = mount(RefChip, {
      props: { kind: "ref", name: "color", uuid: "aabbccdd", resolved: true },
    });
    expect(wrap.text()).toContain("@color");
    expect(wrap.classes()).toContain("wp-refchip--ref");
  });

  it("renders sub-category suffix when present", () => {
    const wrap = mount(RefChip, {
      props: {
        kind: "ref", name: "color", uuid: "aabbccdd", resolved: true,
        subCategories: ["warm", "cool"],
      },
    });
    expect(wrap.text()).toMatch(/@color.*warm.*cool/);
    expect(wrap.classes()).toContain("wp-refchip--filtered");
  });

  it("renders unresolved ref as red ? chip with uuid visible", () => {
    const wrap = mount(RefChip, {
      props: { kind: "ref", name: "", uuid: "deadbeef", resolved: false },
    });
    expect(wrap.text()).toContain("?");
    expect(wrap.text()).toContain("deadbeef");
    expect(wrap.classes()).toContain("wp-refchip--unresolved");
  });

  it("emits click on ref-kind chip body", async () => {
    const wrap = mount(RefChip, {
      props: { kind: "ref", name: "color", uuid: "aabbccdd", resolved: true },
    });
    await wrap.trigger("click");
    expect(wrap.emitted("click")).toBeTruthy();
  });

  it("var-kind chip does not emit click on click (no edit affordance)", async () => {
    const wrap = mount(RefChip, {
      props: { kind: "var", name: "person", resolved: true },
    });
    await wrap.trigger("click");
    expect(wrap.emitted("click")).toBeFalsy();
  });

  it("renders reserved `null` sub-cat keyword as `!null` to signal negation", () => {
    // The reserved `"null"` token in a nested-ref filter EXCLUDES the
    // wildcard's null option (2026-05-25 inverted semantic). Rendering
    // it as `!null` lets the user read the negation at a glance instead
    // of mistaking it for a sub-cat selection.
    const wrap = mount(RefChip, {
      props: {
        kind: "ref", name: "color", uuid: "aabbccdd", resolved: true,
        subCategories: ["warm", "null"],
      },
    });
    const suffix = wrap.find(".wp-refchip__suffix");
    expect(suffix.exists()).toBe(true);
    expect(suffix.text()).toContain("warm");
    expect(suffix.text()).toContain("!null");
    expect(suffix.text()).not.toMatch(/[^!]null/);
  });

  // ── kind-aware (moduleKind prop) ───────────────────────────────────
  // The `moduleKind` prop drives the chip's color via the `--wp-refchip-tone`
  // CSS custom property AND swaps the leading ✦ glyph for the matching
  // PrimeIcon from `KIND_ICON_MAP`. Unresolved chips stay red regardless.
  // Var chips ignore the prop entirely.

  it("default ref kind (no moduleKind) keeps legacy wildcard styling", () => {
    const wrap = mount(RefChip, {
      props: { kind: "ref", name: "color", uuid: "aabbccdd", resolved: true },
    });
    const chip = wrap.find(".wp-refchip");
    // No `--kinded` modifier class, no inline tone — falls back to the
    // legacy `var(--wp-kind-wildcard)` via the CSS rule's fallback
    // inside `color-mix`.
    // No kind-aware inline tone — relies on the legacy fallback.
    expect(chip.attributes("style") ?? "").not.toContain("--wp-refchip-tone");
    // Glyph stays as the unicode ✦ — no PrimeIcon variant.
    expect(wrap.find(".wp-refchip__icon--pi").exists()).toBe(false);
  });

  it("moduleKind=wildcard explicitly is treated as default (no kind-aware styling)", () => {
    // Wildcard is the legacy default — we don't want a redundant
    // inline style or modifier class when the prop matches the default.
    const wrap = mount(RefChip, {
      props: { kind: "ref", name: "color", uuid: "aabbccdd", resolved: true, moduleKind: "wildcard" },
    });
    // No kind-aware inline tone — relies on the legacy CSS fallback.
    expect(wrap.find(".wp-refchip").attributes("style") ?? "").not.toContain("--wp-refchip-tone");
    expect(wrap.find(".wp-refchip__icon--pi").exists()).toBe(false);
  });

  const KIND_CASES: Array<{ kind: "fixed_values" | "combine" | "derivation" | "constraint" | "bundle"; toneVar: string; iconCls: string }> = [
    { kind: "fixed_values", toneVar: "var(--wp-kind-fixed)",      iconCls: "pi-tag" },
    { kind: "combine",      toneVar: "var(--wp-kind-combine)",    iconCls: "pi-link" },
    { kind: "derivation",   toneVar: "var(--wp-kind-derivation)", iconCls: "pi-arrow-right-arrow-left" },
    { kind: "constraint",   toneVar: "var(--wp-kind-constraint)", iconCls: "pi-filter" },
    { kind: "bundle",       toneVar: "var(--wp-text-muted)",      iconCls: "pi-box" },
  ];
  for (const { kind, toneVar, iconCls } of KIND_CASES) {
    it(`moduleKind=${kind} applies its tone variable + matching PrimeIcon`, () => {
      const wrap = mount(RefChip, {
        props: { kind: "ref", name: "n", uuid: "aabbccdd", resolved: true, moduleKind: kind },
      });
      const chip = wrap.find(".wp-refchip");
      // Kind-aware tone is applied as an inline `--wp-refchip-tone`
      // custom property — the CSS rule reads that with a fallback to
      // `--wp-kind-wildcard`, so per-kind palette doesn't need a
      // class-per-kind cascade.
      const style = chip.attributes("style") ?? "";
      expect(style).toContain("--wp-refchip-tone");
      expect(style).toContain(toneVar);
      // Icon swapped from the unicode ✦ to the matching PrimeIcon.
      const iconEl = wrap.find(".wp-refchip__icon--pi");
      expect(iconEl.exists()).toBe(true);
      expect(iconEl.classes()).toContain(iconCls);
    });
  }

  it("unresolved ref with moduleKind still renders as red `?` chip (kind ignored)", () => {
    // The whole point of the unresolved chip is to flag "this id doesn't
    // resolve" — kind data is irrelevant then. Stays in the danger palette
    // with the `?` glyph regardless of moduleKind.
    const wrap = mount(RefChip, {
      props: { kind: "ref", name: "", uuid: "deadbeef", resolved: false, moduleKind: "constraint" },
    });
    expect(wrap.classes()).toContain("wp-refchip--unresolved");
    expect(wrap.find(".wp-refchip").attributes("style") ?? "").not.toContain("--wp-refchip-tone");
    expect(wrap.text()).toContain("?");
    expect(wrap.text()).toContain("deadbeef");
    // No PrimeIcon variant — the `?` glyph wins.
    expect(wrap.find(".wp-refchip__icon--pi").exists()).toBe(false);
  });

  it("var chip ignores moduleKind entirely (always green)", () => {
    const wrap = mount(RefChip, {
      props: { kind: "var", name: "person", resolved: true, moduleKind: "constraint" },
    });
    expect(wrap.classes()).toContain("wp-refchip--var");
    // No kind-aware tone on var chips — moduleKind doesn't apply.
    expect(wrap.find(".wp-refchip").attributes("style") ?? "").not.toContain("--wp-refchip-tone");
    // The unicode `⌘` glyph variant — no PrimeIcon swap.
    expect(wrap.find(".wp-refchip__icon--pi").exists()).toBe(false);
  });
});
