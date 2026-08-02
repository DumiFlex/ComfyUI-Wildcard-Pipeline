import { mount } from "@vue/test-utils";
import { describe, it, expect } from "vitest";
import SubcategoryFilterPicker from "../SubcategoryFilterPicker.vue";

const props = {
  subCategories: ["warm", "cold"], tagGroups: { temp: ["warm", "cold"] },
  optionTagSets: [["warm"], ["cold"]], initialExpr: "warm or cold",
  initialExcludeNull: false, mode: "edit" as const, hasNullOption: true,
};

describe("SubcategoryFilterPicker", () => {
  it("emits apply with the typed expression + exclude_null", async () => {
    const w = mount(SubcategoryFilterPicker, { props });
    await w.get('[data-test="expr-input"]').setValue("warm");
    await w.get('[data-test="picker-apply"]').trigger("click");
    expect(w.emitted("apply")![0]).toEqual([{ expr: "warm", excludeNull: false }]);
  });
  it("blocks Apply on an invalid expression", async () => {
    const w = mount(SubcategoryFilterPicker, { props });
    await w.get('[data-test="expr-input"]').setValue("warm or");
    expect(w.get('[data-test="picker-apply"]').attributes("disabled")).toBeDefined();
    expect(w.text()).toMatch(/incomplete|operator|term/i);
  });
  it("shows reads-as + match count", async () => {
    const w = mount(SubcategoryFilterPicker, { props });
    await w.get('[data-test="expr-input"]').setValue("warm or cold");
    expect(w.get('[data-test="reads-as"]').text()).toContain("warm or cold");
    // 3, not 2: this fixture sets `hasNullOption`, and the null option is part
    // of the pool being filtered until `Exclude null` drops it.
    expect(w.get('[data-test="match-count"]').text()).toMatch(/2 of 3/);
  });
});

describe("SubcategoryFilterPicker — interaction details", () => {
  type PickerProps = Omit<typeof props, "mode"> & { mode: "insert" | "edit" };
  function mountIt(over: Partial<PickerProps> = {}) {
    const merged: PickerProps = { ...props, ...over };
    return mount(SubcategoryFilterPicker, { props: merged });
  }

  it("seeds the expression input from initialExpr", () => {
    const w = mountIt({ initialExpr: "cold" });
    expect(w.get<HTMLInputElement>('[data-test="expr-input"]').element.value).toBe("cold");
  });

  it("an empty expression is valid (no filter) and Apply is enabled", async () => {
    const w = mountIt({ initialExpr: "" });
    await w.get('[data-test="expr-input"]').setValue("");
    expect(w.get('[data-test="picker-apply"]').attributes("disabled")).toBeUndefined();
    await w.get('[data-test="picker-apply"]').trigger("click");
    expect(w.emitted("apply")![0]).toEqual([{ expr: "", excludeNull: false }]);
  });

  it("flags an unknown sub-category term", async () => {
    const w = mountIt();
    await w.get('[data-test="expr-input"]').setValue("warm or pink");
    expect(w.text()).toMatch(/unknown sub-category/i);
    expect(w.get('[data-test="picker-apply"]').attributes("disabled")).toBeDefined();
  });

  it("inserting a sub-category chip appends it to the expression", async () => {
    const w = mountIt({ initialExpr: "warm" });
    const coldChip = w.get('[data-test="subcat-chip"][data-value="cold"]');
    await coldChip.trigger("click");
    expect(w.get<HTMLInputElement>('[data-test="expr-input"]').element.value).toContain("cold");
  });

  it("inserting an operator appends it to the expression", async () => {
    const w = mountIt({ initialExpr: "warm" });
    const orOp = w.get('[data-test="subcat-op"][data-value="or"]');
    await orOp.trigger("click");
    expect(w.get<HTMLInputElement>('[data-test="expr-input"]').element.value).toMatch(/warm\s+or/);
  });

  it("round-trips the exclude-null flag in the applied filter", async () => {
    const w = mountIt({ initialExpr: "warm", hasNullOption: true });
    const cb = w.get('[data-test="subcat-exclude-null"] .wp-check');
    await cb.trigger("click");
    await w.get('[data-test="picker-apply"]').trigger("click");
    const ev = w.emitted("apply")!;
    expect(ev[ev.length - 1]).toEqual([{ expr: "warm", excludeNull: true }]);
  });

  it("seeds the exclude-null checkbox from initialExcludeNull", () => {
    const w = mountIt({ hasNullOption: true, initialExcludeNull: true });
    const cb = w.get('[data-test="subcat-exclude-null"] .wp-check');
    expect(cb.attributes("aria-checked")).toBe("true");
  });

  it("omits the exclude-null row when hasNullOption is false", () => {
    const w = mountIt({ hasNullOption: false });
    expect(w.find('[data-test="subcat-exclude-null"]').exists()).toBe(false);
  });

  it("delete button only renders in edit mode", () => {
    expect(mountIt({ mode: "insert" }).find('[data-test="picker-delete"]').exists()).toBe(false);
    expect(mountIt({ mode: "edit" }).find('[data-test="picker-delete"]').exists()).toBe(true);
  });

  it("emits skip / delete on their buttons", async () => {
    const w = mountIt({ mode: "edit" });
    await w.get('[data-test="picker-skip"]').trigger("click");
    expect(w.emitted("skip")).toBeTruthy();
    await w.get('[data-test="picker-delete"]').trigger("click");
    expect(w.emitted("delete")).toBeTruthy();
  });

  it("match count reflects the typed expression", async () => {
    const w = mountIt();
    await w.get('[data-test="expr-input"]').setValue("warm");
    // Denominator includes the null option — see the note above.
    expect(w.get('[data-test="match-count"]').text()).toMatch(/1 of 3/);
  });
});

/**
 * The v3 panel additions: chip states read off the parsed expression, the
 * axis palette with collapse + search, and the two "you should look at this"
 * states that are not validation errors.
 */
describe("SubcategoryFilterPicker — the palette reflects the expression", () => {
  const axes = {
    subCategories: ["warm", "cool", "neutral", "vivid", "ghost"],
    tagGroups: { temperature: ["warm", "cool", "neutral"], saturation: ["vivid"] },
    // `ghost` is declared by the wildcard but carried by NO option.
    optionTagSets: [["warm"], ["cool"], ["neutral"], ["vivid", "warm"]],
    initialExpr: "",
    initialExcludeNull: false,
    mode: "insert" as const,
    hasNullOption: false,
  };

  const chipState = (w: ReturnType<typeof mount>, tag: string) =>
    w.get(`[data-test="subcat-chip"][data-value="${tag}"]`).attributes("data-state");

  it("lights a term the expression includes", async () => {
    const w = mount(SubcategoryFilterPicker, { props: axes });
    await w.get('[data-test="expr-input"]').setValue("warm");
    expect(chipState(w, "warm")).toBe("in");
    expect(chipState(w, "cool")).toBe("idle");
  });

  it("strikes a term the expression negates", async () => {
    const w = mount(SubcategoryFilterPicker, { props: axes });
    await w.get('[data-test="expr-input"]').setValue("warm and not vivid");
    expect(chipState(w, "warm")).toBe("in");
    expect(chipState(w, "vivid")).toBe("negated");
  });

  it("marks a tag no option carries as dead — the bug that prompted this", async () => {
    const w = mount(SubcategoryFilterPicker, { props: axes });
    expect(chipState(w, "ghost")).toBe("dead");
  });

  it("tracks a HAND-TYPED expression, not just clicked chips", async () => {
    // The palette is a view of the expression, never a second source of truth.
    const w = mount(SubcategoryFilterPicker, { props: axes });
    await w.get('[data-test="expr-input"]').setValue("not cool");
    expect(chipState(w, "cool")).toBe("negated");
  });
});

describe("SubcategoryFilterPicker — axis palette", () => {
  const axes = {
    subCategories: ["warm", "cool", "neutral", "vivid"],
    tagGroups: { temperature: ["warm", "cool", "neutral"], saturation: ["vivid"] },
    optionTagSets: [["warm"], ["cool"], ["neutral"], ["vivid"]],
    initialExpr: "",
    initialExcludeNull: false,
    mode: "insert" as const,
    hasNullOption: false,
  };

  it("groups tags under one collapsible header per axis", () => {
    const w = mount(SubcategoryFilterPicker, { props: axes });
    expect(w.findAll('[data-test="axis-head"]')).toHaveLength(2);
  });

  it("folds an axis away, and folding hides no STATE", async () => {
    const w = mount(SubcategoryFilterPicker, { props: axes });
    await w.get('[data-test="expr-input"]').setValue("warm and cool");
    const head = w.findAll('[data-test="axis-head"]')[0];
    await head.trigger("click");
    expect(w.findAll('[data-test="subcat-chip"][data-value="warm"]')).toHaveLength(0);
    // The header still reports what is in play inside the folded axis.
    expect(head.text()).toContain("2 used");
  });

  it("reports negated terms separately in the axis summary", async () => {
    const w = mount(SubcategoryFilterPicker, { props: axes });
    await w.get('[data-test="expr-input"]').setValue("warm and not vivid");
    const heads = w.findAll('[data-test="axis-head"]');
    expect(heads[0].text()).toContain("1 used");
    expect(heads[1].text()).toContain("1 negated");
  });

  it("narrows the palette by search, dropping axes left with nothing", async () => {
    const w = mount(SubcategoryFilterPicker, { props: axes });
    await w.get('[data-test="tag-search"]').setValue("viv");
    const shown = w.findAll('[data-test="subcat-chip"]').map((c) => c.attributes("data-value"));
    expect(shown).toEqual(["vivid"]);
    // An empty header would claim "this axis has no tags", a different thing.
    expect(w.findAll('[data-test="axis-head"]')).toHaveLength(1);
  });

  it("says so when the search matches nothing", async () => {
    const w = mount(SubcategoryFilterPicker, { props: axes });
    await w.get('[data-test="tag-search"]').setValue("zzz");
    expect(w.find('[data-test="no-tags"]').exists()).toBe(true);
  });
});

describe("SubcategoryFilterPicker — states that are not errors", () => {
  const base = {
    subCategories: ["warm", "cool"],
    tagGroups: { temperature: ["warm", "cool"] },
    // No option carries BOTH, so `warm and cool` is valid and matches nothing.
    optionTagSets: [["warm"], ["cool"]],
    initialExpr: "",
    initialExcludeNull: false,
    mode: "insert" as const,
    hasNullOption: false,
  };

  it("warns when a VALID expression matches nothing", async () => {
    const w = mount(SubcategoryFilterPicker, { props: base });
    await w.get('[data-test="expr-input"]').setValue("warm and cool");
    expect(w.find('[data-test="expr-error"]').exists()).toBe(false);
    expect(w.find('[data-test="zero-match"]').exists()).toBe(true);
  });

  it("still allows Apply — matching nothing is a choice, not a syntax error", async () => {
    const w = mount(SubcategoryFilterPicker, { props: base });
    await w.get('[data-test="expr-input"]').setValue("warm and cool");
    expect(w.get('[data-test="picker-apply"]').attributes("disabled")).toBeUndefined();
  });

  it("does NOT warn about an empty expression, which means no filter", async () => {
    const w = mount(SubcategoryFilterPicker, { props: base });
    await w.get('[data-test="expr-input"]').setValue("");
    expect(w.find('[data-test="zero-match"]').exists()).toBe(false);
  });

  it("offers a correction for a near-miss term", async () => {
    const w = mount(SubcategoryFilterPicker, { props: base });
    await w.get('[data-test="expr-input"]').setValue("warmm");
    expect(w.get('[data-test="did-you-mean"]').text()).toContain("warm");
  });

  it("applies the correction in place, preserving the rest of the expression", async () => {
    const w = mount(SubcategoryFilterPicker, { props: base });
    await w.get('[data-test="expr-input"]').setValue("(warmm or cool)");
    await w.get('[data-test="did-you-mean"]').trigger("click");
    // Spacing and parens are the user's; only the typo changes.
    expect((w.get('[data-test="expr-input"]').element as HTMLTextAreaElement).value)
      .toBe("(warm or cool)");
  });

  it("stays silent when nothing is close — a wrong guess is worse than none", async () => {
    const w = mount(SubcategoryFilterPicker, { props: base });
    await w.get('[data-test="expr-input"]').setValue("magenta");
    expect(w.find('[data-test="did-you-mean"]').exists()).toBe(false);
  });
});

describe("SubcategoryFilterPicker — null counts as an option", () => {
  const withNull = {
    subCategories: ["warm", "cool"],
    tagGroups: { temperature: ["warm", "cool"] },
    optionTagSets: [["warm"], ["cool"]],
    initialExpr: "",
    initialExcludeNull: false,
    mode: "insert" as const,
    hasNullOption: true,
  };

  it("counts the null option in the pool", () => {
    // `optionTagSets` carries only the non-null options, so the panel used to
    // count against 2 while the popover advertised 3.
    const w = mount(SubcategoryFilterPicker, { props: withNull });
    expect(w.get('[data-test="match-count"]').text()).toMatch(/3 of 3/);
  });

  it("drops it from the pool when Exclude null is ticked", async () => {
    const w = mount(SubcategoryFilterPicker, { props: withNull });
    // WpCheck renders a role="checkbox" span, not a native input.
    await w.get('[data-test="subcat-exclude-null"] .wp-check').trigger("click");
    expect(w.get('[data-test="match-count"]').text()).toMatch(/2 of 2/);
  });

  it("leaves the count alone for a wildcard with no null option", () => {
    const w = mount(SubcategoryFilterPicker, {
      props: { ...withNull, hasNullOption: false },
    });
    expect(w.get('[data-test="match-count"]').text()).toMatch(/2 of 2/);
  });

  it("excludes null from a positive expression — it carries no tags", async () => {
    const w = mount(SubcategoryFilterPicker, { props: withNull });
    await w.get('[data-test="expr-input"]').setValue("warm");
    expect(w.get('[data-test="match-count"]').text()).toMatch(/1 of 3/);
  });
});

describe("SubcategoryFilterPicker — the null row is one big target", () => {
  const withNull = {
    subCategories: ["warm"], tagGroups: { t: ["warm"] }, optionTagSets: [["warm"]],
    initialExpr: "", initialExcludeNull: false,
    mode: "insert" as const, hasNullOption: true,
  };

  it("toggles from anywhere on the row, not just the 13px box", async () => {
    const w = mount(SubcategoryFilterPicker, { props: withNull });
    await w.get('[data-test="subcat-exclude-null"]').trigger("click");
    await w.get('[data-test="picker-apply"]').trigger("click");
    expect(w.emitted("apply")![0]).toEqual([{ expr: "", excludeNull: true }]);
  });

  it("does not double-toggle when the click lands on the checkbox itself", async () => {
    // The checkbox toggles on its own click AND that click bubbles to the row;
    // handling both would flip the flag twice and look like nothing happened.
    const w = mount(SubcategoryFilterPicker, { props: withNull });
    await w.get('[data-test="subcat-exclude-null"] .wp-check').trigger("click");
    await w.get('[data-test="picker-apply"]').trigger("click");
    expect(w.emitted("apply")![0]).toEqual([{ expr: "", excludeNull: true }]);
  });
});

describe("SubcategoryFilterPicker — which pool is being filtered", () => {
  const base = {
    subCategories: ["warm"], tagGroups: { t: ["warm"] }, optionTagSets: [["warm"]],
    initialExpr: "", initialExcludeNull: false,
    mode: "edit" as const, hasNullOption: false, wildcardName: "Hair Color",
  };

  it("says so when the pool is this node's own copy", () => {
    // A node snapshot can hold different options from the library row of the
    // same uuid, so the counts below describe the node's copy — the header has
    // to say which one it is measuring.
    const w = mount(SubcategoryFilterPicker, { props: { ...base, poolOrigin: "node" as const } });
    expect(w.find('[data-test="picker-origin-node"]').exists()).toBe(true);
  });

  it("stays unmarked for the library, which is the default case", () => {
    const w = mount(SubcategoryFilterPicker, { props: { ...base, poolOrigin: "library" as const } });
    expect(w.find('[data-test="picker-origin-node"]').exists()).toBe(false);
  });

  it("stays unmarked where there is no node at all — the SPA", () => {
    const w = mount(SubcategoryFilterPicker, { props: base });
    expect(w.find('[data-test="picker-origin-node"]').exists()).toBe(false);
  });
});
