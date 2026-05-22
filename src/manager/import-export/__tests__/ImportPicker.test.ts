import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ImportPicker from "../ImportPicker.vue";
import type { RawPayload } from "../migrations";
import type { IntegrityWarning } from "../parse";

/**
 * Test data shape: 7-bucket RawPayload with `id` (not `uuid`) as the
 * entity key, matching the server's actual export format per the
 * step-1 alignment fix.
 */
const EMPTY_BUCKETS = {
  bundles: [],
  wildcards: [],
  fixed_values: [],
  combines: [],
  derivations: [],
  constraints: [],
  categories: [],
};

function makePayload(parts: Partial<RawPayload>): RawPayload {
  return {
    schema_version: 1,
    ...EMPTY_BUCKETS,
    ...parts,
  };
}

function mountPicker(opts: {
  payload: RawPayload;
  migratedEntityCount?: number;
  integrityWarnings?: IntegrityWarning[];
}) {
  return mount(ImportPicker, {
    props: {
      payload: opts.payload,
      migratedEntityCount: opts.migratedEntityCount ?? 0,
      integrityWarnings: opts.integrityWarnings ?? [],
    },
  });
}

describe("ImportPicker.vue", () => {
  it("renders all 7 section headers with correct counts", async () => {
    const payload = makePayload({
      bundles:      [{ id: "b1", name: "B1" }],
      wildcards:    [{ id: "w1", name: "W1" }, { id: "w2", name: "W2" }],
      fixed_values: [],
      combines:     [{ id: "co1", name: "C1" }],
      derivations:  [],
      constraints:  [],
      categories:   [{ id: "cat1", name: "Cat1" }],
    });
    const wrap = mountPicker({ payload });
    await flushPromises();
    const text = wrap.text();
    expect(text).toContain("Bundles (1)");
    expect(text).toContain("Wildcards (2)");
    expect(text).toContain("Fixed values (0)");
    expect(text).toContain("Combines (1)");
    expect(text).toContain("Derivations (0)");
    expect(text).toContain("Constraints (0)");
    expect(text).toContain("Categories (1)");
  });

  it("smart-default selects the one entity when payload has exactly 1 entity", async () => {
    const payload = makePayload({
      wildcards: [{ id: "only1234", name: "lone" }],
    });
    const wrap = mountPicker({ payload });
    await flushPromises();
    // Selected count is "1 of 1".
    const summary = wrap.get('[data-test="import-picker-selected-count"]');
    expect(summary.text()).toContain("1 of 1");
    // Continue is enabled.
    const cont = wrap.get('[data-test="import-picker-continue"]');
    expect(cont.attributes("disabled")).toBeUndefined();
  });

  it("smart-default selects nothing when payload has 2+ entities", async () => {
    const payload = makePayload({
      wildcards: [{ id: "w1", name: "a" }, { id: "w2", name: "b" }],
    });
    const wrap = mountPicker({ payload });
    await flushPromises();
    const summary = wrap.get('[data-test="import-picker-selected-count"]');
    expect(summary.text()).toContain("0 of 2");
    // Continue disabled with no selection.
    const cont = wrap.get('[data-test="import-picker-continue"]');
    expect(cont.attributes("disabled")).toBeDefined();
  });

  it("toggles a row's selection when its checkbox is clicked", async () => {
    const payload = makePayload({
      wildcards: [{ id: "w1", name: "a" }, { id: "w2", name: "b" }],
    });
    const wrap = mountPicker({ payload });
    await flushPromises();
    const row = wrap.get('[data-test="import-picker-row-w1"]');
    await row.get('button[role="checkbox"]').trigger("click");
    await flushPromises();
    expect(wrap.get('[data-test="import-picker-selected-count"]').text()).toContain("1 of 2");
  });

  it("section toggle-all selects every row in that bucket", async () => {
    const payload = makePayload({
      wildcards: [
        { id: "w1", name: "a" },
        { id: "w2", name: "b" },
        { id: "w3", name: "c" },
      ],
    });
    const wrap = mountPicker({ payload });
    await flushPromises();
    // Section checkbox = the first role=checkbox inside the section header.
    const section = wrap.get('[data-test="import-picker-section-wildcards"]');
    await section.get('button[role="checkbox"]').trigger("click");
    await flushPromises();
    expect(wrap.get('[data-test="import-picker-selected-count"]').text()).toContain("3 of 3");
    // Every row checkbox now aria-checked.
    const rowCheckboxes = section.findAll('.wp-picker-row button[role="checkbox"]');
    expect(rowCheckboxes.length).toBe(3);
    for (const cb of rowCheckboxes) {
      expect(cb.attributes("aria-checked")).toBe("true");
    }
  });

  it("renders the migrated-from badge for entities with migrated_from set", async () => {
    const payload = makePayload({
      wildcards: [{ id: "w1", name: "a", migrated_from: 0 }, { id: "w2", name: "b" }],
    });
    const wrap = mountPicker({ payload, migratedEntityCount: 2 });
    await flushPromises();
    const row1 = wrap.get('[data-test="import-picker-row-w1"]');
    expect(row1.text()).toContain("migrated from v0");
    const row2 = wrap.get('[data-test="import-picker-row-w2"]');
    expect(row2.text()).not.toContain("migrated from v0");
  });

  it("renders the integrity-warning badge for entities listed in integrityWarnings", async () => {
    const payload = makePayload({
      wildcards: [{ id: "w1", name: "a" }, { id: "w2", name: "b" }],
    });
    const wrap = mountPicker({
      payload,
      integrityWarnings: [
        { id: "w1", field: "wildcard", reason: "fingerprint mismatch" },
      ],
    });
    await flushPromises();
    const row1 = wrap.get('[data-test="import-picker-row-w1"]');
    expect(row1.text()).toContain("integrity warning");
    const row2 = wrap.get('[data-test="import-picker-row-w2"]');
    expect(row2.text()).not.toContain("integrity warning");
  });

  it("shows a dep warning when a selected wildcard references an unselected id", async () => {
    const payload = makePayload({
      wildcards: [
        {
          id: "w1",
          name: "a",
          options: [{ value: "see @{deadbeef} now", weight: 1 }],
          tags: [],
        },
        { id: "deadbeef", name: "target", options: [], tags: [] },
      ],
    });
    const wrap = mountPicker({ payload });
    await flushPromises();
    // Select w1, leave deadbeef unselected. Dep warning should appear on w1's row.
    await wrap.get('[data-test="import-picker-row-w1"] button[role="checkbox"]').trigger("click");
    await flushPromises();
    const row1 = wrap.get('[data-test="import-picker-row-w1"]');
    expect(row1.text()).toContain("references @{deadbeef} not selected");
    // Once we also select deadbeef, the warning is gone.
    await wrap.get('[data-test="import-picker-row-deadbeef"] button[role="checkbox"]').trigger("click");
    await flushPromises();
    expect(wrap.get('[data-test="import-picker-row-w1"]').text()).not.toContain("references @{deadbeef} not selected");
  });

  it("Select with dependencies pulls in transitive refs from the selected seed", async () => {
    const payload = makePayload({
      wildcards: [
        {
          id: "w0000001",
          name: "seed",
          options: [{ value: "ref @{aaaa1111}", weight: 1 }],
          tags: [],
        },
        { id: "aaaa1111", name: "leaf", options: [], tags: [] },
      ],
    });
    const wrap = mountPicker({ payload });
    await flushPromises();
    // Pick the seed.
    await wrap.get('[data-test="import-picker-row-w0000001"] button[role="checkbox"]').trigger("click");
    await flushPromises();
    expect(wrap.get('[data-test="import-picker-selected-count"]').text()).toContain("1 of 2");
    // Now hit Select with dependencies.
    await wrap.get('[data-test="import-picker-select-deps"]').trigger("click");
    await flushPromises();
    expect(wrap.get('[data-test="import-picker-selected-count"]').text()).toContain("2 of 2");
    // Verify aaaa1111's row is now checked.
    const leafCb = wrap.get('[data-test="import-picker-row-aaaa1111"] button[role="checkbox"]');
    expect(leafCb.attributes("aria-checked")).toBe("true");
  });

  it("Continue button is disabled with empty selection and emits selection-ready when clicked with picks", async () => {
    const payload = makePayload({
      wildcards: [{ id: "w1", name: "a" }, { id: "w2", name: "b" }],
    });
    const wrap = mountPicker({ payload });
    await flushPromises();
    // Disabled at start (no smart-default — count is 2).
    const cont = wrap.get('[data-test="import-picker-continue"]');
    expect(cont.attributes("disabled")).toBeDefined();
    // Pick w1, then click Continue.
    await wrap.get('[data-test="import-picker-row-w1"] button[role="checkbox"]').trigger("click");
    await flushPromises();
    const cont2 = wrap.get('[data-test="import-picker-continue"]');
    expect(cont2.attributes("disabled")).toBeUndefined();
    await cont2.trigger("click");
    await flushPromises();
    const events = wrap.emitted("selection-ready");
    expect(events?.length).toBe(1);
    const payloadSet = events![0]![0] as Set<string>;
    expect(payloadSet instanceof Set).toBe(true);
    expect([...payloadSet]).toEqual(["w1"]);
  });

  it("Deselect all clears the selection", async () => {
    const payload = makePayload({
      wildcards: [{ id: "w1", name: "a" }, { id: "w2", name: "b" }],
    });
    const wrap = mountPicker({ payload });
    await flushPromises();
    // Select both.
    await wrap.get('[data-test="import-picker-row-w1"] button[role="checkbox"]').trigger("click");
    await wrap.get('[data-test="import-picker-row-w2"] button[role="checkbox"]').trigger("click");
    await flushPromises();
    expect(wrap.get('[data-test="import-picker-selected-count"]').text()).toContain("2 of 2");
    // Hit Deselect all.
    await wrap.get('[data-test="import-picker-deselect-all"]').trigger("click");
    await flushPromises();
    expect(wrap.get('[data-test="import-picker-selected-count"]').text()).toContain("0 of 2");
  });

  it("surfaces the migration note when migratedEntityCount > 0", async () => {
    const payload = makePayload({
      wildcards: [{ id: "w1", name: "a", migrated_from: 0 }],
    });
    const wrap = mountPicker({ payload, migratedEntityCount: 1 });
    await flushPromises();
    const note = wrap.get('[data-test="import-picker-migration-note"]');
    expect(note.text()).toMatch(/migrated\s+1\s+entity\s+from\s+older\s+schema/i);
  });

  it("surfaces the integrity-warning note when integrityWarnings is non-empty", async () => {
    const payload = makePayload({
      wildcards: [{ id: "w1", name: "a" }, { id: "w2", name: "b" }],
    });
    const wrap = mountPicker({
      payload,
      integrityWarnings: [
        { id: "w1", field: "wildcard", reason: "fingerprint mismatch" },
        { id: "w2", field: "wildcard", reason: "fingerprint mismatch" },
      ],
    });
    await flushPromises();
    const note = wrap.get('[data-test="import-picker-integrity-note"]');
    expect(note.text()).toMatch(/2\s+entities\s+have\s+integrity\s+warnings/i);
  });
});
