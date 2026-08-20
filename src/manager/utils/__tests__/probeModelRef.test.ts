import { describe, expect, it } from "vitest";
import { probeModelRef, probeTagWord } from "../autocompleteProbe";

/**
 * The caret inside a model reference names ONE kind, and the path it is naming
 * cannot be described by a character class.
 *
 * `probeTagWord` stops at any character outside `[a-zA-Z0-9_'-]`, so a caret at
 * the end of `embedding:style\\lazyhand-e12c.safetensors` walked back only as
 * far as the dot and searched for `safetensors` — matching every model on disk
 * and nothing the user meant. Real names carry dots, separators and spaces.
 */
describe("probeModelRef", () => {
  const at = (s: string) => probeModelRef(s, s.length);

  it("claims a caret at the end of a full embedding path", () => {
    const s = "embedding:style\\lazyhand-e12c.safetensors";
    expect(at(s)).toEqual({
      start: "embedding:".length,
      query: "style\\lazyhand-e12c.safetensors",
      kind: "embedding",
    });
  });

  it("keeps spaces and dots inside a lora name", () => {
    // Bounded by syntax, not by a character class — which is the whole point.
    const s = "<lora:style\\8.0-sprite pixel art style by skormino.safetensors";
    expect(at(s)?.query).toBe("style\\8.0-sprite pixel art style by skormino.safetensors");
    expect(at(s)?.kind).toBe("lora");
  });

  it("fires on an empty reference, so the marker alone offers the list", () => {
    expect(at("<lora:")).toEqual({ start: 6, query: "", kind: "lora" });
  });

  it("lets go once the reference is closed", () => {
    expect(at("<lora:thing:1.0> and then some")).toBeNull();
  });

  it("lets go past the weight separator — that is a number, not a name", () => {
    expect(at("<lora:thing:1.")).toBeNull();
  });

  it("does not reach across a comma into an earlier reference", () => {
    expect(at("<lora:thing:1.0>, portrait of a cat")).toBeNull();
    expect(at("embedding:foo, masterpiece")).toBeNull();
  });

  it("takes the nearer marker when both appear", () => {
    const s = "embedding:one <lora:two";
    expect(at(s)?.kind).toBe("lora");
    expect(at(s)?.query).toBe("two");
  });

  it("matches the marker case-insensitively", () => {
    expect(at("<LoRA:thing")?.kind).toBe("lora");
    expect(at("Embedding:thing")?.kind).toBe("embedding");
  });

  it("stays out of the way of ordinary prose", () => {
    expect(at("a portrait of a cat")).toBeNull();
  });

  it("is what the bare-word probe could never do", () => {
    // Documents the old behaviour that made this necessary.
    const s = "embedding:style\\lazyhand-e12c.safetensors";
    expect(probeTagWord(s, s.length)?.query).toBe("safetensors");
    expect(at(s)?.query).toBe("style\\lazyhand-e12c.safetensors");
  });
});
