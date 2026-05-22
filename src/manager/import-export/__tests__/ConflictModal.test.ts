import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import ConflictModal from "../ConflictModal.vue";
import type { BatchConflict, PerItemIssue } from "../ConflictModal.vue";

/**
 * Helpers — small factories so each test reads as the case it covers,
 * not as a wall of prop scaffolding. `id` is the entity key everywhere
 * (per the Task 17 alignment fix); no `uuid` field is used.
 */
function makeBatchConflict(
  overrides: Partial<BatchConflict> = {},
): BatchConflict {
  return {
    kind: "wildcard",
    id: "w1",
    entity: { id: "w1", name: "x" },
    ...overrides,
  };
}

function makePerItemIssue(
  overrides: Partial<PerItemIssue> = {},
): PerItemIssue {
  return {
    kind: "broken-inner-ref",
    entity: { id: "b1", name: "B1" },
    ...overrides,
  };
}

function mountModal(opts: {
  batchConflicts?: BatchConflict[];
  perItemIssues?: PerItemIssue[];
}) {
  return mount(ConflictModal, {
    props: {
      batchConflicts: opts.batchConflicts ?? [],
      perItemIssues: opts.perItemIssues ?? [],
    },
  });
}

describe("ConflictModal.vue", () => {
  it("renders count summary with both batch + per-item counts", () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "a" } }),
        makeBatchConflict({ id: "w2", entity: { id: "w2", name: "b" } }),
      ],
      perItemIssues: [makePerItemIssue({ entity: { id: "b1", name: "B1" } })],
    });
    const summary = wrap.get('[data-test="conflict-modal-summary"]');
    expect(summary.text()).toContain("2");
    expect(summary.text()).toContain("1");
  });

  it("disables the Import button while any per-item issue is unresolved", () => {
    const wrap = mountModal({
      perItemIssues: [makePerItemIssue({ entity: { id: "b1", name: "B1" } })],
    });
    const btn = wrap.get('[data-test="commit-btn"]');
    expect(btn.attributes("disabled")).toBeDefined();
  });

  it("Skip resolution replaces buttons with a ✓ skip indicator + enables Import", async () => {
    const wrap = mountModal({
      perItemIssues: [makePerItemIssue({ entity: { id: "b1", name: "B1" } })],
    });
    await wrap.get('[data-test="resolve-b1-skip"]').trigger("click");
    await flushPromises();

    // Skip + Accept buttons are gone; resolved indicator is in their place.
    expect(wrap.find('[data-test="resolve-b1-skip"]').exists()).toBe(false);
    expect(wrap.find('[data-test="resolve-b1-accept"]').exists()).toBe(false);
    const resolved = wrap.get('[data-test="resolved-b1"]');
    expect(resolved.text()).toContain("skip");

    // Import button enabled now that every per-item issue is resolved.
    const btn = wrap.get('[data-test="commit-btn"]');
    expect(btn.attributes("disabled")).toBeUndefined();
  });

  it("Accept resolution records 'accept' + enables Import for non-tier-3 issues", async () => {
    const wrap = mountModal({
      perItemIssues: [
        makePerItemIssue({
          kind: "fingerprint-mismatch",
          entity: { id: "fp1", name: "Fingerprint" },
        }),
      ],
    });
    await wrap.get('[data-test="resolve-fp1-accept"]').trigger("click");
    await flushPromises();

    const resolved = wrap.get('[data-test="resolved-fp1"]');
    expect(resolved.text()).toContain("accept");
    const btn = wrap.get('[data-test="commit-btn"]');
    expect(btn.attributes("disabled")).toBeUndefined();
  });

  it("tier-3 issues render NO Import-anyway button (non-overridable)", () => {
    const wrap = mountModal({
      perItemIssues: [
        makePerItemIssue({
          kind: "tier-3",
          entity: { id: "tier3item", name: "Tier3" },
        }),
      ],
    });
    // Skip stays available, but the accept button is suppressed.
    expect(wrap.find('[data-test="resolve-tier3item-skip"]').exists()).toBe(true);
    expect(wrap.find('[data-test="resolve-tier3item-accept"]').exists()).toBe(false);
  });

  it("emits commit-ready with batchDefault + perItemDecisions keyed by id", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "a" } }),
      ],
      perItemIssues: [
        makePerItemIssue({
          kind: "broken-inner-ref",
          entity: { id: "b1", name: "B1" },
        }),
        makePerItemIssue({
          kind: "fingerprint-mismatch",
          entity: { id: "fp1", name: "FP1" },
        }),
      ],
    });

    // Resolve both per-item issues — one skip, one accept.
    await wrap.get('[data-test="resolve-b1-skip"]').trigger("click");
    await wrap.get('[data-test="resolve-fp1-accept"]').trigger("click");
    await flushPromises();

    await wrap.get('[data-test="commit-btn"]').trigger("click");
    await flushPromises();

    const events = wrap.emitted("commit-ready");
    expect(events).toBeTruthy();
    expect(events?.length).toBe(1);
    const firstCall = events?.[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) return;
    const payload = firstCall[0] as {
      batchDefault: "skip" | "replace";
      perItemDecisions: Record<string, { kind: string; new_name?: string }>;
    };
    expect(payload.batchDefault).toBe("skip");
    // Keys must be entity.id values — NOT "uuid".
    expect(Object.keys(payload.perItemDecisions).sort()).toEqual(["b1", "fp1"]);
    expect(payload.perItemDecisions.b1.kind).toBe("skip");
    expect(payload.perItemDecisions.fp1.kind).toBe("accept");
  });

  it("changes batchDefault when the dropdown is set to 'replace'", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "a" } }),
      ],
      // No per-item issues so the Import button is enabled immediately.
      perItemIssues: [],
    });

    const select = wrap.get('[data-test="batch-default-select"]');
    await select.setValue("replace");
    await flushPromises();

    await wrap.get('[data-test="commit-btn"]').trigger("click");
    await flushPromises();

    const events = wrap.emitted("commit-ready");
    expect(events).toBeTruthy();
    const firstCall = events?.[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) return;
    const payload = firstCall[0] as {
      batchDefault: "skip" | "replace";
      perItemDecisions: Record<string, { kind: string }>;
    };
    expect(payload.batchDefault).toBe("replace");
  });

  it("emits 'cancel' when the Cancel button is clicked", async () => {
    const wrap = mountModal({
      perItemIssues: [makePerItemIssue({ entity: { id: "b1", name: "B1" } })],
    });
    await wrap.get('[data-test="cancel-btn"]').trigger("click");
    await flushPromises();
    expect(wrap.emitted("cancel")).toBeTruthy();
    expect(wrap.emitted("commit-ready")).toBeFalsy();
  });

  it("enables Import immediately when batch-only (no per-item issues)", () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "a" } }),
        makeBatchConflict({ id: "w2", entity: { id: "w2", name: "b" } }),
      ],
      perItemIssues: [],
    });
    const btn = wrap.get('[data-test="commit-btn"]');
    expect(btn.attributes("disabled")).toBeUndefined();
  });
});
