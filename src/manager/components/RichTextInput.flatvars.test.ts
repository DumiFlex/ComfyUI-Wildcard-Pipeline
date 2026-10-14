import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import RichTextInput from "./RichTextInput.vue";
import { varColorIndex } from "../../components/shared/var-color";
import type { SurfaceKind } from "../utils/resolveTokens";

/**
 * On the prompt template a `$name` is ordinary editable text that happens to be
 * coloured — NOT an atomic chip.
 *
 * The first attempt at this only restyled the chip: box off, colour on, atom
 * intact. That still behaved like an object — one Backspace deleted the whole
 * token, the caret could not enter it, it kept a pointer cursor and its leading
 * `⌘` glyph. Looking like text is not being text.
 */
describe("RichTextInput — template variables are text, not chips", () => {
  const mountAt = (surface: SurfaceKind, modelValue: string, varSuggestions: string[] = []) =>
    mount(RichTextInput, {
      props: { modelValue, surface, multiline: true, varSuggestions, graphAware: true },
    });

  it("emits no chip for a $var on the assembler surface", async () => {
    const w = mountAt("assembler", "$quality, portrait", ["quality"]);
    await w.vm.$nextTick();
    expect(w.findAll(".wp-refchip").length).toBe(0);
  });

  it("renders vars as text on the other surfaces that read them too", async () => {
    // Every var-reading surface (combine, derivation, …) now collapses `$name`
    // to coloured text — the assembler is no longer special.
    const w = mountAt("combine", "$quality, portrait", ["quality"]);
    await w.vm.$nextTick();
    expect(w.findAll(".wp-refchip").length).toBe(0);
    expect(w.get(".wp-rt-var").text()).toBe("$quality");
  });

  it("still chips nested @{uuid} refs on the wildcard surface", async () => {
    // Guard against flattening vars by flattening refs too: refs stay atoms.
    const w = mountAt("wildcard", "@{abcd1234}, portrait");
    await w.vm.$nextTick();
    expect(w.findAll(".wp-refchip--ref").length).toBe(1);
  });

  it("colours the run from the same hash the variable strip uses", async () => {
    const w = mountAt("assembler", "$quality, portrait", ["quality"]);
    await w.vm.$nextTick();
    const span = w.get(".wp-rt-var");
    expect(span.text()).toBe("$quality");
    expect(span.attributes("style")).toContain(`--wp-var-${varColorIndex("quality")}`);
  });

  it("marks a name nothing upstream writes", async () => {
    const w = mountAt("assembler", "$typo_here", []);
    await w.vm.$nextTick();
    const style = w.get(".wp-rt-var").attributes("style") ?? "";
    expect(style).toContain("--wp-danger");
    expect(style).toContain("wavy");
  });

  it("makes no such claim where the host never walked a graph", async () => {
    // The SPA has no graph, so every var is out of scope and the marker would
    // be noise on every single one.
    const w = mount(RichTextInput, {
      props: { modelValue: "$quality", surface: "assembler", multiline: true, graphAware: false },
    });
    await w.vm.$nextTick();
    const style = w.get(".wp-rt-var").attributes("style") ?? "";
    expect(style).not.toContain("--wp-danger");
    expect(style).toContain("--wp-var-");
  });

  it("round-trips the raw text unchanged", async () => {
    // Collapsing to text must not rewrite what the user typed.
    const w = mountAt("assembler", "a $quality portrait of $subject", ["quality"]);
    await w.vm.$nextTick();
    expect(w.get(".wp-rt__host").text().replace(/\u200b/g, "")).toBe(
      "a $quality portrait of $subject",
    );
  });
});
