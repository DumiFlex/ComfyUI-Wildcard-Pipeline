import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import RefChip from "../RefChip.vue";

describe("RefChip filter indicator", () => {
  it("shows a funnel + hover title with the expression, not inline text", () => {
    const w = mount(RefChip, { props: { kind: "ref", name: "colors", uuid: "aabbccdd", resolved: true, expr: "warm or cold", excludeNull: true } });
    expect(w.find('[data-test="refchip-filter"]').exists()).toBe(true);
    expect(w.text()).not.toContain("warm or cold");          // not inline
    expect(w.attributes("title")).toContain("warm or cold");  // on hover
    expect(w.attributes("title")).toMatch(/null/);
  });

  it("normalizes the expression in the hover title (reads-as)", () => {
    // `warm,cold` (comma shorthand) reads as `warm or cold`.
    const w = mount(RefChip, {
      props: { kind: "ref", name: "c", uuid: "aabbccdd", resolved: true, expr: "warm,cold" },
    });
    expect(w.attributes("title")).toContain("warm or cold");
    expect(w.find('[data-test="refchip-filter"]').exists()).toBe(true);
    expect(w.classes()).toContain("wp-refchip--filtered");
  });

  it("renders a funnel for exclude-null only (no expression)", () => {
    const w = mount(RefChip, {
      props: { kind: "ref", name: "c", uuid: "aabbccdd", resolved: true, excludeNull: true },
    });
    expect(w.find('[data-test="refchip-filter"]').exists()).toBe(true);
    expect(w.attributes("title")).toMatch(/null excluded/);
  });

  it("shows no filter indicator for an unfiltered ref", () => {
    const w = mount(RefChip, {
      props: { kind: "ref", name: "c", uuid: "aabbccdd", resolved: true },
    });
    expect(w.find('[data-test="refchip-filter"]').exists()).toBe(false);
    expect(w.attributes("title")).toBeUndefined();
    expect(w.classes()).not.toContain("wp-refchip--filtered");
  });

  it("derives the funnel + title from the deprecated subCategories fallback", () => {
    // Pre-SP1 callers pass a flat list (comma = OR); a trailing `null`
    // token maps to exclude-null. Kept compiling + non-regressed until
    // those callers migrate to `expr` / `excludeNull`.
    const w = mount(RefChip, {
      props: {
        kind: "ref", name: "color", uuid: "aabbccdd", resolved: true,
        subCategories: ["warm", "cool", "null"],
      },
    });
    expect(w.find('[data-test="refchip-filter"]').exists()).toBe(true);
    expect(w.text()).not.toContain("warm");                  // not inline
    expect(w.attributes("title")).toContain("warm or cool");  // reads-as
    expect(w.attributes("title")).toMatch(/null excluded/);
  });

  it("peels a glued !null marker out of the subCategories fallback", () => {
    // The widget lexer comma-splits a v2 ref body WITHOUT peeling, so a
    // single-element list like ["warm or intense!null"] reaches this legacy
    // prop glued. RefChip must peel it — never show `!null` as text, surface
    // the exclude-null ban, and normalize the expression in the title.
    const w = mount(RefChip, {
      props: {
        kind: "ref", name: "mood", uuid: "aabbccdd", resolved: true,
        subCategories: ["warm or intense!null"],
      },
    });
    expect(w.find('[data-test="refchip-filter"]').exists()).toBe(true);
    expect(w.text()).not.toContain("!null");                    // never inline
    expect(w.attributes("title")).toContain("warm or intense");  // reads-as
    expect(w.attributes("title")).not.toContain("!null");        // peeled in title too
    expect(w.attributes("title")).toMatch(/null excluded/);      // ban semantics
  });
});

describe("RefChip base rendering", () => {
  it("renders var kind with $name + green palette", () => {
    const wrap = mount(RefChip, {
      props: { kind: "var", name: "person", resolved: true },
    });
    expect(wrap.text()).toContain("$person");
    expect(wrap.classes()).toContain("wp-refchip");
    expect(wrap.classes()).toContain("wp-refchip--var");
    expect(wrap.classes()).not.toContain("wp-refchip--unresolved");
  });

  it("renders a var chip's .K list accessor as a single chip (SP2a)", () => {
    const wrap = mount(RefChip, {
      props: { kind: "var", name: "colors", index: 0, resolved: true },
    });
    expect(wrap.text()).toContain("$colors.0");
  });

  it("a ref chip ignores the index prop (no .K on refs)", () => {
    const wrap = mount(RefChip, {
      props: { kind: "ref", name: "color", uuid: "aabbccdd", resolved: true, index: 2 },
    });
    expect(wrap.text()).toContain("@color");
    expect(wrap.text()).not.toContain(".2");
  });

  it("renders ref kind with @name + purple palette", () => {
    const wrap = mount(RefChip, {
      props: { kind: "ref", name: "color", uuid: "aabbccdd", resolved: true },
    });
    expect(wrap.text()).toContain("@color");
    expect(wrap.classes()).toContain("wp-refchip--ref");
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
});

// ── kind-aware (moduleKind prop) ───────────────────────────────────
// The `moduleKind` prop drives the chip's color via the `--wp-refchip-tone`
// CSS custom property AND swaps the leading ✦ glyph for the matching
// PrimeIcon from `KIND_ICON_MAP`. Unresolved chips stay red regardless.
// Var chips ignore the prop entirely.
describe("RefChip moduleKind", () => {
  it("default ref kind (no moduleKind) keeps legacy wildcard styling", () => {
    const wrap = mount(RefChip, {
      props: { kind: "ref", name: "color", uuid: "aabbccdd", resolved: true },
    });
    const chip = wrap.find(".wp-refchip");
    expect(chip.attributes("style") ?? "").not.toContain("--wp-refchip-tone");
    expect(wrap.find(".wp-refchip__icon--pi").exists()).toBe(false);
  });

  it("moduleKind=wildcard explicitly is treated as default (no kind-aware styling)", () => {
    const wrap = mount(RefChip, {
      props: { kind: "ref", name: "color", uuid: "aabbccdd", resolved: true, moduleKind: "wildcard" },
    });
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
      const style = chip.attributes("style") ?? "";
      expect(style).toContain("--wp-refchip-tone");
      expect(style).toContain(toneVar);
      const iconEl = wrap.find(".wp-refchip__icon--pi");
      expect(iconEl.exists()).toBe(true);
      expect(iconEl.classes()).toContain(iconCls);
    });
  }

  it("unresolved ref with moduleKind still renders as red `?` chip (kind ignored)", () => {
    const wrap = mount(RefChip, {
      props: { kind: "ref", name: "", uuid: "deadbeef", resolved: false, moduleKind: "constraint" },
    });
    expect(wrap.classes()).toContain("wp-refchip--unresolved");
    expect(wrap.find(".wp-refchip").attributes("style") ?? "").not.toContain("--wp-refchip-tone");
    expect(wrap.text()).toContain("?");
    expect(wrap.text()).toContain("deadbeef");
    expect(wrap.find(".wp-refchip__icon--pi").exists()).toBe(false);
  });

  it("var chip ignores moduleKind entirely (always green)", () => {
    const wrap = mount(RefChip, {
      props: { kind: "var", name: "person", resolved: true, moduleKind: "constraint" },
    });
    expect(wrap.classes()).toContain("wp-refchip--var");
    expect(wrap.find(".wp-refchip").attributes("style") ?? "").not.toContain("--wp-refchip-tone");
    expect(wrap.find(".wp-refchip__icon--pi").exists()).toBe(false);
  });
});
