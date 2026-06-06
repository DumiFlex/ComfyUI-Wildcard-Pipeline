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
 *
 * Phase 3 swapped dropdowns for a `wp-action-group` segmented control.
 * Engine values (`skip` / `replace` / `rename` / `accept`) stayed the
 * same; only the UI labels + click handlers shifted. Selectors below
 * target the new `data-test` hooks (`batch-action-skip` etc.) instead
 * of the old `<select>`-based ones.
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
  it("renders a CLASH badge for a type-conflict batch row", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "a" }, collisionState: "type-conflict" }),
      ],
    });
    // Per-conflict override list (with the badges) is collapsed by default.
    $('[data-test="batch-override-toggle"]').click();
    await flushPromises();
    const badge = $(`[data-test="batch-override-badge-w1"]`);
    expect(badge.textContent).toBe("CLASH");
    expect(badge.className).toContain("wp-mod-badge--clash");
    wrap.unmount();
  });

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

  it("Skip resolution replaces buttons with a ✓ Skip indicator + enables Import", async () => {
    const wrap = mountModal({
      perItemIssues: [makePerItemIssue({ entity: { id: "b1", name: "B1" } })],
    });
    $('[data-test="resolve-b1-skip"]').click();
    await flushPromises();

    // Action group buttons are gone; resolved indicator is in their place.
    expect(find('[data-test="resolve-b1-skip"]')).toBeNull();
    expect(find('[data-test="resolve-b1-accept"]')).toBeNull();
    expect(find('[data-test="resolve-group-b1"]')).toBeNull();
    const resolved = $('[data-test="resolved-b1"]');
    // Phase 3 swapped engine value display ("skip") for the user-facing
    // label ("Skip"). The check mark glyph is unchanged.
    expect(resolved.textContent).toContain("Skip");
    expect(resolved.textContent).not.toContain("skip ");
    expect(resolved.textContent).toContain("✓");

    // Import button enabled now that every per-item issue is resolved.
    const btn = $('[data-test="commit-btn"]') as HTMLButtonElement;
    expect(btn.hasAttribute("disabled")).toBe(false);
    wrap.unmount();
  });

  it("Accept resolution displays '✓ Import anyway' + enables Import for non-tier-3 issues", async () => {
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
    // Phase 3: "Import anyway" stays distinct from "Replace" because
    // the per-item issue may not be a UUID collision at all.
    expect(resolved.textContent).toContain("Import anyway");
    expect(resolved.textContent).not.toContain("accept");
    const btn = $('[data-test="commit-btn"]') as HTMLButtonElement;
    expect(btn.hasAttribute("disabled")).toBe(false);
    wrap.unmount();
  });

  it("tier-3 issues render NO Import-anyway button + NO Import-as-new button (non-overridable)", () => {
    const wrap = mountModal({
      perItemIssues: [
        makePerItemIssue({
          kind: "tier-3",
          entity: { id: "tier3item", name: "Tier3" },
        }),
      ],
    });
    // Skip stays available, but accept + rename are both suppressed.
    expect(find('[data-test="resolve-tier3item-skip"]')).not.toBeNull();
    expect(find('[data-test="resolve-tier3item-accept"]')).toBeNull();
    expect(find('[data-test="resolve-tier3item-rename"]')).toBeNull();
    // Tier-3 also does NOT use the segmented `wp-action-group` shell —
    // it's a single Skip button.
    expect(find('[data-test="resolve-group-tier3item"]')).toBeNull();
    wrap.unmount();
  });

  it("emits commit-ready with batchDefault + perItemDecisions keyed by id (engine values unchanged)", async () => {
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
    // Engine value vocabulary is unchanged — Phase 3 only relabeled the UI.
    expect(payload.batchDefault).toBe("skip");
    // Keys must be entity.id values — NOT "uuid".
    expect(Object.keys(payload.perItemDecisions).sort()).toEqual(["b1", "fp1"]);
    expect(payload.perItemDecisions.b1.kind).toBe("skip");
    expect(payload.perItemDecisions.fp1.kind).toBe("accept");
    wrap.unmount();
  });

  it("clicking the 'Replace' batch button updates batchDefault to 'replace'", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "a" } }),
      ],
      // No per-item issues so the Import button is enabled immediately.
      perItemIssues: [],
    });

    // Skip starts active by default; click Replace to flip.
    $('[data-test="batch-action-replace"]').click();
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

  it("per-row override segmented control defaults to 'Default' active for untouched rows", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "alpha" } }),
      ],
    });
    $('[data-test="batch-override-toggle"]').click();
    await flushPromises();

    const defaultBtn = $('[data-test="batch-override-w1-default"]');
    expect(defaultBtn.getAttribute("data-active")).toBe("true");
    // Other buttons are inactive.
    expect($('[data-test="batch-override-w1-skip"]').getAttribute("data-active")).toBe("false");
    expect($('[data-test="batch-override-w1-replace"]').getAttribute("data-active")).toBe("false");
    expect($('[data-test="batch-override-w1-rename"]').getAttribute("data-active")).toBe("false");
    wrap.unmount();
  });

  it("clicking 'Skip' on a per-row override writes {kind: 'skip'} to perItemDecisions", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "alpha" } }),
      ],
    });
    $('[data-test="batch-override-toggle"]').click();
    await flushPromises();

    $('[data-test="batch-override-w1-skip"]').click();
    await flushPromises();

    // Active state flipped to Skip.
    expect($('[data-test="batch-override-w1-skip"]').getAttribute("data-active")).toBe("true");
    expect($('[data-test="batch-override-w1-default"]').getAttribute("data-active")).toBe("false");

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

  it("clicking 'Replace' on a per-row override writes {kind: 'replace'} to perItemDecisions", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "alpha" } }),
      ],
    });
    $('[data-test="batch-override-toggle"]').click();
    await flushPromises();

    $('[data-test="batch-override-w1-replace"]').click();
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

  it("clicking 'Default' after a non-default removes the entry from perItemDecisions", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "alpha" } }),
      ],
    });
    $('[data-test="batch-override-toggle"]').click();
    await flushPromises();

    // First override → skip.
    $('[data-test="batch-override-w1-skip"]').click();
    await flushPromises();

    // Then revert to default.
    $('[data-test="batch-override-w1-default"]').click();
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

    $('[data-test="batch-override-w1-replace"]').click();
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

  // -------- Phase 3: segmented control structure + labels ----------------

  it("renders the batch action group with exactly 3 buttons (Skip / Replace / Import as new)", () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "a" } }),
      ],
    });

    const group = $('[data-test="batch-action-group"]');
    expect(group.getAttribute("role")).toBe("radiogroup");
    const btns = group.querySelectorAll("button");
    expect(btns.length).toBe(3);

    // Order matters — prototype shows Skip → Replace → Import as new.
    expect(btns[0]?.textContent ?? "").toContain("Skip");
    expect(btns[1]?.textContent ?? "").toContain("Replace");
    expect(btns[2]?.textContent ?? "").toContain("Import as new");

    // Initial active state is Skip (batchDefault default).
    expect($('[data-test="batch-action-skip"]').getAttribute("data-active")).toBe("true");
    expect($('[data-test="batch-action-replace"]').getAttribute("data-active")).toBe("false");
    expect($('[data-test="batch-action-rename"]').getAttribute("data-active")).toBe("false");
    wrap.unmount();
  });

  it("clicking each batch action button updates batchDefault + active state", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "a" } }),
      ],
      perItemIssues: [],
    });

    // Click Replace → only Replace active.
    $('[data-test="batch-action-replace"]').click();
    await flushPromises();
    expect($('[data-test="batch-action-replace"]').getAttribute("data-active")).toBe("true");
    expect($('[data-test="batch-action-skip"]').getAttribute("data-active")).toBe("false");
    expect($('[data-test="batch-action-rename"]').getAttribute("data-active")).toBe("false");

    // Click Import as new → only rename active.
    $('[data-test="batch-action-rename"]').click();
    await flushPromises();
    expect($('[data-test="batch-action-rename"]').getAttribute("data-active")).toBe("true");
    expect($('[data-test="batch-action-replace"]').getAttribute("data-active")).toBe("false");

    // Commit + confirm the engine value emitted is "rename" (NOT
    // "Import as new" — the engine vocabulary stays put).
    $('[data-test="commit-btn"]').click();
    await flushPromises();
    const events = wrap.emitted("commit-ready");
    const payload = events?.[0]?.[0] as { batchDefault: string };
    expect(payload?.batchDefault).toBe("rename");
    wrap.unmount();
  });

  it("renders the per-row override group with exactly 4 buttons (Default + 3 actions)", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "alpha" } }),
      ],
    });
    $('[data-test="batch-override-toggle"]').click();
    await flushPromises();

    const group = $('[data-test="batch-override-group-w1"]');
    expect(group.getAttribute("role")).toBe("radiogroup");
    const btns = group.querySelectorAll("button");
    expect(btns.length).toBe(4);

    // Order: Default → Skip → Replace → Import as new.
    expect(btns[0]?.textContent ?? "").toContain("Default");
    expect(btns[1]?.textContent ?? "").toContain("Skip");
    expect(btns[2]?.textContent ?? "").toContain("Replace");
    expect(btns[3]?.textContent ?? "").toContain("Import as new");
    wrap.unmount();
  });

  it("non-tier-3 per-item issue row renders a 3-button segmented control", () => {
    const wrap = mountModal({
      perItemIssues: [
        makePerItemIssue({
          kind: "fingerprint-mismatch",
          entity: { id: "fp1", name: "FP1" },
        }),
      ],
    });
    const group = $('[data-test="resolve-group-fp1"]');
    expect(group.getAttribute("role")).toBe("radiogroup");
    const btns = group.querySelectorAll("button");
    expect(btns.length).toBe(3);

    // Order: Skip → Import as new → Import anyway.
    expect(btns[0]?.textContent ?? "").toContain("Skip");
    expect(btns[1]?.textContent ?? "").toContain("Import as new");
    expect(btns[2]?.textContent ?? "").toContain("Import anyway");

    // Per-row hooks still exist for individual clicks.
    expect(find('[data-test="resolve-fp1-skip"]')).not.toBeNull();
    expect(find('[data-test="resolve-fp1-rename"]')).not.toBeNull();
    expect(find('[data-test="resolve-fp1-accept"]')).not.toBeNull();
    wrap.unmount();
  });

  it("tier-3 per-item row renders a single Skip button (no segmented control)", () => {
    const wrap = mountModal({
      perItemIssues: [
        makePerItemIssue({
          kind: "tier-3",
          entity: { id: "t1", name: "Tier3" },
        }),
      ],
    });
    // Skip button still present.
    expect(find('[data-test="resolve-t1-skip"]')).not.toBeNull();
    // No segmented `wp-action-group` shell, no rename/accept buttons.
    expect(find('[data-test="resolve-group-t1"]')).toBeNull();
    expect(find('[data-test="resolve-t1-accept"]')).toBeNull();
    expect(find('[data-test="resolve-t1-rename"]')).toBeNull();
    wrap.unmount();
  });

  it("does not contain old labels ('Keep mine' / 'Use theirs' / 'Keep both')", () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "alpha" } }),
      ],
      perItemIssues: [
        makePerItemIssue({
          kind: "fingerprint-mismatch",
          entity: { id: "fp1", name: "FP1" },
        }),
      ],
    });
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("Keep mine");
    expect(body).not.toContain("Use theirs");
    expect(body).not.toContain("Keep both");
    expect(body).not.toContain("Rename (keep both)");
    wrap.unmount();
  });

  it("surfaces the new Skip / Replace / Import as new labels in the batch group", () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "alpha" } }),
      ],
    });
    const group = $('[data-test="batch-action-group"]');
    const txt = group.textContent ?? "";
    expect(txt).toContain("Skip");
    expect(txt).toContain("Replace");
    expect(txt).toContain("Import as new");
    wrap.unmount();
  });

  // -------- Rename (Feature D) — kept under new labels ----------------

  it("batch 'Import as new' button is present + emits batchDefault='rename'", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "a" } }),
      ],
      perItemIssues: [],
    });
    const renameBtn = $('[data-test="batch-action-rename"]');
    expect(renameBtn.textContent).toContain("Import as new");

    renameBtn.click();
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

  it("per-row override 'Import as new' button writes {kind: 'rename'} (no new_id/new_name)", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({ id: "w1", entity: { id: "w1", name: "alpha" } }),
      ],
    });
    $('[data-test="batch-override-toggle"]').click();
    await flushPromises();

    const renameBtn = $('[data-test="batch-override-w1-rename"]');
    expect(renameBtn.textContent).toContain("Import as new");
    renameBtn.click();
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
    // per-item issues. Phase 3 must not regress that path; only the
    // button is now part of a segmented control instead of a separate
    // pill, but the click still toggles the inline rename component.
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

    // The resolved pill now reads "✓ Import as new".
    const resolved = $('[data-test="resolved-fp1"]');
    expect(resolved.textContent).toContain("Import as new");

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

  // ---------- Phase 8: modified / existing count split ----------

  it("title summary shows 'N modified' when every batch conflict has collisionState=conflict", () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({
          id: "w1",
          entity: { id: "w1", name: "a" },
          collisionState: "conflict",
        }),
        makeBatchConflict({
          id: "w2",
          entity: { id: "w2", name: "b" },
          collisionState: "conflict",
        }),
      ],
    });
    const summary = $('[data-test="conflict-modal-summary"]');
    expect(summary.textContent).toContain("2 modified");
    // No EXISTING segment when there are no exists-unknown rows.
    expect(summary.textContent).not.toMatch(/\bexisting\b/);
    wrap.unmount();
  });

  it("title summary shows 'N existing' when every batch conflict has collisionState=exists-unknown", () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({
          id: "w1",
          entity: { id: "w1", name: "a" },
          collisionState: "exists-unknown",
        }),
      ],
    });
    const summary = $('[data-test="conflict-modal-summary"]');
    // Only existing count appears — 0 modified is suppressed.
    expect(summary.textContent).toContain("1 existing");
    expect(summary.textContent).not.toMatch(/\bmodified\b/);
    wrap.unmount();
  });

  it("title summary shows BOTH 'N modified · M existing' when conflicts mix", () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({
          id: "w1",
          entity: { id: "w1", name: "a" },
          collisionState: "conflict",
        }),
        makeBatchConflict({
          id: "w2",
          entity: { id: "w2", name: "b" },
          collisionState: "exists-unknown",
        }),
        makeBatchConflict({
          id: "w3",
          entity: { id: "w3", name: "c" },
          collisionState: "exists-unknown",
        }),
      ],
    });
    const summary = $('[data-test="conflict-modal-summary"]');
    expect(summary.textContent).toContain("1 modified");
    expect(summary.textContent).toContain("2 existing");
    wrap.unmount();
  });

  it("'Batch resolution' section chip shows the split label", () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({
          id: "w1",
          entity: { id: "w1", name: "a" },
          collisionState: "conflict",
        }),
        makeBatchConflict({
          id: "w2",
          entity: { id: "w2", name: "b" },
          collisionState: "exists-unknown",
        }),
      ],
    });
    const chip = $('[data-test="conflict-modal-batch-count"]');
    expect(chip.textContent).toContain("1 modified");
    expect(chip.textContent).toContain("1 existing");
    wrap.unmount();
  });

  it("override row badge renders MODIFIED for collisionState=conflict, EXISTING for exists-unknown", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({
          id: "w1",
          entity: { id: "w1", name: "a" },
          collisionState: "conflict",
        }),
        makeBatchConflict({
          id: "w2",
          entity: { id: "w2", name: "b" },
          collisionState: "exists-unknown",
        }),
      ],
    });
    // Expand the override list so the per-row badges mount.
    $('[data-test="batch-override-toggle"]').click();
    await flushPromises();
    const badge1 = $('[data-test="batch-override-badge-w1"]');
    expect(badge1.textContent?.trim()).toBe("MODIFIED");
    expect(badge1.className).toContain("wp-mod-badge--mod");
    const badge2 = $('[data-test="batch-override-badge-w2"]');
    expect(badge2.textContent?.trim()).toBe("EXISTING");
    expect(badge2.className).toContain("wp-mod-badge--drift");
    wrap.unmount();
  });

  it("Phase 10: silent-skip conflicts render the DUPLICATE badge + add 'N duplicate' to the title summary", async () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({
          id: "w1",
          entity: { id: "w1", name: "a" },
          collisionState: "silent-skip",
        }),
        makeBatchConflict({
          id: "w2",
          entity: { id: "w2", name: "b" },
          collisionState: "silent-skip",
        }),
      ],
    });
    const summary = $('[data-test="conflict-modal-summary"]');
    expect(summary.textContent).toContain("2 duplicate");
    $('[data-test="batch-override-toggle"]').click();
    await flushPromises();
    const badge1 = $('[data-test="batch-override-badge-w1"]');
    expect(badge1.textContent?.trim()).toBe("DUPLICATE");
    expect(badge1.className).toContain("wp-mod-badge--duplicate");
    wrap.unmount();
  });

  it("Phase 10: silent-skip conflicts do NOT count toward the import button total by default", () => {
    const wrap = mountModal({
      batchConflicts: [
        makeBatchConflict({
          id: "w1",
          entity: { id: "w1", name: "a" },
          collisionState: "silent-skip",
        }),
      ],
    });
    // batchDefault stays "skip" → silent-skip dropped → 0 to import.
    expect($('[data-test="commit-btn"]').textContent).toContain("Import 0 items");
    wrap.unmount();
  });

  it("Phase 12: unselected-dep per-item issue renders REQUIRES DEP badge with amber tint + helpful detail", () => {
    const wrap = mountModal({
      batchConflicts: [],
      perItemIssues: [
        {
          kind: "unselected-dep",
          entity: { id: "b0219910", name: "backdrop", kind: "wildcard" },
          detail: {
            target: "c14e7527",
            target_name: "mood",
            targets: [{ id: "c14e7527", name: "mood" }],
          },
        },
      ],
    });
    const row = $('[data-test="conflict-modal-item-b0219910"]');
    const badge = row.querySelector(".wp-mod-badge");
    expect(badge?.textContent?.trim()).toBe("REQUIRES DEP");
    expect(badge?.className).toContain("wp-mod-badge--drift");
    expect(row.textContent).toContain("mood");
    expect(row.textContent).toContain("c14e7527");
    expect(row.textContent).toContain("NOT in your selection");
    wrap.unmount();
  });

  it("Phase 13: unselected-dep row lists every target on a single row", () => {
    const wrap = mountModal({
      batchConflicts: [],
      perItemIssues: [
        {
          kind: "unselected-dep",
          entity: { id: "b0219910", name: "backdrop", kind: "wildcard" },
          detail: {
            target: "c14e7527",
            target_name: "mood",
            targets: [
              { id: "c14e7527", name: "mood" },
              { id: "a361dbdc", name: "color" },
            ],
          },
        },
      ],
    });
    // Only ONE row for backdrop — not two.
    const rows = document.body.querySelectorAll(
      '[data-test^="conflict-modal-item-"]',
    );
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.textContent).toContain("mood");
    expect(row.textContent).toContain("color");
    expect(row.textContent).toContain("c14e7527");
    expect(row.textContent).toContain("a361dbdc");
    wrap.unmount();
  });

  it("Phase 13: unselected-dep row shows Include deps + Import anyway (no Skip / Import as new)", async () => {
    const wrap = mountModal({
      batchConflicts: [],
      perItemIssues: [
        {
          kind: "unselected-dep",
          entity: { id: "b0219910", name: "backdrop", kind: "wildcard" },
          detail: {
            target: "c14e7527",
            target_name: "mood",
            targets: [{ id: "c14e7527", name: "mood" }],
          },
        },
      ],
    });
    const group = $('[data-test="resolve-group-b0219910"]');
    const buttons = group.querySelectorAll("button");
    const labels = [...buttons].map((b) => b.textContent?.trim() ?? "");
    expect(labels.some((l) => /Include deps/i.test(l))).toBe(true);
    expect(labels.some((l) => /Import anyway/i.test(l))).toBe(true);
    expect(labels.some((l) => /^Skip$/i.test(l))).toBe(false);
    expect(labels.some((l) => /Import as new/i.test(l))).toBe(false);
    // Click Include deps → modal emits include-deps with the target ids.
    document
      .querySelector<HTMLButtonElement>(
        '[data-test="resolve-b0219910-include-deps"]',
      )!
      .click();
    await flushPromises();
    const emitted = wrap.emitted("include-deps");
    expect(emitted).toBeTruthy();
    expect(emitted![0]![0]).toEqual(["c14e7527"]);
    wrap.unmount();
  });
});
