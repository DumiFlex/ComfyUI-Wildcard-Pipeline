import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ImportPicker from "../ImportPicker.vue";
import PickerRow from "../PickerRow.vue";
import type { RawPayload } from "../migrations";
import type { IntegrityWarning } from "../parse";
import type { LibraryRow } from "../collision";
import { moduleFingerprint, type ModuleRow } from "../fingerprint";

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
  libraryRows?: Map<string, LibraryRow>;
}) {
  return mount(ImportPicker, {
    props: {
      payload: opts.payload,
      migratedEntityCount: opts.migratedEntityCount ?? 0,
      integrityWarnings: opts.integrityWarnings ?? [],
      libraryRows: opts.libraryRows,
    },
  });
}

/**
 * Polish C: sections are collapsed by default. Tests that interact with
 * rows must expand the relevant section first. Mirrors the helper in
 * ExportTab.test.ts — clicks the bare `▶ / ▼` toggle button inside the
 * section header.
 */
async function expandSection(
  wrap: ReturnType<typeof mount>,
  bucketKey: string,
): Promise<void> {
  const section = wrap.get(`[data-test="import-picker-section-${bucketKey}"]`);
  const toggle = section.get(".wp-picker-section__toggle");
  await toggle.trigger("click");
  await flushPromises();
}

/**
 * Build a minimal payload-row carrying the fields `moduleFingerprint`
 * hashes (type, name, description, tags, payload_hash) plus an id.
 * Returned as `Record<string, unknown>` so it slots directly into
 * `RawPayload.wildcards` (typed `Array<Record<string, unknown>>`) and
 * also satisfies the `ModuleRow` shape `moduleFingerprint` consumes.
 */
function mkModuleRow(
  over: Partial<ModuleRow> & { id?: string },
): Record<string, unknown> & ModuleRow & { id: string } {
  const row = {
    id: over.id ?? "x",
    type: over.type ?? "wildcard",
    name: over.name ?? "row",
    description: over.description ?? "",
    tags: over.tags ?? [],
    payload_hash: over.payload_hash ?? "h",
  };
  return row as Record<string, unknown> & ModuleRow & { id: string };
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
    await expandSection(wrap, "wildcards");
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
    // Section checkbox is in the header — clicking it does NOT expand
    // the section, it only flips selection. So we can find + click the
    // section's role=checkbox before expanding.
    const section = wrap.get('[data-test="import-picker-section-wildcards"]');
    await section.get('button[role="checkbox"]').trigger("click");
    await flushPromises();
    expect(wrap.get('[data-test="import-picker-selected-count"]').text()).toContain("3 of 3");
    // Expand to assert per-row checkbox state.
    await expandSection(wrap, "wildcards");
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
    await expandSection(wrap, "wildcards");
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
    await expandSection(wrap, "wildcards");
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
    await expandSection(wrap, "wildcards");
    // Select w1, leave deadbeef unselected. The collapsed chip surfaces
    // immediately ("1 unresolved ref"); the full warning text only shows
    // once the chip is expanded (Polish A: dep-warn disclosure).
    await wrap.get('[data-test="import-picker-row-w1"] button[role="checkbox"]').trigger("click");
    await flushPromises();
    const row1 = wrap.get('[data-test="import-picker-row-w1"]');
    expect(row1.text()).toContain("1 unresolved ref");
    await row1.get('[data-test="dep-warn-chip"]').trigger("click");
    expect(row1.text()).toContain("references @{deadbeef} not selected");
    // Once we also select deadbeef, the warning is gone — chip disappears
    // entirely (no chip rendered when depWarnings.length === 0).
    await wrap.get('[data-test="import-picker-row-deadbeef"] button[role="checkbox"]').trigger("click");
    await flushPromises();
    const row1After = wrap.get('[data-test="import-picker-row-w1"]');
    expect(row1After.find('[data-test="dep-warn-chip"]').exists()).toBe(false);
    expect(row1After.text()).not.toContain("references @{deadbeef} not selected");
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
    await expandSection(wrap, "wildcards");
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
    await expandSection(wrap, "wildcards");
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
    await expandSection(wrap, "wildcards");
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

  // Defensive-filter test: covers the belt-and-suspenders path inside the
  // picker that drops stale ids on emit. The primary fix lives in the
  // parent (ImportExport.vue applies `:key="importV2State.id"` on
  // <ImportPicker> so Vue unmount + remount on every payload swap,
  // resetting `seeded` + `selected`). This test exercise the in-picker
  // safety net by swapping `payload` via setProps (which does NOT trigger
  // a remount inside an isolated mount) and verifying the orphan id is
  // filtered out of the emit.
  it("drops stale selection ids from emit when payload swaps mid-mount", async () => {
    // Mount with a 1-entity payload — smart-default selects it.
    const wrap = mount(ImportPicker, {
      props: {
        payload: makePayload({
          wildcards: [{ id: "aaaa1111", name: "x", options: [], tags: [] }],
        }),
        migratedEntityCount: 0,
        integrityWarnings: [] as IntegrityWarning[],
      },
    });
    await flushPromises();
    // Smart-default should have selected aaaa1111.
    expect(wrap.get('[data-test="import-picker-selected-count"]').text()).toContain("1 of 1");

    // Swap to a different payload — none of the same ids. The `seeded`
    // closure-let in ImportPicker prevents the smart-default from
    // re-running, so the stale aaaa1111 selection persists in this
    // isolated mount (matching the parent-bug shape before the :key fix).
    await wrap.setProps({
      payload: makePayload({
        wildcards: [{ id: "bbbb2222", name: "y", options: [], tags: [] }],
      }),
    });
    await flushPromises();

    // Continue button should still be enabled (selection.size > 0).
    const cont = wrap.get('[data-test="import-picker-continue"]');
    expect(cont.attributes("disabled")).toBeUndefined();
    await cont.trigger("click");
    await flushPromises();

    // The defensive emit-filter must have stripped the stale id, leaving
    // nothing to emit — so selection-ready should NOT have fired.
    const emitted = wrap.emitted("selection-ready");
    expect(emitted).toBeFalsy();
  });

  it("emits selection-ready with only ids present in the current payload", async () => {
    // Boot with two entities, smart-default leave 0 selected.
    const wrap = mount(ImportPicker, {
      props: {
        payload: makePayload({
          wildcards: [
            { id: "aaaa1111", name: "x", options: [], tags: [] },
            { id: "bbbb2222", name: "y", options: [], tags: [] },
          ],
        }),
        migratedEntityCount: 0,
        integrityWarnings: [] as IntegrityWarning[],
      },
    });
    await flushPromises();
    await expandSection(wrap, "wildcards");
    // User picks both.
    await wrap.get('[data-test="import-picker-row-aaaa1111"] button[role="checkbox"]').trigger("click");
    await wrap.get('[data-test="import-picker-row-bbbb2222"] button[role="checkbox"]').trigger("click");
    await flushPromises();
    expect(wrap.get('[data-test="import-picker-selected-count"]').text()).toContain("2 of 2");

    // Swap payload mid-mount — keep only one of the previously selected ids.
    await wrap.setProps({
      payload: makePayload({
        wildcards: [{ id: "bbbb2222", name: "y", options: [], tags: [] }],
      }),
    });
    await flushPromises();

    await wrap.get('[data-test="import-picker-continue"]').trigger("click");
    await flushPromises();

    const emitted = wrap.emitted("selection-ready");
    expect(emitted).toBeTruthy();
    const ids = emitted![0]![0] as Set<string>;
    // Stale id (aaaa1111) filtered out; surviving id passes through.
    expect(ids.has("aaaa1111")).toBe(false);
    expect(ids.has("bbbb2222")).toBe(true);
    expect(ids.size).toBe(1);
  });

  // ---------- Polish C additions ----------

  it("all sections are collapsed by default", async () => {
    const payload = makePayload({
      wildcards: [{ id: "w1", name: "a" }],
      combines:  [{ id: "c1", name: "c" }],
    });
    const wrap = mountPicker({ payload });
    await flushPromises();
    // No PickerRow should be visible since every section is collapsed.
    // `findAllComponents(PickerRow)` returns only mounted (rendered) rows
    // because `<slot />` is wrapped in `<div v-if="open">` inside
    // PickerSection.vue.
    const rows = wrap.findAllComponents(PickerRow);
    expect(rows.length).toBe(0);
    // Row data-test elements should not exist either.
    expect(wrap.find('[data-test="import-picker-row-w1"]').exists()).toBe(false);
    expect(wrap.find('[data-test="import-picker-row-c1"]').exists()).toBe(false);
  });

  it("passes kind=wildcard to PickerRow for a wildcard-bucket entity", async () => {
    const payload = makePayload({
      wildcards: [{ id: "w1", name: "a" }],
    });
    const wrap = mountPicker({ payload });
    await flushPromises();
    await expandSection(wrap, "wildcards");
    const row = wrap.findAllComponents(PickerRow)[0]!;
    expect(row.props("kind")).toBe("wildcard");
  });

  it("passes kind=bundle to PickerRow for a bundle-bucket entity", async () => {
    const payload = makePayload({
      bundles: [{ id: "b1", name: "B1" }],
    });
    const wrap = mountPicker({ payload });
    await flushPromises();
    await expandSection(wrap, "bundles");
    const row = wrap.findAllComponents(PickerRow)[0]!;
    expect(row.props("kind")).toBe("bundle");
  });

  it("passes kind=category to PickerRow for a category-bucket entity", async () => {
    const payload = makePayload({
      categories: [{ id: "cat1", name: "Cat1" }],
    });
    const wrap = mountPicker({ payload });
    await flushPromises();
    await expandSection(wrap, "categories");
    const row = wrap.findAllComponents(PickerRow)[0]!;
    expect(row.props("kind")).toBe("category");
  });

  it("passes showId=true to PickerRow", async () => {
    const payload = makePayload({
      wildcards: [{ id: "abcd1234", name: "a" }],
    });
    const wrap = mountPicker({ payload });
    await flushPromises();
    await expandSection(wrap, "wildcards");
    const row = wrap.findAllComponents(PickerRow)[0]!;
    expect(row.props("showId")).toBe(true);
  });

  it("resolves categoryName + categoryColor from the payload's categories bucket", async () => {
    const payload = makePayload({
      wildcards: [{ id: "w1", name: "a", category_id: "cat1" }],
      categories: [{ id: "cat1", name: "Cat1", color: "#abcdef" }],
    });
    const wrap = mountPicker({ payload });
    await flushPromises();
    await expandSection(wrap, "wildcards");
    const row = wrap.findAllComponents(PickerRow).find(
      (r) => r.props("uuid") === "w1",
    );
    expect(row).toBeDefined();
    expect(row!.props("categoryName")).toBe("Cat1");
    expect(row!.props("categoryColor")).toBe("#abcdef");
  });

  it("omits category data when entity carries no category_id", async () => {
    const payload = makePayload({
      wildcards: [{ id: "w1", name: "a" }],
      categories: [{ id: "cat1", name: "Cat1" }],
    });
    const wrap = mountPicker({ payload });
    await flushPromises();
    await expandSection(wrap, "wildcards");
    const row = wrap.findAllComponents(PickerRow)[0]!;
    expect(row.props("categoryName")).toBeUndefined();
    expect(row.props("categoryColor")).toBeUndefined();
  });

  it("adds a conflict badge when libraryRows carries a different fingerprint for a wildcard", async () => {
    // Incoming wildcard fingerprint vs different library fingerprint.
    const incoming = mkModuleRow({
      id: "w1", name: "a", type: "wildcard",
      payload_hash: "incoming-hash",
    });
    const libraryFp = moduleFingerprint(
      mkModuleRow({ name: "a", type: "wildcard", payload_hash: "different-hash" }),
    );
    const wrap = mountPicker({
      payload: makePayload({
        wildcards: [incoming],
      }),
      libraryRows: new Map([
        ["w1", { snapshot_fingerprint: libraryFp }],
      ]),
    });
    await flushPromises();
    await expandSection(wrap, "wildcards");
    const row = wrap.findAllComponents(PickerRow)[0]!;
    const badges = row.props("badges") as Array<{ label: string; kind: string }>;
    const conflictBadge = badges.find((b) => b.label === "conflict");
    expect(conflictBadge).toBeDefined();
    expect(conflictBadge!.kind).toBe("warn");
  });

  it("does NOT add a conflict badge when libraryRows lacks the entity id", async () => {
    const wrap = mountPicker({
      payload: makePayload({
        wildcards: [mkModuleRow({ id: "w1", name: "a" })],
      }),
      libraryRows: new Map(), // empty
    });
    await flushPromises();
    await expandSection(wrap, "wildcards");
    const row = wrap.findAllComponents(PickerRow)[0]!;
    const badges = row.props("badges") as Array<{ label: string; kind: string }>;
    expect(badges.find((b) => b.label === "conflict")).toBeUndefined();
  });

  it("does NOT add a conflict badge for silent-skip (matching fingerprint)", async () => {
    // Identical fingerprint on both sides → silent-skip → no inline badge
    // (entity will be auto-excluded at commit-time anyway).
    const incoming = mkModuleRow({
      id: "w1", name: "a", type: "wildcard",
      payload_hash: "same-hash",
    });
    const fp = moduleFingerprint(incoming);
    const wrap = mountPicker({
      payload: makePayload({
        wildcards: [incoming],
      }),
      libraryRows: new Map([
        ["w1", { snapshot_fingerprint: fp }],
      ]),
    });
    await flushPromises();
    await expandSection(wrap, "wildcards");
    const row = wrap.findAllComponents(PickerRow)[0]!;
    const badges = row.props("badges") as Array<{ label: string; kind: string }>;
    expect(badges.find((b) => b.label === "conflict")).toBeUndefined();
  });

  it("computes no collision states when libraryRows prop is absent", async () => {
    // No `libraryRows` passed — picker falls back to empty record so
    // no conflict badges land on any row.
    const wrap = mountPicker({
      payload: makePayload({
        wildcards: [mkModuleRow({ id: "w1", name: "a" })],
      }),
    });
    await flushPromises();
    await expandSection(wrap, "wildcards");
    const row = wrap.findAllComponents(PickerRow)[0]!;
    const badges = row.props("badges") as Array<{ label: string; kind: string }>;
    expect(badges.find((b) => b.label === "conflict")).toBeUndefined();
  });

  it("adds a conflict badge for a bundle when libraryRows contains its id (presence-only check)", async () => {
    // Bundles use id-presence (not fingerprint) for the inline badge.
    const wrap = mountPicker({
      payload: makePayload({
        bundles: [{ id: "b1", name: "B1" }],
      }),
      libraryRows: new Map([
        ["b1", { snapshot_fingerprint: undefined }],
      ]),
    });
    await flushPromises();
    await expandSection(wrap, "bundles");
    const row = wrap.findAllComponents(PickerRow)[0]!;
    const badges = row.props("badges") as Array<{ label: string; kind: string }>;
    expect(badges.find((b) => b.label === "conflict")).toBeDefined();
  });

  it("never adds a conflict badge to a category row even when libraryRows has its id", async () => {
    // Categories merge by name; id-presence in libraryRows is irrelevant.
    const wrap = mountPicker({
      payload: makePayload({
        categories: [{ id: "cat1", name: "Cat1" }],
      }),
      libraryRows: new Map([
        ["cat1", { snapshot_fingerprint: "anything" }],
      ]),
    });
    await flushPromises();
    await expandSection(wrap, "categories");
    const row = wrap.findAllComponents(PickerRow)[0]!;
    const badges = row.props("badges") as Array<{ label: string; kind: string }>;
    expect(badges.find((b) => b.label === "conflict")).toBeUndefined();
  });
});
