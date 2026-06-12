import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => {
  // ApiError mock that mirrors the real shape so the orchestrator's
  // `instanceof ApiError` branch (status + message) works under test.
  class ApiError extends Error {
    public status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return {
    api: {
      modules: { list: vi.fn() },
      categories: { list: vi.fn() },
      bundles: { list: vi.fn() },
      templates: { list: vi.fn() },
      importExport: {
        build: vi.fn(),
        commit: vi.fn(),
        undo: vi.fn(),
      },
    },
    ApiError,
  };
});

import { api } from "../api/client";
import ImportExport from "../views/ImportExport.vue";
import ConflictModal from "../import-export/ConflictModal.vue";
import ImportPicker from "../import-export/ImportPicker.vue";
import { useResolveWarnings } from "../composables/useResolveWarnings";
import { useToast } from "../composables/useToast";
import type { ModuleRow } from "../api/types";
import type { CommitPayload, CommitOk } from "../import-export/commit";
import type { PerItemIssue } from "../import-export/conflict-types";

interface MockedApi {
  modules: { list: ReturnType<typeof vi.fn> };
  categories: { list: ReturnType<typeof vi.fn> };
  bundles: { list: ReturnType<typeof vi.fn> };
  templates: { list: ReturnType<typeof vi.fn> };
  importExport: {
    commit: ReturnType<typeof vi.fn>;
    undo: ReturnType<typeof vi.fn>;
    build: ReturnType<typeof vi.fn>;
  };
}
const apiM = api as unknown as MockedApi;

function mkModule(over: Partial<ModuleRow>): ModuleRow {
  return {
    id: "aabbccdd",
    type: "wildcard",
    name: "Sample",
    description: "",
    category_id: null,
    tags: [],
    is_favorite: false,
    payload: { options: [], sub_categories: [] },
    payload_hash: "0".repeat(64),
    version: 1,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...over,
  };
}

/**
 * Minimal v1 export payload — `parsePayload` requires every bucket as a
 * (possibly empty) array. Module rows include payload_hash for the
 * fingerprint pipeline.
 */
function mkPayload(over: Partial<Record<string, unknown>> = {}) {
  return {
    schema_version: 1,
    bundles: [],
    wildcards: [],
    fixed_values: [],
    combines: [],
    derivations: [],
    constraints: [],
    categories: [],
    templates: [],
    ...over,
  };
}

function mkWildcardEntity(id: string, options: Array<{ value: string; weight?: number }> = []) {
  return {
    id,
    type: "wildcard",
    name: `wc_${id}`,
    description: "",
    tags: [],
    payload_hash: "0".repeat(64),
    options,
  };
}

/**
 * Constraint entity in raw-payload (import-side) shape: source/target ids
 * live under `payload` (matches `engine.modules.constraint`; see
 * dep-graph.ts:83 + extractWildcardsAndConstraints in ImportExport.vue).
 * Used by the rename-follow-through case below.
 */
function mkConstraintEntity(id: string, sourceId: string, targetId: string) {
  return {
    id,
    type: "constraint",
    name: `con_${id}`,
    description: "",
    tags: [],
    payload_hash: "0".repeat(64),
    payload: {
      source_wildcard_id: sourceId,
      target_wildcard_id: targetId,
      matrix: {},
    },
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  apiM.modules.list.mockReset();
  apiM.categories.list.mockReset();
  apiM.bundles.list.mockReset();
  apiM.templates.list.mockReset();
  apiM.importExport.commit.mockReset();
  apiM.importExport.undo.mockReset();
  apiM.modules.list.mockResolvedValue({ items: [], total: 0 });
  apiM.categories.list.mockResolvedValue({ items: [] });
  apiM.bundles.list.mockResolvedValue({ items: [], total: 0 });
  apiM.templates.list.mockResolvedValue({ items: [], total: 0 });
  useResolveWarnings().clearAll();
  // Phase 9: Continue gating uses window.confirm when selected rows have
  // unresolvable deps. jsdom doesn't implement confirm → stub it to
  // accept by default so the orchestrator pipeline continues past the
  // picker. Individual tests can re-stub if they need to assert the
  // confirm call signature.
  vi.spyOn(window, "confirm").mockReturnValue(true);
  // Wipe any toasts left from a prior test.
  const t = useToast();
  while (t.toasts.value.length > 0) {
    const first = t.toasts.value[0];
    if (!first) break;
    t.dismiss(first.id);
  }
});
afterEach(() => {
  vi.clearAllMocks();
  // Modal Teleports to body — purge any leftover modal DOM so it can't
  // poison the next test's queries. Replace child nodes one-by-one
  // rather than setting innerHTML (lint rule blocks innerHTML even
  // with empty strings).
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

function mountView() {
  return mount(ImportExport, { global: { plugins: [] } });
}

/**
 * Drive the import pipeline up to `selection-ready`:
 *   1. Switch to import tab.
 *   2. Open paste pane + type a JSON payload + click Parse → fires
 *      ImportTab's `payload-ready`.
 *   3. Pick rows (defaults preselect when payload has exactly one entity).
 *   4. Click `Continue` → fires ImportPicker's `selection-ready`.
 *
 * Returns the mounted wrap so the caller can keep asserting.
 */
async function feedPayloadAndContinue(
  wrap: ReturnType<typeof mountView>,
  payload: Record<string, unknown>,
): Promise<void> {
  await wrap.find('[data-test="io-tab-import"]').trigger("click");
  await flushPromises();
  await wrap.find('[data-test="import-paste-btn"]').trigger("click");
  await flushPromises();
  await wrap.find('[data-test="import-paste-textarea"]').setValue(JSON.stringify(payload));
  await wrap.find('[data-test="import-paste-confirm"]').trigger("click");
  await flushPromises();
  // Picker auto-selects the single-entity payload. Continue.
  const cont = wrap.find('[data-test="import-picker-continue"]');
  await cont.trigger("click");
  await flushPromises();
}

/** Same as feedPayloadAndContinue but skips the picker's smart-default
 *  by emitting selection-ready directly with the caller-chosen ids.
 *  Lets a test target the orchestrator with a partial selection in
 *  multi-entity payloads (where the auto-select-everything default
 *  would hide the unselected-dep code path). */
async function feedPayloadAndContinueWithIds(
  wrap: ReturnType<typeof mountView>,
  payload: Record<string, unknown>,
  ids: Set<string>,
): Promise<void> {
  await wrap.find('[data-test="io-tab-import"]').trigger("click");
  await flushPromises();
  await wrap.find('[data-test="import-paste-btn"]').trigger("click");
  await flushPromises();
  await wrap.find('[data-test="import-paste-textarea"]').setValue(JSON.stringify(payload));
  await wrap.find('[data-test="import-paste-confirm"]').trigger("click");
  await flushPromises();
  const picker = wrap.findComponent(ImportPicker);
  if (!picker.exists()) throw new Error("ImportPicker not mounted");
  picker.vm.$emit("selection-ready", ids);
  await flushPromises();
}

describe("ImportExport.vue — commit orchestrator", () => {
  it("no conflicts → direct commit with correct payload + success toast + state cleared", async () => {
    apiM.importExport.commit.mockResolvedValue({
      ok: true,
      undo_entry_id: "undo_1",
      summary: { added: 1, replaced: 0, renamed: 0 },
    } satisfies CommitOk);
    const wrap = mountView();
    await flushPromises();
    await feedPayloadAndContinue(wrap, mkPayload({
      wildcards: [mkWildcardEntity("11111111")],
    }));
    expect(apiM.importExport.commit).toHaveBeenCalledTimes(1);
    const firstCall = apiM.importExport.commit.mock.calls[0];
    if (!firstCall) throw new Error("commit was not called");
    const payload = firstCall[0] as CommitPayload;
    expect(payload.adds.length).toBe(1);
    expect(payload.adds[0]?.kind).toBe("wildcard");
    expect(payload.adds[0]?.entity.id).toBe("11111111");
    expect(payload.replaces.length).toBe(0);
    expect(payload.renames.length).toBe(0);
    // Success toast was pushed with Undo action.
    const t = useToast();
    const succ = t.toasts.value.find((x) => x.severity === "success");
    expect(succ).toBeTruthy();
    expect(succ?.action?.label).toBe("Undo");
    // Phase 15: orchestrator refreshes module + bundle catalogs so the
    // sidebar's count badges update live (the stores power Wildcards/N
    // etc. in AppSidebar). Two calls per route — once on mount when the
    // module list is also loaded, once after commit. Assert ≥ 1.
    expect(apiM.modules.list.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(apiM.bundles.list.mock.calls.length).toBeGreaterThanOrEqual(2);
    // State cleared — stash element no longer rendered.
    expect(wrap.find('[data-test="io-import-stash"]').exists()).toBe(false);
  });

  it("conflicts → ConflictModal opens, commit deferred until commit-ready", async () => {
    // Pre-seed library with a wildcard whose fingerprint is null (no
    // snapshot_fingerprint exposed in the typed ModuleRow). The collision
    // detector marks library rows missing the fingerprint as `conflict`,
    // so the picker selection generates one BatchConflict.
    apiM.modules.list.mockResolvedValue({
      items: [mkModule({ id: "11111111", type: "wildcard", name: "live" })],
      total: 1,
    });
    apiM.importExport.commit.mockResolvedValue({
      ok: true, undo_entry_id: "u", summary: { added: 0, replaced: 1, renamed: 0 },
    });
    const wrap = mountView();
    await flushPromises();
    await feedPayloadAndContinue(wrap, mkPayload({
      wildcards: [mkWildcardEntity("11111111")],
    }));
    // Commit is NOT yet called — modal is open (teleported to body).
    expect(apiM.importExport.commit).not.toHaveBeenCalled();
    expect(document.body.querySelector('[data-test="conflict-modal"]')).not.toBeNull();
    wrap.unmount();
  });

  it("commit-ready emit drives commit with batch-default decisions", async () => {
    apiM.modules.list.mockResolvedValue({
      items: [mkModule({ id: "11111111", type: "wildcard", name: "live" })],
      total: 1,
    });
    apiM.importExport.commit.mockResolvedValue({
      ok: true, undo_entry_id: "u", summary: { added: 0, replaced: 1, renamed: 0 },
    });
    const wrap = mountView();
    await flushPromises();
    await feedPayloadAndContinue(wrap, mkPayload({
      wildcards: [mkWildcardEntity("11111111")],
    }));
    // Modal lives in document.body (Teleport target). Drive its
    // segmented control + Import button directly. Phase 3 swapped the
    // batch <select> for a 3-button action group — click the Replace
    // button instead of changing a select value.
    const replaceBtn = document.body.querySelector<HTMLButtonElement>('[data-test="batch-action-replace"]');
    expect(replaceBtn).not.toBeNull();
    if (!replaceBtn) throw new Error("batch-action-replace missing");
    replaceBtn.click();
    await flushPromises();
    const commitBtn = document.body.querySelector<HTMLButtonElement>('[data-test="commit-btn"]');
    expect(commitBtn).not.toBeNull();
    commitBtn?.click();
    await flushPromises();
    expect(apiM.importExport.commit).toHaveBeenCalledTimes(1);
    const firstCall = apiM.importExport.commit.mock.calls[0];
    if (!firstCall) throw new Error("commit was not called");
    const payload = firstCall[0] as CommitPayload;
    expect(payload.replaces.length).toBe(1);
    expect(payload.replaces[0]?.id).toBe("11111111");
    expect(payload.adds.length).toBe(0);
    wrap.unmount();
  });

  it("undo via toast action calls importExport.undo and clears broken_ref warnings", async () => {
    apiM.importExport.commit.mockResolvedValue({
      ok: true, undo_entry_id: "undo_xyz", summary: { added: 1, replaced: 0, renamed: 0 },
    });
    apiM.importExport.undo.mockResolvedValue({ ok: true });
    const wrap = mountView();
    await flushPromises();
    await feedPayloadAndContinue(wrap, mkPayload({
      wildcards: [mkWildcardEntity("aaaaaaaa")],
    }));
    // Seed a broken-ref warning so we can confirm undo wipes it.
    useResolveWarnings().push([{
      type: "broken_ref_on_import", severity: "warn", module_id: "aaaaaaaa",
      source_field: "options[0].value", position: 0,
      token_index: null, detail: {}, message: "demo",
    }]);
    const t = useToast();
    const succ = t.toasts.value.find((x) => x.severity === "success");
    expect(succ?.action).toBeTruthy();
    await succ?.action?.run();
    await flushPromises();
    expect(apiM.importExport.undo).toHaveBeenCalledWith("undo_xyz");
    // broken_ref warnings cleared by undo handler.
    const remaining = useResolveWarnings().warnings.value.filter(
      (w) => w.type === "broken_ref_on_import",
    );
    expect(remaining.length).toBe(0);
  });

  it("error → error toast surfaced, state preserved for retry", async () => {
    const { ApiError } = await import("../api/client");
    apiM.importExport.commit.mockRejectedValue(new ApiError(500, "boom"));
    const wrap = mountView();
    await flushPromises();
    await feedPayloadAndContinue(wrap, mkPayload({
      wildcards: [mkWildcardEntity("bbbbbbbb")],
    }));
    const t = useToast();
    const err = t.toasts.value.find((x) => x.severity === "error");
    expect(err).toBeTruthy();
    expect(err?.detail).toContain("boom");
    // State preserved — picker / stash visible for retry.
    expect(wrap.find('[data-test="io-import-picker"]').exists()).toBe(true);
  });

  it("post-commit broken refs surface via warning store", async () => {
    apiM.importExport.commit.mockResolvedValue({
      ok: true, undo_entry_id: "u", summary: { added: 1, replaced: 0, renamed: 0 },
    });
    const wrap = mountView();
    await flushPromises();
    // Wildcard option references @{deadbeef} which is NOT in the local
    // library + NOT in the payload — broken-refs walker should flag it.
    // Phase 9: this now also produces a broken-inner-ref per-item issue
    // so the ConflictModal opens; drive commit-ready to proceed.
    await feedPayloadAndContinue(wrap, mkPayload({
      wildcards: [
        mkWildcardEntity("cccccccc", [{ value: "blue @{deadbeef}", weight: 1 }]),
      ],
    }));
    const modalCmp = wrap.findComponent(ConflictModal);
    if (!modalCmp.exists()) throw new Error("ConflictModal not mounted");
    modalCmp.vm.$emit("commit-ready", {
      batchDefault: "skip",
      perItemDecisions: { "cccccccc": { kind: "accept" } },
    });
    await flushPromises();
    const warns = useResolveWarnings().warnings.value;
    const brokenForC = warns.find(
      (w) => w.type === "broken_ref_on_import" && w.module_id === "cccccccc",
    );
    expect(brokenForC).toBeTruthy();
    expect(brokenForC?.detail).toMatchObject({ target_id: "deadbeef" });
  });

  it("Phase 10: silent-skip selection opens ConflictModal; default skip → 'Nothing to import' toast", async () => {
    // Wildcard entity matches a pre-seeded library row content + id, so
    // collision detector returns silent-skip. Phase 10 routes silent-skips
    // through the modal (as DUPLICATE rows) so the user sees them; the
    // default action is still drop, and choosing commit with no overrides
    // → partitionSelection drops them all → totalOps=0 → info toast.
    const entity = mkWildcardEntity("eeeeeeee");
    const { moduleFingerprint } = await import("../import-export/fingerprint");
    const fp = moduleFingerprint({
      type: "wildcard",
      name: entity.name,
      description: entity.description,
      tags: entity.tags,
      payload_hash: entity.payload_hash,
    });
    const libRow = {
      ...mkModule({ id: "eeeeeeee", type: "wildcard", name: entity.name }),
      snapshot_fingerprint: fp,
    } as unknown as ModuleRow;
    apiM.modules.list.mockResolvedValue({ items: [libRow], total: 1 });
    const wrap = mountView();
    await flushPromises();
    await feedPayloadAndContinue(wrap, mkPayload({ wildcards: [entity] }));
    // Modal opens because the silent-skip is now visible.
    const modalEl = document.body.querySelector('[data-test="conflict-modal"]');
    expect(modalEl).not.toBeNull();
    // Drive commit-ready with default (skip) + no overrides → orchestrator
    // partitions everything to drop → "Nothing to import" toast.
    const modal = wrap.findComponent(ConflictModal);
    modal.vm.$emit("commit-ready", { batchDefault: "skip", perItemDecisions: {} });
    await flushPromises();
    expect(apiM.importExport.commit).not.toHaveBeenCalled();
    const t = useToast();
    const info = t.toasts.value.find(
      (x) => x.severity === "info" && x.summary === "Nothing to import",
    );
    expect(info).toBeTruthy();
    expect(wrap.find('[data-test="io-import-stash"]').exists()).toBe(false);
    wrap.unmount();
  });

  it("Phase 12: selected entity referencing an unselected payload entity emits unselected-dep", async () => {
    // backdrop references @{c14e7527} (mood) via option text; mood is in
    // the payload but the user only selects backdrop. Orchestrator must
    // surface an unselected-dep per-item issue with target_name so the
    // modal renders a helpful "References mood @{c14e7527}" detail.
    apiM.modules.list.mockResolvedValue({ items: [], total: 0 });
    const wrap = mountView();
    await flushPromises();
    await feedPayloadAndContinueWithIds(
      wrap,
      mkPayload({
        wildcards: [
          mkWildcardEntity("b0219910", [
            { value: "blue @{c14e7527}", weight: 1 },
          ]),
          mkWildcardEntity("c14e7527"),
        ],
      }),
      new Set(["b0219910"]),
    );
    const modal = wrap.findComponent(ConflictModal);
    if (!modal.exists()) throw new Error("ConflictModal not mounted");
    const issues = modal.props("perItemIssues") as PerItemIssue[];
    const u = issues.find(
      (i) => i.kind === "unselected-dep" && i.entity.id === "b0219910",
    );
    expect(u).toBeDefined();
    expect((u?.detail as { target?: string }).target).toBe("c14e7527");
    wrap.unmount();
  });

  it("Phase 13: multiple unselected refs on one source aggregate into a single issue row", async () => {
    // backdrop refs @{c14e7527} (mood) + @{a361dbdc} (color); user only
    // selects backdrop. Should produce ONE unselected-dep issue with
    // a targets array of length 2, not two separate issues.
    apiM.modules.list.mockResolvedValue({ items: [], total: 0 });
    const wrap = mountView();
    await flushPromises();
    await feedPayloadAndContinueWithIds(
      wrap,
      mkPayload({
        wildcards: [
          mkWildcardEntity("b0219910", [
            { value: "@{c14e7527} and @{a361dbdc}", weight: 1 },
          ]),
          mkWildcardEntity("c14e7527"),
          mkWildcardEntity("a361dbdc"),
        ],
      }),
      new Set(["b0219910"]),
    );
    const modal = wrap.findComponent(ConflictModal);
    const issues = modal.props("perItemIssues") as PerItemIssue[];
    const u = issues.filter(
      (i) => i.kind === "unselected-dep" && i.entity.id === "b0219910",
    );
    expect(u.length).toBe(1);
    const targets = (u[0]!.detail as { targets?: Array<{ id: string }> }).targets;
    expect(targets).toBeDefined();
    expect(targets!.length).toBe(2);
    const ids = targets!.map((t) => t.id).sort();
    expect(ids).toEqual(["a361dbdc", "c14e7527"]);
    wrap.unmount();
  });

  it("Phase 13: include-deps expands selection + reruns the pipeline", async () => {
    apiM.modules.list.mockResolvedValue({ items: [], total: 0 });
    const wrap = mountView();
    await flushPromises();
    await feedPayloadAndContinueWithIds(
      wrap,
      mkPayload({
        wildcards: [
          mkWildcardEntity("b0219910", [{ value: "@{c14e7527}", weight: 1 }]),
          mkWildcardEntity("c14e7527"),
        ],
      }),
      new Set(["b0219910"]),
    );
    // Modal opens with one unselected-dep issue for backdrop.
    let modal = wrap.findComponent(ConflictModal);
    let issues = modal.props("perItemIssues") as PerItemIssue[];
    expect(issues.some((i) => i.kind === "unselected-dep")).toBe(true);
    // Click Include deps → orchestrator folds c14e7527 into selection +
    // reruns the pipeline. The unselected-dep issue should now be gone.
    modal.vm.$emit("include-deps", ["c14e7527"]);
    await flushPromises();
    modal = wrap.findComponent(ConflictModal);
    if (modal.exists()) {
      issues = modal.props("perItemIssues") as PerItemIssue[];
      expect(issues.some((i) => i.kind === "unselected-dep")).toBe(false);
    }
    wrap.unmount();
  });

  it("Phase 12: row appearing in BOTH batch + per-item is deduped — per-item wins", async () => {
    // Wildcard a1a1a1a1 has matching library content (silent-skip) AND
    // references an unresolved id @{deadbeef} → would normally land in
    // both batch (DUPLICATE) and per-item (MISSING DEP). Dedup must drop
    // it from the batch list so the user only decides once.
    const incoming = mkWildcardEntity("a1a1a1a1", [
      { value: "@{deadbeef}", weight: 1 },
    ]);
    const { moduleFingerprint } = await import("../import-export/fingerprint");
    const fp = moduleFingerprint({
      type: "wildcard",
      name: incoming.name,
      description: incoming.description,
      tags: incoming.tags,
      payload_hash: incoming.payload_hash,
    });
    const libRow = {
      ...mkModule({ id: "a1a1a1a1", type: "wildcard", name: incoming.name }),
      snapshot_fingerprint: fp,
    } as unknown as ModuleRow;
    apiM.modules.list.mockResolvedValue({ items: [libRow], total: 1 });
    const wrap = mountView();
    await flushPromises();
    await feedPayloadAndContinue(wrap, mkPayload({ wildcards: [incoming] }));
    const modal = wrap.findComponent(ConflictModal);
    const batch = modal.props("batchConflicts") as Array<{ id: string }>;
    const issues = modal.props("perItemIssues") as PerItemIssue[];
    expect(batch.find((c) => c.id === "a1a1a1a1")).toBeUndefined();
    expect(issues.some((i) => i.entity.id === "a1a1a1a1")).toBe(true);
    wrap.unmount();
  });

  it("stale broken-refs cleared on re-import of the same entity", async () => {
    apiM.importExport.commit.mockResolvedValue({
      ok: true, undo_entry_id: "u", summary: { added: 1, replaced: 0, renamed: 0 },
    });
    const wrap = mountView();
    await flushPromises();
    // First import: wildcard with broken @{deadbeef} ref → broken-ref
    // warning lands in the store keyed to module_id=ffffffff. Phase 9:
    // broken-inner-ref now opens the ConflictModal — drive commit-ready
    // to proceed past the modal.
    await feedPayloadAndContinue(wrap, mkPayload({
      wildcards: [
        mkWildcardEntity("ffffffff", [{ value: "blue @{deadbeef}", weight: 1 }]),
      ],
    }));
    const modal1 = wrap.findComponent(ConflictModal);
    if (!modal1.exists()) throw new Error("ConflictModal not mounted (first commit)");
    modal1.vm.$emit("commit-ready", {
      batchDefault: "skip",
      perItemDecisions: { "ffffffff": { kind: "accept" } },
    });
    await flushPromises();
    const store = useResolveWarnings();
    const firstBatch = store.warnings.value.filter(
      (w) => w.type === "broken_ref_on_import" && w.module_id === "ffffffff",
    );
    expect(firstBatch.length).toBe(1);
    // Second import: same id, this time no broken refs. Library is still
    // empty (modules.list mock returns []) so the second selection routes
    // through the no-conflict path. The orchestrator's `clearForModule`
    // pass must wipe the prior broken-ref BEFORE pushing the fresh
    // (empty) batch, so the store ends with zero broken-refs for
    // ffffffff after the second commit.
    apiM.importExport.commit.mockResolvedValue({
      ok: true, undo_entry_id: "u2", summary: { added: 1, replaced: 0, renamed: 0 },
    });
    await feedPayloadAndContinue(wrap, mkPayload({
      wildcards: [mkWildcardEntity("ffffffff")],
    }));
    await flushPromises();
    expect(apiM.importExport.commit).toHaveBeenCalledTimes(2);
    const remaining = store.warnings.value.filter(
      (w) => w.type === "broken_ref_on_import" && w.module_id === "ffffffff",
    );
    expect(remaining.length).toBe(0);
    wrap.unmount();
  });

  it("batch default rename → orchestrator mints new_id + suffixes name with ' (imported)'", async () => {
    // Pre-seed library so the picker selection generates a BatchConflict
    // for entity 22222222. The user clicks "Import as new" on the batch
    // segmented control — orchestrator mints a fresh id + appends the
    // " (imported)" suffix to the name. (The engine value sent over the
    // wire is still `rename`; Phase 3 only relabeled the UI.)
    apiM.modules.list.mockResolvedValue({
      items: [mkModule({ id: "22222222", type: "wildcard", name: "live" })],
      total: 1,
    });
    apiM.importExport.commit.mockResolvedValue({
      ok: true, undo_entry_id: "u", summary: { added: 0, replaced: 0, renamed: 1 },
    });
    const wrap = mountView();
    await flushPromises();
    await feedPayloadAndContinue(wrap, mkPayload({
      wildcards: [mkWildcardEntity("22222222")],
    }));
    // Modal teleported — click the "Import as new" button on the
    // segmented control. Engine value emitted is still `rename`.
    const renameBtn = document.body.querySelector<HTMLButtonElement>(
      '[data-test="batch-action-rename"]',
    );
    if (!renameBtn) throw new Error("batch-action-rename missing");
    renameBtn.click();
    await flushPromises();
    const commitBtn = document.body.querySelector<HTMLButtonElement>(
      '[data-test="commit-btn"]',
    );
    commitBtn?.click();
    await flushPromises();
    expect(apiM.importExport.commit).toHaveBeenCalledTimes(1);
    const firstCall = apiM.importExport.commit.mock.calls[0];
    if (!firstCall) throw new Error("commit was not called");
    const payload = firstCall[0] as CommitPayload;
    expect(payload.adds.length).toBe(0);
    expect(payload.replaces.length).toBe(0);
    expect(payload.renames.length).toBe(1);
    const r = payload.renames[0];
    expect(r?.kind).toBe("wildcard");
    expect(r?.old_id).toBe("22222222");
    // Minted id is fresh 8-hex-char value distinct from the old id.
    expect(typeof r?.new_id).toBe("string");
    expect(r?.new_id.length).toBe(8);
    expect(r?.new_id).not.toBe("22222222");
    expect(/^[0-9a-f]{8}$/.test(r?.new_id ?? "")).toBe(true);
    // Content carries the suffixed display name + the minted id.
    expect(r?.content.name).toBe("wc_22222222 (imported)");
    expect(r?.content.id).toBe(r?.new_id);
    wrap.unmount();
  });

  it("per-item override rename (no explicit new_id/new_name) → orchestrator mints id + suffixes name", async () => {
    // Same setup as the batch-rename test, but the resolution arrives
    // through the per-row override path. ConflictModal emits
    // `perItemDecisions: { "33333333": { kind: "rename" } }` — no
    // `new_id` or `new_name`. The orchestrator must mint both.
    apiM.modules.list.mockResolvedValue({
      items: [mkModule({ id: "33333333", type: "wildcard", name: "live" })],
      total: 1,
    });
    apiM.importExport.commit.mockResolvedValue({
      ok: true, undo_entry_id: "u", summary: { added: 0, replaced: 0, renamed: 1 },
    });
    const wrap = mountView();
    await flushPromises();
    await feedPayloadAndContinue(wrap, mkPayload({
      wildcards: [mkWildcardEntity("33333333")],
    }));
    // Drive ConflictModal directly with the override-only payload — the
    // batch override per-row dropdown writes `{kind: "rename"}` (no
    // new_id / new_name) into perItemDecisions, exactly the shape we
    // emit here.
    const modalCmp = wrap.findComponent(ConflictModal);
    if (!modalCmp.exists()) throw new Error("ConflictModal not mounted");
    modalCmp.vm.$emit("commit-ready", {
      batchDefault: "skip",
      perItemDecisions: {
        "33333333": { kind: "rename" },
      },
    });
    await flushPromises();
    expect(apiM.importExport.commit).toHaveBeenCalledTimes(1);
    const firstCall = apiM.importExport.commit.mock.calls[0];
    if (!firstCall) throw new Error("commit was not called");
    const payload = firstCall[0] as CommitPayload;
    expect(payload.renames.length).toBe(1);
    const r = payload.renames[0];
    expect(r?.old_id).toBe("33333333");
    expect(typeof r?.new_id).toBe("string");
    expect(r?.new_id.length).toBe(8);
    expect(r?.new_id).not.toBe("33333333");
    expect(r?.content.name).toBe("wc_33333333 (imported)");
    expect(r?.content.id).toBe(r?.new_id);
    wrap.unmount();
  });

  it("per-item override rename (explicit new_id + new_name) → orchestrator uses those values verbatim", async () => {
    // The inline `<ImportAsNewRename>` flow on a per-item issue row
    // emits `{ kind: "rename", new_id, new_name }`. The orchestrator
    // must thread those values through unchanged — no re-mint, no
    // " (imported)" suffix on top of the user-edited name.
    apiM.modules.list.mockResolvedValue({
      items: [mkModule({ id: "44444444", type: "wildcard", name: "live" })],
      total: 1,
    });
    apiM.importExport.commit.mockResolvedValue({
      ok: true, undo_entry_id: "u", summary: { added: 0, replaced: 0, renamed: 1 },
    });
    const wrap = mountView();
    await flushPromises();
    await feedPayloadAndContinue(wrap, mkPayload({
      wildcards: [mkWildcardEntity("44444444")],
    }));
    const modalCmp = wrap.findComponent(ConflictModal);
    if (!modalCmp.exists()) throw new Error("ConflictModal not mounted");
    modalCmp.vm.$emit("commit-ready", {
      batchDefault: "skip",
      perItemDecisions: {
        "44444444": {
          kind: "rename",
          new_id: "ffff0000",
          new_name: "Custom",
        },
      },
    });
    await flushPromises();
    expect(apiM.importExport.commit).toHaveBeenCalledTimes(1);
    const firstCall = apiM.importExport.commit.mock.calls[0];
    if (!firstCall) throw new Error("commit was not called");
    const payload = firstCall[0] as CommitPayload;
    expect(payload.renames.length).toBe(1);
    const r = payload.renames[0];
    expect(r?.old_id).toBe("44444444");
    expect(r?.new_id).toBe("ffff0000");
    expect(r?.content.id).toBe("ffff0000");
    expect(r?.content.name).toBe("Custom");
    wrap.unmount();
  });

  it("selected entity referencing absent id emits broken-inner-ref per-item issue", async () => {
    // Wildcard a1 references @{deadbeef} via its option value. The
    // target id is NOT in the payload AND the library is empty →
    // orchestrator must surface a broken-inner-ref per-item issue so
    // the ConflictModal opens for resolution.
    apiM.modules.list.mockResolvedValue({ items: [], total: 0 });
    apiM.importExport.commit.mockResolvedValue({
      ok: true, undo_entry_id: "u", summary: { added: 1, replaced: 0, renamed: 0 },
    });
    const wrap = mountView();
    await flushPromises();
    await feedPayloadAndContinue(wrap, mkPayload({
      wildcards: [
        mkWildcardEntity("a1a1a1a1", [{ value: "ref @{deadbeef}", weight: 1 }]),
      ],
    }));
    // Modal opens because the broken ref produces a per-item issue.
    const modalEl = document.body.querySelector('[data-test="conflict-modal"]');
    expect(modalEl).not.toBeNull();
    // Assert the orchestrator emitted the right shape — not just that some
    // text rendered. Locks in `kind="broken-inner-ref"`, target id, and the
    // entity kind ConflictModal needs for the type-icon.
    const modal = wrap.findComponent(ConflictModal);
    const perItemIssues = modal.props("perItemIssues") as PerItemIssue[];
    const brokenRefIssue = perItemIssues.find(
      (i) => i.kind === "broken-inner-ref" && i.entity.id === "a1a1a1a1",
    );
    expect(brokenRefIssue).toBeDefined();
    expect(brokenRefIssue?.entity).toMatchObject({ id: "a1a1a1a1", kind: "wildcard" });
    expect((brokenRefIssue?.detail as { target?: string } | undefined)?.target).toBe("deadbeef");
    // Surface-level sanity that the modal also renders the badge/id.
    expect(modalEl?.textContent).toContain("MISSING DEP");
    expect(modalEl?.textContent).toContain("deadbeef");
    wrap.unmount();
  });

  it("missing per-item decision → console.warn + entity dropped, commit proceeds for the rest", async () => {
    // Build a payload with two wildcards. One carries a wrong
    // snapshot_fingerprint → `parsePayload` emits an IntegrityWarning →
    // per-item issue surfaces in the modal. The other entity has no
    // stamp → routes through as a plain `add`. We emit `commit-ready`
    // from ConflictModal with NO per-item decision so the orchestrator
    // hits the missing-decision branch and `console.warn`s + drops the
    // bad entity, while the good entity still commits.
    apiM.importExport.commit.mockResolvedValue({
      ok: true, undo_entry_id: "u", summary: { added: 1, replaced: 0, renamed: 0 },
    });
    const wrap = mountView();
    await flushPromises();
    // Stamp a wrong snapshot_fingerprint on the bad entity so verifyOne
    // emits an IntegrityWarning.
    const badEntity = {
      ...mkWildcardEntity("12121212"),
      snapshot_fingerprint: "deadbeefdeadbeef",
    };
    const goodEntity = mkWildcardEntity("34343434");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Get to picker mounted with the 2-entity payload (picker won't
      // auto-select multi-entity payloads — we drive selection-ready
      // directly to pick both ids in one go).
      await wrap.find('[data-test="io-tab-import"]').trigger("click");
      await flushPromises();
      await wrap.find('[data-test="import-paste-btn"]').trigger("click");
      await flushPromises();
      await wrap.find('[data-test="import-paste-textarea"]')
        .setValue(JSON.stringify(mkPayload({ wildcards: [badEntity, goodEntity] })));
      await wrap.find('[data-test="import-paste-confirm"]').trigger("click");
      await flushPromises();
      // Drive the picker directly — picker doesn't auto-select multi-
      // entity payloads, and clicking individual checkboxes here adds
      // brittleness. The picker's emit contract is `selection-ready` →
      // ids:Set<string>; emit it with both entity ids to mirror what a
      // user clicking through would produce.
      const picker = wrap.findComponent(ImportPicker);
      if (!picker.exists()) throw new Error("ImportPicker not mounted");
      picker.vm.$emit("selection-ready", new Set(["12121212", "34343434"]));
      await flushPromises();
      // The fingerprint mismatch produced a per-item issue → modal opens.
      const modalCmp = wrap.findComponent(ConflictModal);
      if (!modalCmp.exists()) {
        throw new Error("ConflictModal not mounted after selection-ready");
      }
      // Emit `commit-ready` with NO per-item decision — exercises the
      // missing-decision branch in `partitionSelection`.
      modalCmp.vm.$emit("commit-ready", {
        batchDefault: "skip",
        perItemDecisions: {},
      });
      await flushPromises();
      // Per-item decision missing for 12121212 → console.warn fired with
      // the dropped id + "no decision" phrase.
      const warnCalls = warnSpy.mock.calls.map((c) => String(c[0]));
      const hit = warnCalls.find(
        (m) => m.includes("12121212") && m.includes("no decision"),
      );
      expect(hit).toBeTruthy();
      // Commit still happened for the good entity.
      expect(apiM.importExport.commit).toHaveBeenCalledTimes(1);
      const firstCall = apiM.importExport.commit.mock.calls[0];
      if (!firstCall) throw new Error("commit was not called");
      const payload = firstCall[0] as CommitPayload;
      expect(payload.adds.length).toBe(1);
      expect(payload.adds[0]?.entity.id).toBe("34343434");
    } finally {
      warnSpy.mockRestore();
      wrap.unmount();
    }
  });

  it("repoints an imported constraint's source to a renamed wildcard's new id", async () => {
    // Import a wildcard `deadbeef` + a constraint whose source points at it.
    // The library already holds `deadbeef` (no snapshot_fingerprint → the
    // collision detector marks it `conflict`), so the user resolves it as
    // install-as-new (batch default rename → fresh new_id). The constraint
    // does NOT collide → lands in `adds`. After commit, the constraint's
    // payload.source_wildcard_id MUST follow the wildcard to its minted
    // new_id — NOT stay pointed at the friend uuid "deadbeef".
    apiM.modules.list.mockResolvedValue({
      items: [mkModule({ id: "deadbeef", type: "wildcard", name: "live" })],
      total: 1,
    });
    apiM.importExport.commit.mockResolvedValue({
      ok: true, undo_entry_id: "u", summary: { added: 1, replaced: 0, renamed: 1 },
    });
    const wrap = mountView();
    await flushPromises();
    // Multi-entity payload — drive selection-ready directly with both ids.
    // Both constraint edges point at the selected wildcard `deadbeef` so
    // neither side is a dangling/unselected dep (which would route the
    // constraint to a per-item issue and drop it). The follow-through must
    // then repoint the source to the wildcard's freshly-minted local id.
    await feedPayloadAndContinueWithIds(
      wrap,
      mkPayload({
        wildcards: [mkWildcardEntity("deadbeef")],
        constraints: [mkConstraintEntity("c0c0c0c0", "deadbeef", "deadbeef")],
      }),
      new Set(["deadbeef", "c0c0c0c0"]),
    );
    // The wildcard `deadbeef` is a batch conflict → modal opens. Resolve via
    // the batch default "rename" (install-as-new) with no per-item overrides.
    const modal = wrap.findComponent(ConflictModal);
    if (!modal.exists()) throw new Error("ConflictModal not mounted");
    modal.vm.$emit("commit-ready", { batchDefault: "rename", perItemDecisions: {} });
    await flushPromises();
    expect(apiM.importExport.commit).toHaveBeenCalledTimes(1);
    const firstCall = apiM.importExport.commit.mock.calls[0];
    if (!firstCall) throw new Error("commit was not called");
    const payload = firstCall[0] as CommitPayload;
    // The wildcard was renamed → its fresh local id is in renames[].new_id.
    const wcRename = payload.renames.find((r) => r.kind === "wildcard" && r.old_id === "deadbeef");
    expect(wcRename).toBeDefined();
    const newWildcardId = wcRename!.new_id;
    expect(newWildcardId).not.toBe("deadbeef");
    // The constraint added in `adds` must now point source at the new id.
    const conAdd = payload.adds.find((a) => a.kind === "constraint" && a.entity.id === "c0c0c0c0");
    expect(conAdd).toBeDefined();
    const conPayload = conAdd!.entity.payload as { source_wildcard_id?: string };
    expect(conPayload.source_wildcard_id).toBe(newWildcardId);
    wrap.unmount();
  });
});
