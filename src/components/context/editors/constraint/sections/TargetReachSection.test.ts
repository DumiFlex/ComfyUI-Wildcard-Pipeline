// Constraint TargetReachSection — reach selector for the edited
// constraint's `target_select`. Segmented control first | next N | all |
// pick; `next` reveals a min-1 stepper, `pick` reveals a checklist of
// reachable downstream target occurrences (direct + nested-via-carrier)
// built from `chainModules`. Ticking a row toggles its `picks` entry.
//
// Pick identity MUST match what the engine + computePairingsFull match
// on: a direct occurrence is its target instance row's `rowKey`; a nested
// occurrence is `(carrier rowKey, option_id)`.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import TargetReachSection from "./TargetReachSection.vue";
import type { ChainModule, TargetSelect } from "../../../../../extension/constraint-pairs";

const TARGET_UUID = "ffffffff";

/** Minimal chain: a constraint, a direct downstream target instance, and
 *  a downstream carrier whose option transitively refs the same target.
 *  Ordered execution-order — the constraint sits first so both the
 *  direct + carrier rows are DOWNSTREAM of it. */
function makeChain(): ChainModule[] {
  return [
    {
      id: "cn0",
      rowKey: "1#cn0",
      type: "constraint",
      payload: { source_wildcard_id: "src0", target_wildcard_id: TARGET_UUID },
      displayName: "color-mood",
      nodeLabel: "A",
    },
    {
      id: TARGET_UUID,
      rowKey: "1#mood-a",
      type: "wildcard",
      payload: { var_binding: "mood", options: [{ id: "m0", value: "calm" }] },
      displayName: "mood",
      nodeLabel: "A",
    },
    {
      id: "carrier0",
      rowKey: "2#backdrop-b",
      type: "wildcard",
      payload: { options: [{ id: "opt_a", value: `@{${TARGET_UUID}}` }] },
      displayName: "backdrop",
      nodeLabel: "B",
    },
  ];
}

const CONSTRAINT_UID = "1#cn0";

/** Last emitted value (project TS lib predates Array.prototype.at). */
function last(xs: TargetSelect[]): TargetSelect | undefined {
  return xs[xs.length - 1];
}

function mountSection(
  modelValue: TargetSelect,
  opts: Partial<{ chainModules: ChainModule[]; targetName: string }> = {},
) {
  const updates: TargetSelect[] = [];
  const w = mount(TargetReachSection, {
    props: {
      modelValue,
      constraintUid: CONSTRAINT_UID,
      targetWildcardId: TARGET_UUID,
      targetName: opts.targetName ?? "test-target",
      chainModules: opts.chainModules ?? makeChain(),
      // Reflect emitted values back into the prop — the modal owns
      // `target_select` state, so the section re-renders from the new
      // model on every change (segmented mode reveals stepper/checklist).
      "onUpdate:modelValue": (v: TargetSelect) => {
        updates.push(v);
        void w.setProps({ modelValue: v });
      },
    },
  });
  return { w, updates };
}

describe("TargetReachSection — segmented control", () => {
  it("emits {mode:'next', count:2} after clicking 'next N' then setting the stepper to 2", async () => {
    const { w, updates } = mountSection({ mode: "all" });
    await w.find('[data-test="reach-mode-next"]').trigger("click");
    // Entering next defaults count:1.
    expect(last(updates)).toEqual({ mode: "next", count: 1 });
    await w.vm.$nextTick();
    const stepper = w.find<HTMLInputElement>('[data-test="reach-count"]');
    expect(stepper.exists()).toBe(true);
    await stepper.setValue("2");
    expect(last(updates)).toEqual({ mode: "next", count: 2 });
  });

  it("stepper ▲ button increments the count", async () => {
    const { w, updates } = mountSection({ mode: "next", count: 2 });
    await w.find('[data-test="reach-count-up"]').trigger("click");
    expect(last(updates)).toEqual({ mode: "next", count: 3 });
  });

  it("stepper ▼ button decrements the count", async () => {
    const { w, updates } = mountSection({ mode: "next", count: 3 });
    await w.find('[data-test="reach-count-down"]').trigger("click");
    expect(last(updates)).toEqual({ mode: "next", count: 2 });
  });

  it("stepper ▼ button is disabled at the minimum (count 1)", () => {
    const { w } = mountSection({ mode: "next", count: 1 });
    const down = w.find('[data-test="reach-count-down"]');
    expect(down.exists()).toBe(true);
    expect(down.attributes("disabled")).toBeDefined();
  });

  it("emits {mode:'all'} when 'all' clicked", async () => {
    const { w, updates } = mountSection({ mode: "next", count: 3 });
    await w.find('[data-test="reach-mode-all"]').trigger("click");
    expect(last(updates)).toEqual({ mode: "all" });
  });

  it("default all → no checklist + no stepper rendered (minimal)", () => {
    const { w } = mountSection({ mode: "all" });
    expect(w.find('[data-test="reach-count"]').exists()).toBe(false);
    expect(w.find('[data-test="reach-picklist"]').exists()).toBe(false);
  });
});

describe("TargetReachSection — pick checklist", () => {
  it("pick mode lists reachable instances (direct + nested), nested tagged + showing node label; ticking emits the right picks entry", async () => {
    const { w, updates } = mountSection({ mode: "pick", picks: [] });
    const list = w.find('[data-test="reach-picklist"]');
    expect(list.exists()).toBe(true);

    // Direct row for the mood instance + nested row for the backdrop carrier.
    const directRow = w.find('[data-test="reach-pick-1#mood-a"]');
    const nestedRow = w.find('[data-test="reach-pick-2#backdrop-b::opt_a"]');
    expect(directRow.exists()).toBe(true);
    expect(nestedRow.exists()).toBe(true);

    // Nested row carries the `nested` tag + the carrier's node label (B).
    expect(nestedRow.text().toLowerCase()).toContain("nested");
    expect(nestedRow.text()).toContain("B");
    // Direct row tagged `direct`.
    expect(directRow.text().toLowerCase()).toContain("direct");

    // Tick the direct row → picks gains the direct entry keyed by the
    // BARE _uid (engine identity), NOT the rowKey. The row's data-test
    // still uses the full rowKey (`1#mood-a`); the persisted uid strips
    // the `1#` node prefix → `mood-a`.
    await directRow.find(".wp-check").trigger("click");
    expect(last(updates)).toEqual({
      mode: "pick",
      picks: [{ kind: "direct", uid: "mood-a" }],
    });
  });

  it("nested row labels the @TARGET ref (display name) hosted in the carrier (display name, no @)", () => {
    const { w } = mountSection({ mode: "pick", picks: [] }, { targetName: "test-target" });
    const nestedRow = w.find('[data-test="reach-pick-2#backdrop-b::opt_a"]');
    expect(nestedRow.exists()).toBe(true);
    const txt = nestedRow.text();
    // The nested ref is `@{target}` — the `@` belongs to the TARGET, shown by
    // display name: "@test-target".
    expect(txt).toContain("@test-target");
    // Host carrier named by DISPLAY NAME, NOT @-prefixed (you don't @ the host).
    expect(txt).toContain("in backdrop");
    expect(txt).not.toContain("@backdrop");
    expect(txt).not.toContain("@subject");
  });

  it("ticking a nested row emits a nested picks entry keyed by (bare carrier _uid, option_id)", async () => {
    const { w, updates } = mountSection({ mode: "pick", picks: [] });
    await w.find('[data-test="reach-pick-2#backdrop-b::opt_a"] .wp-check').trigger("click");
    // carrier_uid is the BARE _uid (`backdrop-b`), stripped of the `2#`
    // node prefix — the engine's nested carrier_ctx stamps bare uids.
    expect(last(updates)).toEqual({
      mode: "pick",
      picks: [{ kind: "nested", carrier_uid: "backdrop-b", option_id: "opt_a" }],
    });
  });

  it("un-ticking a picked row removes its entry (bare-uid pick matches the row)", async () => {
    const { w, updates } = mountSection({
      mode: "pick",
      picks: [{ kind: "direct", uid: "mood-a" }],
    });
    await w.find('[data-test="reach-pick-1#mood-a"] .wp-check').trigger("click");
    expect(last(updates)).toEqual({ mode: "pick", picks: [] });
  });

  it("empty chainModules → empty checklist + a hint, no crash", () => {
    const { w } = mountSection({ mode: "pick", picks: [] }, { chainModules: [] });
    expect(w.find('[data-test="reach-pick-empty"]').exists()).toBe(true);
    expect(w.find('[data-test="reach-pick-1#mood-a"]').exists()).toBe(false);
  });
});
