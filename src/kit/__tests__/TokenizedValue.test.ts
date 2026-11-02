import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import TokenizedValue from "../TokenizedValue.vue";

/** UUID used across the resolvable-ref cases. */
const GEM_UUID = "c0f09840";

describe("TokenizedValue", () => {
  it("passes plain text straight through", () => {
    const wrap = mount(TokenizedValue, { props: { value: "hello world" } });
    expect(wrap.text()).toContain("hello world");
    // No chips for a pure-text value.
    expect(wrap.find(".wp-tv-var").exists()).toBe(false);
    expect(wrap.find(".wp-tv-ref").exists()).toBe(false);
    wrap.unmount();
  });

  it("renders $rank as a green var chip", () => {
    const wrap = mount(TokenizedValue, { props: { value: "$rank" } });
    const chip = wrap.find(".wp-tv-var");
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toBe("$rank");
    wrap.unmount();
  });

  it("renders $name.K with the .K accessor suffix", () => {
    const wrap = mount(TokenizedValue, { props: { value: "$mood.2" } });
    const chip = wrap.find(".wp-tv-var");
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toBe("$mood.2");
    wrap.unmount();
  });

  it("resolves @{uuid} to a name via uuidToName + shows the sparkles icon", () => {
    const wrap = mount(TokenizedValue, {
      props: {
        value: `@{${GEM_UUID}}`,
        uuidToName: new Map([[GEM_UUID, "gem"]]),
      },
    });
    const chip = wrap.find(".wp-tv-ref");
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain("gem");
    expect(chip.find("i.pi-sparkles").exists()).toBe(true);
    expect(chip.classes()).not.toContain("wp-tv-ref--unresolved");
    wrap.unmount();
  });

  it("marks a bare-uuid ref with no mapping as unresolved (uuid + question icon + red class)", () => {
    const wrap = mount(TokenizedValue, {
      props: { value: "@{deadbeef}", uuidToName: new Map<string, string>() },
    });
    const chip = wrap.find(".wp-tv-ref");
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain("deadbeef");
    expect(chip.find("i.pi-question-circle").exists()).toBe(true);
    expect(chip.classes()).toContain("wp-tv-ref--unresolved");
    wrap.unmount();
  });

  it("prefers the cached #name over the bare uuid for an unresolved ref", () => {
    const wrap = mount(TokenizedValue, {
      props: { value: "@{deadbeef#fur}", uuidToName: new Map<string, string>() },
    });
    const chip = wrap.find(".wp-tv-ref");
    expect(chip.exists()).toBe(true);
    // Cached #name resolves the label even with no map entry → NOT unresolved.
    expect(chip.text()).toContain("fur");
    expect(chip.text()).not.toContain("deadbeef");
    expect(chip.classes()).not.toContain("wp-tv-ref--unresolved");
    wrap.unmount();
  });

  it("renders a filtered ref with a funnel (title=expr), a ban, and no inline expr text", () => {
    const wrap = mount(TokenizedValue, {
      props: {
        value: `@{${GEM_UUID}#fur:warm or soft!null}`,
        uuidToName: new Map([[GEM_UUID, "gem"]]),
      },
    });
    const chip = wrap.find(".wp-tv-ref");
    expect(chip.exists()).toBe(true);
    // Label is the resolved name (uuidToName wins over the #name cache).
    expect(chip.text()).toContain("gem");
    // Funnel + ban icons present.
    expect(chip.find("i.pi-filter").exists()).toBe(true);
    expect(chip.find("i.pi-ban").exists()).toBe(true);
    // Expression lives in the hover title only — never inline.
    expect(chip.attributes("title")).toContain("warm or soft");
    expect(chip.text()).not.toContain("warm or soft");
    wrap.unmount();
  });

  it("recurses into a {a|@{uuid}|$rank} brace: arms become chips, not raw @{ text", () => {
    const wrap = mount(TokenizedValue, {
      props: {
        value: `{a|@{${GEM_UUID}}|$rank}`,
        uuidToName: new Map([[GEM_UUID, "gem"]]),
      },
    });
    // The @{...} arm renders as a ref chip (resolved → "gem").
    const ref = wrap.find(".wp-tv-ref");
    expect(ref.exists()).toBe(true);
    expect(ref.text()).toContain("gem");
    // The $rank arm renders as a var chip.
    const vars = wrap.findAll(".wp-tv-var");
    expect(vars.some((v) => v.text() === "$rank")).toBe(true);
    // Amber brace scaffolding is present and the raw @{ marker is gone.
    expect(wrap.find(".wp-tv-scaf--brace").exists()).toBe(true);
    expect(wrap.text()).not.toContain("@{");
    wrap.unmount();
  });

  it("renders multi-select scaffolding for {2$$, $$a|b}", () => {
    const wrap = mount(TokenizedValue, { props: { value: "{2$$, $$a|b}" } });
    const scaf = wrap.find(".wp-tv-scaf--multi");
    expect(scaf.exists()).toBe(true);
    // Reconstructed opening prefix carries the count + $$sep$$.
    expect(wrap.text()).toContain("2");
    expect(wrap.text()).toContain("$$");
    wrap.unmount();
  });
});
