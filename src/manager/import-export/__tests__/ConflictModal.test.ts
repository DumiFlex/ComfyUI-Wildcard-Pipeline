import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import ConflictModal from "../ConflictModal.vue";
import type { BatchConflict, PerItemIssue } from "../conflict-types";

/**
 * Helpers — small factories so each test reads as the case it covers,
 * not as a wall of prop scaffolding. `id` is the entity key everywhere
 * (per the Task 17 alignment fix); no `uuid` field is used.
 *
 * The modal now teleports through the shared `Modal.vue` wrapper to
 * `document.body`, so DOM-level selectors must look at the body, not
 * the mount root. The `wrap.emitted(...)` API still works because Vue
 * Test Utils tracks emits on the wrapper regardless of where the DOM
 * actually rendered.
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
    attachTo: document.body,
  });
}

/** Body-level selector helper — every interactive node lives there. */
function $(selector: string): HTMLElement {
  const el = document.body.querySelector(selector);
  if (!el) throw new Error(`selector not found: ${selector}`);
  return el as HTMLElement;
}

function find(selector: string): HTMLElement | null {
  return document.body.querySelector(selector) as HTMLElement | null;
}

afterEach(() => {
  // Teleported DOM doesn't auto-clean between tests — remove any
  // leftover modal nodes so the next test starts with a clean body.
  for (const node of Array.from(document.body.children)) {
    node.remove();
  }
});

describe("ConflictModal.vue", () => {
  it("renders count summary with both batch + per-item counts", () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "a" } }),
        makeBatchConflict({ id: "w2", entity: { id: "w2", name: "b" } }),
      ],
      perItemIssues: [makePerItemIssue({ entity: { id: "b1", name: "B1" } })],
    });
    const summary = $('[data-test="conflict-modal-summary"]');
    expect(summary.textContent).toContain("2");
    expect(summary.textContent).toContain("1");
    wrap.unmount();
  });

  it("disables the Import button while any per-item issue is unresolved", () => {
    const wrap = mountModal({
      perItemIssues: [makePerItemIssue({ entity: { id: "b1", name: "B1" } })],
    });
    const btn = $('[data-test="commit-btn"]') as HTMLButtonElement;
    expect(btn.hasAttribute("disabled")).toBe(true);
    wrap.unmount();
  });

  it("Skip resolution replaces buttons with a check skip indicator + enables Import", async () => {
    const wrap = mountModal({
      perItemIssues: [makePerItemIssue({ entity: { id: "b1", name: "B1" } })],
    });
    $('[data-test="resolve-b1-skip"]').click();
    await flushPromises();

    // Skip + Accept buttons are gone; resolved indicator is in their place.
    expect(find('[data-test="resolve-b1-skip"]')).toBeNull();
    expect(find('[data-test="resolve-b1-accept"]')).toBeNull();
    const resolved = $('[data-test="resolved-b1"]');
    expect(resolved.textContent).toContain("skip");

    // Import button enabled now that every per-item issue is resolved.
    const btn = $('[data-test="commit-btn"]') as HTMLButtonElement;
    expect(btn.hasAttribute("disabled")).toBe(false);
    wrap.unmount();
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
    $('[data-test="resolve-fp1-accept"]').click();
    await flushPromises();

    const resolved = $('[data-test="resolved-fp1"]');
    expect(resolved.textContent).toContain("accept");
    const btn = $('[data-test="commit-btn"]') as HTMLButtonElement;
    expect(btn.hasAttribute("disabled")).toBe(false);
    wrap.unmount();
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
    expect(find('[data-test="resolve-tier3item-skip"]')).not.toBeNull();
    expect(find('[data-test="resolve-tier3item-accept"]')).toBeNull();
    wrap.unmount();
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
    $('[data-test="resolve-b1-skip"]').click();
    $('[data-test="resolve-fp1-accept"]').click();
    await flushPromises();

    $('[data-test="commit-btn"]').click();
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
    wrap.unmount();
  });

  it("changes batchDefault when the dropdown is set to 'replace'", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "a" } }),
      ],
      // No per-item issues so the Import button is enabled immediately.
      perItemIssues: [],
    });

    const select = $('[data-test="batch-default-select"]') as HTMLSelectElement;
    select.value = "replace";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();

    $('[data-test="commit-btn"]').click();
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
    wrap.unmount();
  });

  it("emits 'cancel' when the Cancel button is clicked", async () => {
    const wrap = mountModal({
      perItemIssues: [makePerItemIssue({ entity: { id: "b1", name: "B1" } })],
    });
    $('[data-test="cancel-btn"]').click();
    await flushPromises();
    expect(wrap.emitted("cancel")).toBeTruthy();
    expect(wrap.emitted("commit-ready")).toBeFalsy();
    wrap.unmount();
  });

  it("enables Import immediately when batch-only (no per-item issues)", () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "a" } }),
        makeBatchConflict({ id: "w2", entity: { id: "w2", name: "b" } }),
      ],
      perItemIssues: [],
    });
    const btn = $('[data-test="commit-btn"]') as HTMLButtonElement;
    expect(btn.hasAttribute("disabled")).toBe(false);
    wrap.unmount();
  });

  // -------- Per-item batch override expandable list (Item 2) ------------

  it("batch override list is collapsed by default + toggle label reads 'Show'", () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "a" } }),
        makeBatchConflict({ id: "w2", entity: { id: "w2", name: "b" } }),
      ],
    });
    // The toggle button is visible, but the list itself is not yet
    // rendered (v-if).
    const toggle = $('[data-test="batch-override-toggle"]');
    expect(toggle.textContent ?? "").toMatch(/show/i);
    expect(find('[data-test="batch-override-list"]')).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    wrap.unmount();
  });

  it("clicking the toggle reveals one row per batch conflict", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "alpha" } }),
        makeBatchConflict({ id: "w2", entity: { id: "w2", name: "beta" } }),
      ],
    });
    $('[data-test="batch-override-toggle"]').click();
    await flushPromises();

    const list = $('[data-test="batch-override-list"]');
    expect(list).not.toBeNull();
    // Each row carries its own data-test handle so per-row state can
    // be poked from tests without DOM ordering assumptions.
    expect(find('[data-test="batch-override-row-w1"]')).not.toBeNull();
    expect(find('[data-test="batch-override-row-w2"]')).not.toBeNull();
    // Toggle label flips after expansion.
    const toggle = $('[data-test="batch-override-toggle"]');
    expect(toggle.textContent ?? "").toMatch(/hide/i);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    wrap.unmount();
  });

  it("per-row override dropdown defaults to 'default' for untouched rows", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "alpha" } }),
      ],
    });
    $('[data-test="batch-override-toggle"]').click();
    await flushPromises();

    const select = $('[data-test="batch-override-select-w1"]') as HTMLSelectElement;
    expect(select.value).toBe("default");
    wrap.unmount();
  });

  it("picking 'skip' on a row writes {kind: 'skip'} to perItemDecisions", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "alpha" } }),
      ],
    });
    $('[data-test="batch-override-toggle"]').click();
    await flushPromises();

    const select = $('[data-test="batch-override-select-w1"]') as HTMLSelectElement;
    select.value = "skip";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();

    $('[data-test="commit-btn"]').click();
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
    expect(payload.perItemDecisions.w1).toEqual({ kind: "skip" });
    wrap.unmount();
  });

  it("picking 'replace' on a row writes {kind: 'replace'} to perItemDecisions", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "alpha" } }),
      ],
    });
    $('[data-test="batch-override-toggle"]').click();
    await flushPromises();

    const select = $('[data-test="batch-override-select-w1"]') as HTMLSelectElement;
    select.value = "replace";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();

    $('[data-test="commit-btn"]').click();
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
    expect(payload.perItemDecisions.w1).toEqual({ kind: "replace" });
    wrap.unmount();
  });

  it("picking 'default' after a non-default removes the entry from perItemDecisions", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "alpha" } }),
      ],
    });
    $('[data-test="batch-override-toggle"]').click();
    await flushPromises();

    const select = $('[data-test="batch-override-select-w1"]') as HTMLSelectElement;
    // First override → skip.
    select.value = "skip";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();

    // Then revert to default.
    select.value = "default";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();

    // Commit + assert the entry is GONE from perItemDecisions (not
    // present as `{kind: "default"}` or any sentinel).
    $('[data-test="commit-btn"]').click();
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
    expect(payload.perItemDecisions.w1).toBeUndefined();
    expect(Object.keys(payload.perItemDecisions)).toEqual([]);
    wrap.unmount();
  });

  it("per-row override + batch default combine cleanly in the commit-ready emit", async () => {
    // batchDefault = "skip", but row w1 overridden to "replace".
    // Orchestrator at commit time resolves precedence (perItemDecisions
    // wins for id w1); the modal just emits both pieces of state.
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "alpha" } }),
        makeBatchConflict({ id: "w2", entity: { id: "w2", name: "beta" } }),
      ],
    });
    // Batch default stays "skip" (initial state).
    $('[data-test="batch-override-toggle"]').click();
    await flushPromises();

    const select = $('[data-test="batch-override-select-w1"]') as HTMLSelectElement;
    select.value = "replace";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();

    $('[data-test="commit-btn"]').click();
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
    expect(payload.batchDefault).toBe("skip");
    expect(payload.perItemDecisions.w1).toEqual({ kind: "replace" });
    // w2 was not touched, so it must NOT appear in perItemDecisions —
    // the orchestrator should fall through to batchDefault for it.
    expect(payload.perItemDecisions.w2).toBeUndefined();
    wrap.unmount();
  });

  // -------- Rename (keep both) — Feature D ---------------------------

  it("batch default dropdown includes the 'Rename (keep both)' option", () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "a" } }),
      ],
    });
    const select = $('[data-test="batch-default-select"]') as HTMLSelectElement;
    const renameOpt = Array.from(select.options).find((o) => o.value === "rename");
    expect(renameOpt).toBeDefined();
    expect(renameOpt?.textContent ?? "").toContain("Rename (keep both)");
    wrap.unmount();
  });

  it("batch default 'rename' emits commit-ready with batchDefault='rename'", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "a" } }),
      ],
      perItemIssues: [],
    });

    const select = $('[data-test="batch-default-select"]') as HTMLSelectElement;
    select.value = "rename";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();

    $('[data-test="commit-btn"]').click();
    await flushPromises();

    const events = wrap.emitted("commit-ready");
    expect(events).toBeTruthy();
    const firstCall = events?.[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) return;
    const payload = firstCall[0] as {
      batchDefault: "skip" | "replace" | "rename";
      perItemDecisions: Record<string, { kind: string }>;
    };
    expect(payload.batchDefault).toBe("rename");
    // Batch-default rename leaves perItemDecisions empty — the
    // orchestrator mints id + name suffix at commit time.
    expect(Object.keys(payload.perItemDecisions)).toEqual([]);
    wrap.unmount();
  });

  it("per-row override dropdown includes the 'Rename (keep both)' option", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "alpha" } }),
      ],
    });
    $('[data-test="batch-override-toggle"]').click();
    await flushPromises();

    const select = $('[data-test="batch-override-select-w1"]') as HTMLSelectElement;
    const renameOpt = Array.from(select.options).find((o) => o.value === "rename");
    expect(renameOpt).toBeDefined();
    expect(renameOpt?.textContent ?? "").toContain("Rename (keep both)");
    wrap.unmount();
  });

  it("per-row override 'rename' writes {kind: 'rename'} (no new_id/new_name)", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "alpha" } }),
      ],
    });
    $('[data-test="batch-override-toggle"]').click();
    await flushPromises();

    const select = $('[data-test="batch-override-select-w1"]') as HTMLSelectElement;
    select.value = "rename";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();

    $('[data-test="commit-btn"]').click();
    await flushPromises();

    const events = wrap.emitted("commit-ready");
    expect(events).toBeTruthy();
    const firstCall = events?.[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) return;
    const payload = firstCall[0] as {
      batchDefault: "skip" | "replace" | "rename";
      perItemDecisions: Record<string, {
        kind: string;
        new_id?: string;
        new_name?: string;
      }>;
    };
    // Compact override path — orchestrator mints new_id + new_name; the
    // modal does NOT pre-populate them. Strict equality on the shape
    // keeps the contract honest.
    expect(payload.perItemDecisions.w1).toEqual({ kind: "rename" });
    expect(payload.perItemDecisions.w1?.new_id).toBeUndefined();
    expect(payload.perItemDecisions.w1?.new_name).toBeUndefined();
    wrap.unmount();
  });

  it("per-item issue 'Import as new' button still surfaces the inline rename UI (Task 20 path)", async () => {
    // Regression check — Task 20 wired ImportAsNewRename for non-tier-3
    // per-item issues. Feature D must not regress that path.
    const wrap = mountModal({
      perItemIssues: [
        makePerItemIssue({
          kind: "fingerprint-mismatch",
          entity: { id: "fp1", name: "FP1" },
        }),
      ],
    });
    // The "Import as new" button on the issue row toggles the inline
    // rename component (NOT a per-row dropdown — that's the batch
    // override surface).
    $('[data-test="resolve-fp1-rename"]').click();
    await flushPromises();
    expect(find('[data-test="rename-row"]')).not.toBeNull();
    expect(find('[data-test="rename-input"]')).not.toBeNull();
    expect(find('[data-test="rename-confirm"]')).not.toBeNull();

    // Confirming writes the {kind, new_id, new_name} triple via the
    // existing onRenameApplied path.
    $('[data-test="rename-confirm"]').click();
    await flushPromises();

    $('[data-test="commit-btn"]').click();
    await flushPromises();

    const events = wrap.emitted("commit-ready");
    expect(events).toBeTruthy();
    const firstCall = events?.[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) return;
    const payload = firstCall[0] as {
      batchDefault: "skip" | "replace" | "rename";
      perItemDecisions: Record<string, {
        kind: string;
        new_id?: string;
        new_name?: string;
      }>;
    };
    expect(payload.perItemDecisions.fp1?.kind).toBe("rename");
    // Inline UI populated both fields — orchestrator uses them verbatim.
    expect(typeof payload.perItemDecisions.fp1?.new_id).toBe("string");
    expect(payload.perItemDecisions.fp1?.new_id?.length).toBe(8);
    expect(payload.perItemDecisions.fp1?.new_name).toContain("FP1");
    wrap.unmount();
  });

  // -------- Accessibility floor (Modal wrapper contract) -----------------

  it("renders the modal with role='dialog' and aria-modal='true'", () => {
    const wrap = mountModal({
      perItemIssues: [makePerItemIssue({ entity: { id: "b1", name: "B1" } })],
    });
    const dialog = $('.wp-modal[role="dialog"]');
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    wrap.unmount();
  });

  it("teleports the modal to document.body (Modal wrapper contract)", () => {
    const wrap = mountModal({
      perItemIssues: [makePerItemIssue({ entity: { id: "b1", name: "B1" } })],
    });
    // Backdrop sits as a direct descendant of <body>, NOT inside the
    // test wrapper's mount root.
    expect(document.body.querySelector('[data-test="modal-backdrop"]')).not.toBeNull();
    wrap.unmount();
  });

  it("Esc keypress emits cancel + closes the modal via update:open", async () => {
    const wrap = mountModal({
      perItemIssues: [makePerItemIssue({ entity: { id: "b1", name: "B1" } })],
    });
    // The shared Modal listens on window for Escape.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(wrap.emitted("cancel")).toBeTruthy();
    expect(wrap.emitted("update:open")?.[0]).toEqual([false]);
    wrap.unmount();
  });
});
