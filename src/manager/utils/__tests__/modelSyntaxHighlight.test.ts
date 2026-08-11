import { describe, expect, it } from "vitest";
import { inlineTokenHtml } from "../../../widgets/richTokenize";

/**
 * `<lora:…>` and `embedding:…` carry one fixed colour each, unlike `$var` which
 * hashes its name into eight buckets. There are arbitrarily many variables and
 * the colour is how you tell two apart; there are exactly two of these and they
 * always mean the same thing.
 */
describe("model syntax highlighting", () => {
  it("wraps a lora reference", () => {
    const html = inlineTokenHtml("a <lora:style/foo.safetensors:1.0> b");
    expect(html).toContain('<span class="wp-rt-lora">&lt;lora:style/foo.safetensors:1.0&gt;</span>');
  });

  it("wraps an embedding reference", () => {
    const html = inlineTokenHtml("x embedding:neg/bad.pt y");
    expect(html).toContain('<span class="wp-rt-embedding">embedding:neg/bad.pt</span>');
  });

  it("stops an embedding at a comma, which is where the prompt moves on", () => {
    const html = inlineTokenHtml("embedding:one, two");
    expect(html).toContain('<span class="wp-rt-embedding">embedding:one</span>');
    expect(html).not.toContain("two</span>");
  });

  it("highlights a half-typed lora, since that is when it is being written", () => {
    expect(inlineTokenHtml("<lora:half")).toContain('class="wp-rt-lora"');
  });

  it("leaves ordinary prose completely alone", () => {
    // The fast path returns raw escaped text; nothing should be wrapped.
    expect(inlineTokenHtml("a portrait of a cat")).toBe("a portrait of a cat");
  });

  it("still escapes what it wraps", () => {
    expect(inlineTokenHtml("<lora:a<b>")).not.toContain("<b>");
  });
});
