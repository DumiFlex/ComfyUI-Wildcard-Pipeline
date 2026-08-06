import { describe, expect, it } from "vitest";
import { probeAutocomplete, probeTagWord } from "../autocompleteProbe";

/**
 * The booru-tag probe has no trigger character, so "when does it fire?" is the
 * entire design. The rule it exists to protect: it must never fire over a `$`
 * or `@` token, because two popovers competing for one caret is the single
 * behaviour this feature was not allowed to introduce.
 */
describe("probeTagWord", () => {
  const at = (s: string) => probeTagWord(s, s.length);

  describe("does not fire", () => {
    it("inside a $ variable", () => {
      expect(at("$outdoors")).toBeNull();
    });

    it("inside an @ reference", () => {
      expect(at("@colour")).toBeNull();
    });

    it("on a $ token mid-line, where the sigil probe is already active", () => {
      const text = "sunny day, $mood";
      expect(probeTagWord(text, text.length)).toBeNull();
      // Precondition: the sigil probe genuinely claims this caret.
      expect(probeAutocomplete(text, text.length)).not.toBeNull();
    });

    it("below the minimum length", () => {
      expect(at("bl")).toBeNull();
      expect(at("b")).toBeNull();
      expect(at("")).toBeNull();
    });

    it("on a bare number, which is a weight and not a tag", () => {
      expect(at("1234")).toBeNull();
    });

    it("just after a delimiter, with no word yet", () => {
      expect(at("red, ")).toBeNull();
      expect(at("red,")).toBeNull();
    });

    it("when the caret is out of range", () => {
      expect(probeTagWord("blue_hair", 0)).toBeNull();
      expect(probeTagWord("blue_hair", 99)).toBeNull();
    });
  });

  describe("fires", () => {
    it("on a plain word once it is long enough", () => {
      expect(at("blu")).toEqual({ start: 0, query: "blu" });
    });

    it("on the word at the caret, not an earlier one", () => {
      const text = "solo, blue_ha";
      expect(probeTagWord(text, text.length)).toEqual({ start: 6, query: "blue_ha" });
    });

    it("keeps underscores, since booru tags are underscore-joined", () => {
      expect(at("blue_hair")).toEqual({ start: 0, query: "blue_hair" });
    });

    it("keeps hyphens and apostrophes that appear inside real tags", () => {
      expect(at("t-shirt")).toEqual({ start: 0, query: "t-shirt" });
      expect(at("cat's")).toEqual({ start: 0, query: "cat's" });
    });

    it("reports a start offset that splices out exactly the typed word", () => {
      const text = "1girl, blue_ha";
      const hit = probeTagWord(text, text.length)!;
      const spliced = text.slice(0, hit.start) + "blue_hair" + text.slice(text.length);
      expect(spliced).toBe("1girl, blue_hair");
    });

    it("fires on the word after a completed $ token", () => {
      // `$mood ` settled; the user has moved on to a plain tag.
      const text = "$mood outd";
      expect(probeTagWord(text, text.length)).toEqual({ start: 6, query: "outd" });
    });
  });

  describe("agrees with the sigil probe about who owns the caret", () => {
    it.each([
      "$mood",
      "@colour",
      "prefix $mo",
      "prefix @co",
    ])("never both claim %j", (text) => {
      const sigil = probeAutocomplete(text, text.length);
      const tag = probeTagWord(text, text.length);
      expect(sigil !== null && tag !== null).toBe(false);
    });

    it.each([
      "blue_hair",
      "solo, outdoors",
    ])("the tag probe claims %j alone", (text) => {
      expect(probeAutocomplete(text, text.length)).toBeNull();
      expect(probeTagWord(text, text.length)).not.toBeNull();
    });
  });
});
