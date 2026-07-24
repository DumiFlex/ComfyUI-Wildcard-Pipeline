import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import RuleValueChips from "./RuleValueChips.vue";

// Issue #1: nested `@{uuid}` / `$var` inside an inline `{a|b}` block used to
// render as raw hex because RuleValueChips dumped the whole dp-brace token as
// text. It now delegates to RichTextPreview (which decomposes braces via
// atomicEditorModel.parse and chips every ref/var via RefChip), so the inner
// refs chip at brace depth too.
describe("RuleValueChips — nested refs inside braces", () => {
  const names = new Map([
    ["beef0001", "standing"],
    ["beef0002", "sitting"],
  ]);

  it("chips each @{} ref inside a {a|b} block (not raw hex)", () => {
    const w = mount(RuleValueChips, {
      props: { value: "{@{beef0001}|@{beef0002}}", uuidToName: names },
    });
    // Two inner refs → two RefChips; raw uuid hex must not leak as text.
    expect(w.findAllComponents({ name: "RefChip" }).length).toBe(2);
    expect(w.text()).not.toContain("beef0001");
    expect(w.text()).toContain("standing");
    expect(w.text()).toContain("sitting");
  });

  it("chips a $var reference too", () => {
    const w = mount(RuleValueChips, { props: { value: "$pose_standing" } });
    expect(w.findAllComponents({ name: "RefChip" }).length).toBe(1);
    expect(w.text()).toContain("pose_standing");
  });

  it("renders a distinct 'empty' state (not '?') for an empty value", () => {
    // Empty replace is valid — must read as an intentional empty, not a
    // failed resolve. No RefChip, no bare '?'.
    const w = mount(RuleValueChips, { props: { value: "" } });
    const empty = w.find('[data-test="rvc-empty"]');
    expect(empty.exists()).toBe(true);
    expect(empty.text()).toContain("empty");
    expect(w.text()).not.toContain("?");
    expect(w.findAllComponents({ name: "RefChip" }).length).toBe(0);
  });
});
