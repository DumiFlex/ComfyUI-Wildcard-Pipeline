import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import RefChip from "../RefChip.vue";
import { varColorIndex } from "../../../components/shared/var-color";

/**
 * Flat rendering: the prompt template shows `$var` as coloured text rather
 * than a chip.
 *
 * The colour is not decoration. The assembler's variable strip sits a few
 * pixels below the editor and colours every name through the same djb2 hash;
 * the chip painted every var one `--wp-success` green, so the same `$quality`
 * was green above and blue below, in one node. These tests pin the two to the
 * same function.
 */
describe("RefChip — flat var rendering", () => {
  const base = { kind: "var" as const, resolved: true, graphAware: true, inScope: true };

  it("keeps the chip box by default, so every existing caller is untouched", () => {
    const w = mount(RefChip, { props: { ...base, name: "quality" } });
    expect(w.classes()).toContain("wp-refchip--var");
    expect(w.classes()).not.toContain("wp-refchip--flat");
  });

  it("drops the box and colours by the name's own hash bucket when flat", () => {
    const w = mount(RefChip, { props: { ...base, name: "quality", flat: "on" } });
    expect(w.classes()).toContain("wp-refchip--flat");
    expect(w.attributes("style")).toContain(`var(--wp-var-${varColorIndex("quality")})`);
  });

  it("gives two different names two different colours", () => {
    // The whole point of the hash. If these collide the test is picking two
    // names that share a bucket, not proving anything — `quality` and `camera`
    // are known to differ (1 and 5).
    const a = mount(RefChip, { props: { ...base, name: "quality", flat: "on" } });
    const b = mount(RefChip, { props: { ...base, name: "camera", flat: "on" } });
    expect(a.attributes("style")).not.toBe(b.attributes("style"));
  });

  it("never flattens a ref — those really are clickable objects", () => {
    const w = mount(RefChip, {
      props: { kind: "ref", name: "palette", uuid: "aabbccdd", resolved: true, flat: "on" },
    });
    expect(w.classes()).not.toContain("wp-refchip--flat");
    expect(w.classes()).toContain("wp-refchip--ref");
  });

  it("marks a flat var that nothing upstream writes", () => {
    // Dropping the box costs the one cue that used to distinguish these: with
    // a chip, a broken var at least still read as a chip. Colour cannot say it
    // — every flat token is coloured — so this state keeps a mark of its own.
    const w = mount(RefChip, {
      props: { ...base, name: "typo_here", flat: "on", inScope: false },
    });
    expect(w.classes()).toContain("wp-refchip--flat-unbound");
    // and must NOT also carry a palette colour, which would fight the marker
    expect(w.attributes("style") ?? "").not.toContain("--wp-var-");
  });

  it("does not cry unbound where the host never walked a graph", () => {
    // In the SPA every var is out of scope because there is no graph to be in.
    // Flagging them all would make the marker meaningless exactly where it
    // carries no information.
    const w = mount(RefChip, {
      props: { ...base, name: "quality", flat: "on", inScope: false, graphAware: false },
    });
    expect(w.classes()).not.toContain("wp-refchip--flat-unbound");
    expect(w.attributes("style")).toContain("--wp-var-");
  });
});
