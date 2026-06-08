import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import DebugViewer from "./DebugViewer.vue";
import { _resetForTests, _setForTests } from "../../extension/preview-resolver";

const SAMPLE_SNAPSHOT = JSON.stringify({
  hair_style: "long flowing",
  mood: "joyful",
  __wp_picks__: { abc12345: { value: "long flowing", sub_categories: ["long"] } },
  __wp_constraints__: [{ source: "abc12345", target: "def67890" }],
  // Trace entry includes `writes[].variable` so the picks-tab lookup
  // can re-key `abc12345 → $hair_style` instead of showing the raw uuid.
  __wp_trace__: [
    {
      id: "abc12345",
      type: "wildcard",
      status: "ok",
      seed: 4231,
      writes: [{ variable: "hair_style", value: "long flowing", source: "wildcard" }],
    },
  ],
  __wp_warnings__: [{ type: "duplicate_variable", detail: "$hair_style" }],
});

describe("DebugViewer", () => {
  it("renders four tabs: Snapshot, Trace, Picks, Warnings", () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: SAMPLE_SNAPSHOT } });
    const tabs = wrapper.findAll(".wp-dbg-tab");
    expect(tabs).toHaveLength(4);
    expect(tabs[0].text()).toContain("Snapshot");
    expect(tabs[1].text()).toContain("Trace");
    expect(tabs[2].text()).toContain("Picks");
    expect(tabs[3].text()).toContain("Warnings");
  });

  it("Snapshot tab is active by default", () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: SAMPLE_SNAPSHOT } });
    const active = wrapper.find(".wp-dbg-tab.is-active");
    expect(active.text()).toContain("Snapshot");
  });

  it("clicking a tab makes it active and swaps the body", async () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: SAMPLE_SNAPSHOT } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    expect(wrapper.find(".wp-dbg-tab.is-active").text()).toContain("Trace");
  });

  it("Picks tab badge shows the count of __wp_picks__ entries", () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: SAMPLE_SNAPSHOT } });
    const picksTab = wrapper.findAll(".wp-dbg-tab")[2];
    expect(picksTab.text()).toMatch(/Picks\s*1/);
  });

  it("renders a multi-select pick record's joined value + union tags (SP2a)", async () => {
    const snap = JSON.stringify({
      colors: "red, blue, green",
      __wp_picks__: {
        m1: {
          value: "red, blue, green",
          values: ["red", "blue", "green"],
          sub_categories: ["warm", "cool"],
        },
      },
      __wp_trace__: [
        {
          id: "m1",
          type: "wildcard",
          status: "ok",
          seed: 1,
          writes: [{ variable: "colors", value: "red, blue, green", source: "wildcard" }],
        },
      ],
      __wp_warnings__: [],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: snap } });
    await wrapper.findAll(".wp-dbg-tab")[2].trigger("click");
    expect(wrapper.text()).toContain("red, blue, green");
    expect(wrapper.text()).toContain("$colors");
  });

  it("Warnings tab badge shows the warn count + warn-tone class", () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: SAMPLE_SNAPSHOT } });
    const warnTab = wrapper.findAll(".wp-dbg-tab")[3];
    expect(warnTab.text()).toMatch(/Warnings\s*1/);
    expect(warnTab.find(".wp-dbg-tab-badge--warn").exists()).toBe(true);
  });

  it("renders copy + download buttons in the toolbar", () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: SAMPLE_SNAPSHOT } });
    expect(wrapper.find('[data-test="dbg-copy"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="dbg-download"]').exists()).toBe(true);
  });

  it("renders empty state when snapshot is empty", () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: "" } });
    expect(wrapper.text()).toContain("Run the graph");
  });

  it("Trace tab badge shows the entry count", () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: SAMPLE_SNAPSHOT } });
    const traceTab = wrapper.findAll(".wp-dbg-tab")[1];
    expect(traceTab.text()).toMatch(/Trace\s*1/);
  });

  it("Trace tab renders $variable labels not raw module ids", async () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: SAMPLE_SNAPSHOT } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    const labelCells = wrapper.findAll(".wp-dbg-trace-label");
    expect(labelCells.length).toBe(1);
    expect(labelCells[0].text()).toContain("$hair_style");
  });

  it("Trace tab renders status pill with ok variant", async () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: SAMPLE_SNAPSHOT } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    expect(wrapper.find(".wp-dbg-trace-pill--ok").exists()).toBe(true);
  });

  it("Trace tab renders error pill + row tint when entry has error", async () => {
    const errSnap = JSON.stringify({
      __wp_trace__: [
        {
          id: "fff00000",
          type: "wildcard",
          status: "failed",
          error: { type: "ValueError", message: "missing target" },
          writes: [],
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: errSnap } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    expect(wrapper.find(".wp-dbg-trace-pill--error").exists()).toBe(true);
    expect(wrapper.find(".wp-dbg-trace-row--error").exists()).toBe(true);
  });

  it("Picks tab re-keys raw module ids to $variable_name via trace lookup", async () => {
    const wrapper = mount(DebugViewer, { props: { snapshot: SAMPLE_SNAPSHOT } });
    await wrapper.findAll(".wp-dbg-tab")[2].trigger("click");
    const keyCells = wrapper.findAll(".wp-dbg-pick-key");
    expect(keyCells.length).toBe(1);
    expect(keyCells[0].text()).toBe("$hair_style");
    // Value column shows the picked option's `value` field, not raw JSON.
    const valCell = wrapper.find(".wp-dbg-pick-val");
    expect(valCell.text()).toBe("long flowing");
    // Sub-category shown as a chip when present.
    expect(wrapper.find(".wp-dbg-pick-cat").text()).toBe("long");
  });

  it("Picks tab falls back to short uuid when trace doesn't carry the variable", async () => {
    const orphanSnap = JSON.stringify({
      __wp_picks__: { ffeeddcc11: { value: "orphaned" } },
      __wp_trace__: [],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: orphanSnap } });
    await wrapper.findAll(".wp-dbg-tab")[2].trigger("click");
    const keyCell = wrapper.find(".wp-dbg-pick-key");
    expect(keyCell.text()).toBe("$ffeeddcc");
  });

  it("Trace tab fans out multi-write modules into one row per binding", async () => {
    const multi = JSON.stringify({
      __wp_trace__: [
        {
          id: "fixedmod1",
          type: "fixed_values",
          status: "ok",
          writes: [
            { variable: "alpha", value: "v1" },
            { variable: "beta", value: "v2" },
            { variable: "gamma", value: "v3" },
          ],
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: multi } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    const rows = wrapper.findAll(".wp-dbg-trace-row").filter(
      (r) => !r.classes("wp-dbg-trace-row--head"),
    );
    expect(rows.length).toBe(3);
    const labels = wrapper.findAll(".wp-dbg-trace-label").map((el) => el.text());
    expect(labels).toEqual(["$alpha", "$beta", "$gamma"]);
  });

  it("Trace tab applies kind-chip color class per module type", async () => {
    const mixed = JSON.stringify({
      __wp_trace__: [
        { id: "w1", type: "wildcard",     status: "ok", writes: [{ variable: "a", value: "x" }] },
        { id: "f1", type: "fixed_values", status: "ok", writes: [{ variable: "b", value: "y" }] },
        { id: "c1", type: "combine",      status: "ok", writes: [{ variable: "c", value: "z" }] },
        { id: "d1", type: "derivation",   status: "ok", writes: [{ variable: "d", value: "w" }] },
        { id: "k1", type: "constraint",   status: "ok", writes: [] },
        { node: "WP_ContextInjector", binding: "inj1", type: "str", status: "ok" },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: mixed } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    const types = wrapper.findAll(".wp-dbg-trace-type");
    expect(types[0].classes()).toContain("wp-kind-chip--wildcard");
    expect(types[1].classes()).toContain("wp-kind-chip--fixed");
    expect(types[2].classes()).toContain("wp-kind-chip--combine");
    expect(types[3].classes()).toContain("wp-kind-chip--derivation");
    expect(types[4].classes()).toContain("wp-kind-chip--constraint");
    // Injector trace entries (node === "WP_ContextInjector") render
    // with the dedicated `injector` kind chip — the raw `type` field
    // carries the value type (str/int/float/bool) which surfaces
    // separately as a `.wp-dbg-trace-subtype` secondary chip.
    expect(types[5].classes()).toContain("wp-kind-chip--injector");
  });

  it("Injector trace row surfaces value-type subchip + TPL badge for template path", async () => {
    const snap = JSON.stringify({
      __wp_trace__: [
        { node: "WP_ContextInjector", binding: "raw_str",   type: "str",            status: "ok" },
        { node: "WP_ContextInjector", binding: "raw_int",   type: "int",            status: "ok" },
        { node: "WP_ContextInjector", binding: "raw_float", type: "float",          status: "ok" },
        { node: "WP_ContextInjector", binding: "tpl_row",   type: "str(template)",  status: "ok" },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: snap } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    const subs = wrapper.findAll(".wp-dbg-trace-subtype");
    expect(subs).toHaveLength(4);
    expect(subs[0].text()).toBe("STR");
    expect(subs[1].text()).toBe("INT");
    expect(subs[2].text()).toBe("FLOAT");
    // template path: subtype shows the rendered type (STR) — the
    // template-ness is conveyed by the separate TPL badge.
    expect(subs[3].text()).toBe("STR");
    const tplBadges = wrapper.findAll(".wp-dbg-trace-tpl");
    expect(tplBadges).toHaveLength(1);
    expect(tplBadges[0].text()).toBe("TPL");
  });

  it("Trace row for module with no bindings still surfaces (constraint-style)", async () => {
    const constraintSnap = JSON.stringify({
      __wp_trace__: [
        { id: "constraintabc", type: "constraint", status: "ok", writes: [] },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: constraintSnap } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    const labels = wrapper.findAll(".wp-dbg-trace-label");
    expect(labels.length).toBe(1);
    // Falls back to short-uuid label since no binding to display.
    expect(labels[0].text()).toBe("$constrai");
  });

  it("Trace seed cell renders the full seed (no truncation)", async () => {
    const fullSeedSnap = JSON.stringify({
      __wp_trace__: [
        {
          id: "abc12345",
          type: "wildcard",
          status: "ok",
          seed: 4932922958855935,
          writes: [{ variable: "x", value: "v" }],
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: fullSeedSnap } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    // The clickable variant is the data row (header row uses a plain
    // `<span>` for the column label, not a button).
    const seedCell = wrapper.find(".wp-dbg-trace-seed--clickable");
    expect(seedCell.text()).toBe("4932922958855935");
    expect(seedCell.text()).not.toContain("…");
  });

  it("Trace seed cell renders as a clickable button with copy title", async () => {
    const fullSeedSnap = JSON.stringify({
      __wp_trace__: [
        {
          id: "abc12345",
          type: "wildcard",
          status: "ok",
          seed: 12345,
          writes: [{ variable: "x", value: "v" }],
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: fullSeedSnap } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    const seedBtn = wrapper.find(".wp-dbg-trace-seed--clickable");
    expect(seedBtn.exists()).toBe(true);
    expect(seedBtn.element.tagName).toBe("BUTTON");
    expect(seedBtn.attributes("title")).toBe("Click to copy seed");
  });

  it("Picks tab renders @{uuid} refs as @varname chips", async () => {
    const refSnap = JSON.stringify({
      __wp_picks__: {
        backdrop1: {
          value: "minimal interior with @{a361dbdc} accents",
          sub_categories: ["indoor"],
        },
      },
      __wp_trace__: [
        {
          id: "backdrop1",
          type: "wildcard",
          status: "ok",
          writes: [{ variable: "backdrop", value: "minimal interior with linen accents" }],
        },
        {
          id: "a361dbdc",
          type: "wildcard",
          status: "ok",
          writes: [{ variable: "fabric", value: "linen" }],
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: refSnap } });
    await wrapper.findAll(".wp-dbg-tab")[2].trigger("click");
    // The ref renders as a styled `@fabric` chip (RichTextPreview's
    // shared `.wp-refchip` class), not raw `@{$fabric}` text.
    const refChips = wrapper.findAll(".wp-dbg-pick-val .wp-refchip");
    expect(refChips.length).toBe(1);
    expect(refChips[0].text()).toContain("@fabric");
    expect(refChips[0].classes()).not.toContain("wp-refchip--unresolved");
    // Surrounding plain text still present in the cell.
    expect(wrapper.find(".wp-dbg-pick-val").text()).toContain("minimal interior with");
    expect(wrapper.find(".wp-dbg-pick-val").text()).toContain("accents");
  });

  it("Picks tab unknown @{uuid} refs render with the unresolved chip variant", async () => {
    const orphanRefSnap = JSON.stringify({
      __wp_picks__: {
        m1: { value: "see @{deadbeef} stuff" },
      },
      __wp_trace__: [
        {
          id: "m1",
          type: "wildcard",
          status: "ok",
          writes: [{ variable: "x", value: "see @{deadbeef} stuff" }],
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: orphanRefSnap } });
    await wrapper.findAll(".wp-dbg-tab")[2].trigger("click");
    const refChip = wrapper.find(".wp-dbg-pick-val .wp-refchip");
    expect(refChip.exists()).toBe(true);
    expect(refChip.classes()).toContain("wp-refchip--unresolved");
    // Unresolved ref shows the uuid in the chip body.
    expect(refChip.text()).toContain("deadbeef");
  });

  it("Disabled module row shows declared $binding label, not short-uuid", async () => {
    const disabledSnap = JSON.stringify({
      __wp_trace__: [
        {
          id: "b0219910",
          type: "wildcard",
          enabled: false,
          status: "skipped_disabled",
          binding: "backdrop",
          writes: [],
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: disabledSnap } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    const labels = wrapper.findAll(".wp-dbg-trace-label");
    expect(labels[0].text()).toContain("$backdrop");
    // Row tagged with disabled class for dim + stripe.
    expect(wrapper.find(".wp-dbg-trace-row--disabled").exists()).toBe(true);
  });

  it("Disabled fixed_values surfaces every declared binding as its own row", async () => {
    const disabledMulti = JSON.stringify({
      __wp_trace__: [
        {
          id: "fv1",
          type: "fixed_values",
          enabled: false,
          status: "skipped_disabled",
          bindings: ["color", "shape", "size"],
          writes: [],
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: disabledMulti } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    const labels = wrapper.findAll(".wp-dbg-trace-label").map((l) => l.text());
    expect(labels).toEqual(["$color", "$shape", "$size"]);
  });

  it("Internal flag renders pi-globe icon next to the label", async () => {
    const intSnap = JSON.stringify({
      __wp_trace__: [
        {
          id: "m1",
          type: "wildcard",
          status: "ok",
          internal: true,
          writes: [{ variable: "scratch", value: "v" }],
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: intSnap } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    // Globe icon mirrors ContextWidget's `row-action-internal` button
    // — same glyph means the same thing across the app.
    expect(wrapper.find(".wp-dbg-trace-label .pi-globe").exists()).toBe(true);
  });

  it("Locked seed renders pi-lock icon next to the label", async () => {
    const lockedSnap = JSON.stringify({
      __wp_trace__: [
        {
          id: "m1",
          type: "wildcard",
          status: "ok",
          seed_locked: true,
          seed: 1234,
          writes: [{ variable: "x", value: "v" }],
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: lockedSnap } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    // Lock icon = "this seed is pinned/locked" — matches the
    // ContextWidget seed-lock toggle visual.
    expect(wrapper.find(".wp-dbg-trace-label .pi-lock").exists()).toBe(true);
  });

  it("Constraint row labels as $source → $target via trace lookup", async () => {
    const constraintSnap = JSON.stringify({
      __wp_trace__: [
        {
          id: "src1",
          type: "wildcard",
          status: "ok",
          writes: [{ variable: "color", value: "red" }],
        },
        {
          id: "tgt1",
          type: "wildcard",
          status: "ok",
          writes: [{ variable: "shape", value: "circle" }],
        },
        {
          id: "k1",
          type: "constraint",
          status: "ok",
          writes: [],
          constraint_source: "src1",
          constraint_target: "tgt1",
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: constraintSnap } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    const labels = wrapper.findAll(".wp-dbg-trace-label").map((l) => l.text());
    expect(labels[2]).toContain("$color → $shape");
  });

  it("Disabled module with locked_seed still shows the locked seed value", async () => {
    // Pre-fix the engine only stamped `seed: effective_seed` on
    // ok-status rows — disabled rows had no seed even when
    // `instance.locked_seed` was set. Now the static-meta extractor
    // surfaces `seed: locked_value` for any row with a numeric
    // `locked_seed`.
    const snap = JSON.stringify({
      __wp_trace__: [
        {
          id: "m1",
          type: "wildcard",
          enabled: false,
          status: "skipped_disabled",
          binding: "color",
          writes: [],
          seed_locked: true,
          seed: 99999,
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: snap } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    const seedBtn = wrapper.find(".wp-dbg-trace-seed--clickable");
    expect(seedBtn.exists()).toBe(true);
    expect(seedBtn.text()).toBe("99999");
    // Lock icon also present since `seed_locked: true`.
    expect(wrapper.find(".wp-dbg-trace-label .pi-lock").exists()).toBe(true);
  });

  it("Copy state isolated to the clicked row even when seeds are shared", async () => {
    // Two ok-status rows sharing the same chain seed — clicking the
    // first one's seed button shouldn't make the second one show
    // "✓ copied" simultaneously.
    const sharedSeedSnap = JSON.stringify({
      __wp_trace__: [
        {
          id: "m1",
          type: "wildcard",
          status: "ok",
          seed: 4242,
          writes: [{ variable: "a", value: "x" }],
        },
        {
          id: "m2",
          type: "wildcard",
          status: "ok",
          seed: 4242,
          writes: [{ variable: "b", value: "y" }],
        },
      ],
    });
    // Stub the clipboard API since jsdom doesn't ship one.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => undefined },
      writable: true,
      configurable: true,
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: sharedSeedSnap } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    const seedBtns = wrapper.findAll(".wp-dbg-trace-seed--clickable");
    expect(seedBtns.length).toBe(2);
    await seedBtns[0].trigger("click");
    // Wait a tick for the clipboard promise + ref update.
    await new Promise((r) => setTimeout(r, 10));
    // Only the clicked row gets `is-copied`, the second row still
    // reads "4242".
    expect(seedBtns[0].classes()).toContain("is-copied");
    expect(seedBtns[1].classes()).not.toContain("is-copied");
  });

  it("Constraint with unknown source/target falls back to short-uuid form", async () => {
    const constraintSnap = JSON.stringify({
      __wp_trace__: [
        {
          id: "k1",
          type: "constraint",
          status: "ok",
          writes: [],
          constraint_source: "deadbeef1",
          constraint_target: "cafebabe2",
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: constraintSnap } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    const label = wrapper.find(".wp-dbg-trace-label");
    expect(label.text()).toContain("$deadbeef → $cafebabe");
  });

  it("Constraint resolves $src→$tgt via binding-only trace entries (disabled wildcards)", async () => {
    // The lookup must also resolve wildcards whose trace entry only
    // has `binding` (no `writes[]`) — happens when the wildcard is
    // disabled, errored, or skipped before the writes loop.
    const snap = JSON.stringify({
      __wp_trace__: [
        // Source wildcard is DISABLED — only `binding` stamped, no writes.
        {
          id: "src1",
          type: "wildcard",
          enabled: false,
          status: "skipped_disabled",
          binding: "color",
          writes: [],
        },
        // Target wildcard ran ok — has both binding + writes.
        {
          id: "tgt1",
          type: "wildcard",
          status: "ok",
          binding: "shape",
          writes: [{ variable: "shape", value: "circle" }],
        },
        {
          id: "k1",
          type: "constraint",
          status: "ok",
          writes: [],
          constraint_source: "src1",
          constraint_target: "tgt1",
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: snap } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    const labels = wrapper.findAll(".wp-dbg-trace-label").map((l) => l.text());
    // Last row is the constraint — both ends resolve to $varnames.
    expect(labels[labels.length - 1]).toContain("$color → $shape");
  });

  it("Constraint trace row swaps status to 'never fired' when warning matches", async () => {
    // Engine emits `constraint_never_applied` at chain end for any
    // constraint module that registered but never claimed a downstream
    // target instance. The trace status stays "ok" (the resolve call
    // itself succeeded — the constraint just had nothing to apply to).
    // DebugViewer surfaces the no-op inline by swapping the row's
    // status pill to a "never fired" skipped pill so the user reads
    // the warning at the constraint row instead of cross-referencing
    // the Warnings tab.
    const snap = JSON.stringify({
      __wp_trace__: [
        {
          id: "src1",
          type: "wildcard",
          status: "ok",
          binding: "color",
          writes: [{ variable: "color", value: "red" }],
        },
        {
          id: "k1",
          type: "constraint",
          status: "ok",
          writes: [],
          constraint_source: "src1",
          constraint_target: "tgt1",
        },
      ],
      __wp_warnings__: [
        {
          type: "constraint_never_applied",
          severity: "warn",
          module_id: "k1",
          message: "constraint 'k1' never fired — no downstream 'tgt1' instance",
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: snap } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    const pills = wrapper.findAll(".wp-dbg-trace-pill");
    // First row is the wildcard (ok), second is the constraint
    // (would be ok pre-fix, now reads as a skipped "never fired" pill).
    expect(pills[1].text()).toBe("never fired");
    expect(pills[1].classes()).toContain("wp-dbg-trace-pill--skipped");
  });

  it("Warnings tab wraps legacy quoted-uuid messages so the chip parser resolves them", async () => {
    // Pre-2026-05-25 engine builds emitted constraint_never_applied
    // messages as `constraint 'e4b95847' never fired — no downstream
    // 'c0f09840' instance`. Newer builds emit `@{uuid}` directly, but
    // cached snapshots + Python processes that haven't restarted yet
    // still ship the apostrophe form. DebugViewer rewrites bare
    // quoted 8-hex tokens to `@{uuid}` before handing the text to
    // RichTextPreview so the user always sees chips.
    const snap = JSON.stringify({
      __wp_trace__: [
        {
          id: "e4b95847",
          type: "constraint",
          status: "ok",
          writes: [],
          constraint_source: "11112222",
          constraint_target: "c0f09840",
        },
        {
          id: "c0f09840",
          type: "wildcard",
          status: "ok",
          binding: "tgt",
          writes: [{ variable: "tgt", value: "v" }],
        },
      ],
      __wp_warnings__: [
        {
          type: "constraint_never_applied",
          severity: "warn",
          module_id: "e4b95847",
          message: "constraint 'e4b95847' never fired — no downstream 'c0f09840' instance",
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: snap } });
    await wrapper.findAll(".wp-dbg-tab")[3].trigger("click");
    const refChips = wrapper.findAll(".wp-dbg-warn-msg .wp-refchip");
    // Two chips — `'e4b95847'` and `'c0f09840'` both wrapped.
    expect(refChips.length).toBe(2);
  });

  it("Constraint trace row keeps 'ok' status when no never_applied warning matches its module_id", async () => {
    const snap = JSON.stringify({
      __wp_trace__: [
        {
          id: "k1",
          type: "constraint",
          status: "ok",
          writes: [],
          constraint_source: "src1",
          constraint_target: "tgt1",
        },
      ],
      __wp_warnings__: [
        // never_applied for a DIFFERENT constraint id — does NOT mark
        // this row as never-fired.
        {
          type: "constraint_never_applied",
          severity: "warn",
          module_id: "other-constraint-id",
          message: "constraint 'other' never fired",
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: snap } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    const pill = wrapper.find(".wp-dbg-trace-pill");
    expect(pill.text()).toBe("ok");
    expect(pill.classes()).toContain("wp-dbg-trace-pill--ok");
  });

  it("Warnings tab renders @{uuid} refs in message as @varname chips", async () => {
    // Cycle-detected warnings include the cycle path as `Cycle:
    // @{a} → @{b} → @{a}` — refs render as styled `@cycle_a` chips
    // so the user reads the cycle path in user-language.
    const cycleSnap = JSON.stringify({
      __wp_trace__: [
        {
          id: "d9cb9f0f",
          type: "wildcard",
          status: "ok",
          binding: "cycle_a",
          writes: [{ variable: "cycle_a", value: "x" }],
        },
        {
          id: "8c299ebd",
          type: "wildcard",
          status: "ok",
          binding: "cycle_b",
          writes: [{ variable: "cycle_b", value: "y" }],
        },
      ],
      __wp_warnings__: [
        {
          type: "cycle_detected",
          message: "Cycle: @{d9cb9f0f} → @{8c299ebd} → @{d9cb9f0f}",
          severity: "error",
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: cycleSnap } });
    await wrapper.findAll(".wp-dbg-tab")[3].trigger("click");
    const refChips = wrapper.findAll(".wp-dbg-warn-msg .wp-refchip");
    // Three chips — cycle_a appears twice, cycle_b once. Chip text
    // includes RichTextPreview's leading icon glyph, so assert
    // substring rather than exact match.
    expect(refChips.length).toBe(3);
    expect(refChips[0].text()).toContain("@cycle_a");
    expect(refChips[1].text()).toContain("@cycle_b");
    expect(refChips[2].text()).toContain("@cycle_a");
    // Surrounding "Cycle:" + arrows still present.
    expect(wrapper.find(".wp-dbg-warn-msg").text()).toContain("Cycle:");
    expect(wrapper.find(".wp-dbg-warn-msg").text()).toContain("→");
  });

  it("Picks tab @{uuid} resolution uses binding fallback for disabled refs", async () => {
    // A pick value referencing a disabled wildcard via @{uuid} should
    // still resolve to a `@varname` chip via the binding-only fallback.
    const snap = JSON.stringify({
      __wp_picks__: {
        m1: { value: "see @{deadbeef} bits" },
      },
      __wp_trace__: [
        {
          id: "m1",
          type: "wildcard",
          status: "ok",
          writes: [{ variable: "out", value: "see @{deadbeef} bits" }],
        },
        {
          id: "deadbeef",
          type: "wildcard",
          enabled: false,
          status: "skipped_disabled",
          binding: "fabric",
          writes: [],
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: snap } });
    await wrapper.findAll(".wp-dbg-tab")[2].trigger("click");
    const refChip = wrapper.find(".wp-dbg-pick-val .wp-refchip");
    expect(refChip.exists()).toBe(true);
    expect(refChip.text()).toContain("@fabric");
    expect(refChip.classes()).not.toContain("wp-refchip--unresolved");
  });

  it("right-click on a trace row opens the shared ContextMenu with copy actions", async () => {
    const snap = JSON.stringify({
      __wp_trace__: [
        { id: "w1", type: "wildcard", status: "ok", seed: 12345, writes: [{ variable: "myvar", value: "myvalue" }] },
      ],
    });
    const wrapper = mount(DebugViewer, {
      props: { snapshot: snap },
      attachTo: document.body,
    });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    await wrapper.find(".wp-dbg-trace-row:not(.wp-dbg-trace-row--head)").trigger("contextmenu", { clientX: 50, clientY: 50 });
    const menu = document.querySelector(".wp-ctxmenu");
    expect(menu).not.toBeNull();
    const labels = Array.from(document.querySelectorAll(".wp-ctxmenu__title")).map((n) => n.textContent);
    expect(labels).toContain("Copy value");
    expect(labels).toContain("Copy $myvar");
    expect(labels).toContain("Copy seed");
    expect(labels).toContain("Copy module id");
    wrapper.unmount();
  });

  it("Trace assigns unique run-order numbers to duplicate variables", async () => {
    // Chain pattern: two modules both write `$chain_a`. Each row
    // should get a distinct .wp-dbg-trace-seq value + a unique key.
    const snap = JSON.stringify({
      __wp_trace__: [
        { id: "m1", type: "wildcard", status: "ok", writes: [{ variable: "chain_a", value: "A→B-leaf" }] },
        { id: "m2", type: "wildcard", status: "ok", writes: [{ variable: "other",   value: "x" }] },
        { id: "m3", type: "wildcard", status: "ok", writes: [{ variable: "chain_a", value: "A-leaf-1", overwrite: true }] },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: snap } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    const seqCells = wrapper.findAll(".wp-dbg-trace-row:not(.wp-dbg-trace-row--head) .wp-dbg-trace-seq");
    expect(seqCells.map((w) => w.text())).toEqual(["1", "2", "3"]);
  });

  it("filter narrows trace rows by $var name", async () => {
    const snap = JSON.stringify({
      __wp_trace__: [
        { id: "w1", type: "wildcard", status: "ok", writes: [{ variable: "alpha", value: "a-value" }] },
        { id: "w2", type: "wildcard", status: "ok", writes: [{ variable: "beta",  value: "b-value" }] },
        { id: "w3", type: "wildcard", status: "ok", writes: [{ variable: "gamma", value: "g-value" }] },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: snap } });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    expect(wrapper.findAll(".wp-dbg-trace-row:not(.wp-dbg-trace-row--head)")).toHaveLength(3);
    const input = wrapper.find<HTMLInputElement>('[data-test="dbg-filter"]');
    await input.setValue("bet");
    const rows = wrapper.findAll(".wp-dbg-trace-row:not(.wp-dbg-trace-row--head)");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("$beta");
  });

  it("pinned trace rows stay visible even when filter would exclude them", async () => {
    const snap = JSON.stringify({
      __wp_trace__: [
        { id: "w1", type: "wildcard", status: "ok", writes: [{ variable: "alpha", value: "a" }] },
        { id: "w2", type: "wildcard", status: "ok", writes: [{ variable: "beta",  value: "b" }] },
      ],
    });
    const wrapper = mount(DebugViewer, {
      props: { snapshot: snap },
      attachTo: document.body,
    });
    await wrapper.findAll(".wp-dbg-tab")[1].trigger("click");
    // Pin alpha via the ctxmenu.
    await wrapper.findAll(".wp-dbg-trace-row:not(.wp-dbg-trace-row--head)")[0].trigger("contextmenu", { clientX: 10, clientY: 10 });
    const pinItem = Array.from(document.querySelectorAll<HTMLElement>(".wp-ctxmenu__item")).find(
      (el) => el.querySelector(".wp-ctxmenu__title")?.textContent?.startsWith("Pin"),
    );
    expect(pinItem).toBeTruthy();
    pinItem!.click();
    await wrapper.vm.$nextTick();
    // Now filter to "beta" — alpha would normally be excluded but it's pinned.
    const input = wrapper.find<HTMLInputElement>('[data-test="dbg-filter"]');
    await input.setValue("beta");
    const labels = wrapper.findAll(".wp-dbg-trace-row:not(.wp-dbg-trace-row--head) .wp-dbg-trace-label")
      .map((w) => w.text());
    expect(labels).toContain("$alpha");
    expect(labels).toContain("$beta");
    wrapper.unmount();
  });

  it("constraint_never_applied warning renders constraint id with kind-aware chip", async () => {
    // Engine wraps BOTH the constraint module's own id AND the target
    // wildcard id as `@{uuid}` in the warning text. Pre-fix the chip
    // resolver assumed every uuid was a wildcard — the constraint id
    // fell through as an unresolved red `?` chip even though the trace
    // CLEARLY identifies it as `type: "constraint"`. After the
    // moduleKind plumbing the constraint id resolves to a colored chip
    // with the constraint kind palette + pi-filter icon, while the
    // target wildcard id still resolves as a wildcard chip.
    //
    // Seed the preview-resolver cache with the constraint's library
    // entry — mirrors what happens at runtime once the lazy
    // embed-bundle fetch lands (the constraint trace doesn't carry a
    // `binding`, so the chip would otherwise stay unresolved). The
    // cache hit gives RichTextPreview a name to display AND the kind
    // so RefChip picks the constraint palette.
    _resetForTests();
    _setForTests("c0011111", { name: "exclude_rule", kind: "constraint" });
    const snap = JSON.stringify({
      __wp_trace__: [
        {
          id: "c0011111",
          type: "constraint",
          status: "ok",
          writes: [],
          constraint_source: "5a55a5a5",
          constraint_target: "deadbeef",
        },
        {
          id: "deadbeef",
          type: "wildcard",
          status: "ok",
          binding: "shape",
          writes: [{ variable: "shape", value: "circle" }],
        },
      ],
      __wp_warnings__: [
        {
          type: "constraint_never_applied",
          severity: "warn",
          module_id: "c0011111",
          message:
            "constraint @{c0011111} did not apply — no @{deadbeef} wildcard "
            + "instance or nested-ref carrier found in this chain.",
        },
      ],
    });
    const wrapper = mount(DebugViewer, { props: { snapshot: snap } });
    await wrapper.findAll(".wp-dbg-tab")[3].trigger("click");
    const chips = wrapper.findAll(".wp-dbg-warn-msg .wp-refchip");
    expect(chips).toHaveLength(2);
    // First chip is the constraint id — kind-aware chip painted with
    // the constraint tone inline + the pi-filter icon (vs the legacy
    // unresolved red `?`).
    expect(chips[0].classes()).not.toContain("wp-refchip--unresolved");
    expect(chips[0].attributes("style") ?? "").toContain("--wp-kind-constraint");
    expect(chips[0].find(".wp-refchip__icon--pi.pi-filter").exists()).toBe(true);
    // Second chip is the target wildcard — default wildcard styling
    // (no inline tone var, just the CSS fallback).
    expect(chips[1].attributes("style") ?? "").not.toContain("--wp-refchip-tone");
    expect(chips[1].classes()).not.toContain("wp-refchip--unresolved");
    expect(chips[1].text()).toContain("@shape");
    _resetForTests();
  });

  it("right-click on a pick row opens the shared ContextMenu", async () => {
    const snap = JSON.stringify({
      __wp_trace__: [
        { id: "w1", type: "wildcard", status: "ok", writes: [{ variable: "color", value: "blue" }] },
      ],
      __wp_picks__: {
        w1: { value: "blue", sub_categories: ["primary"] },
      },
    });
    const wrapper = mount(DebugViewer, {
      props: { snapshot: snap },
      attachTo: document.body,
    });
    await wrapper.findAll(".wp-dbg-tab")[2].trigger("click");
    await wrapper.find(".wp-dbg-pick-row:not(.wp-dbg-pick-row--head)").trigger("contextmenu", { clientX: 50, clientY: 50 });
    const labels = Array.from(document.querySelectorAll(".wp-ctxmenu__title")).map((n) => n.textContent);
    expect(labels).toContain("Copy value");
    expect(labels).toContain("Copy $color");
    wrapper.unmount();
  });
});
