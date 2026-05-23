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
      exportBundle: vi.fn(),
      importBundle: vi.fn(),
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

interface MockedApi {
  modules: { list: ReturnType<typeof vi.fn> };
  categories: { list: ReturnType<typeof vi.fn> };
  bundles: { list: ReturnType<typeof vi.fn> };
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

beforeEach(() => {
  setActivePinia(createPinia());
  apiM.modules.list.mockReset();
  apiM.categories.list.mockReset();
  apiM.bundles.list.mockReset();
  apiM.importExport.commit.mockReset();
  apiM.importExport.undo.mockReset();
  apiM.modules.list.mockResolvedValue({ items: [], total: 0 });
  apiM.categories.list.mockResolvedValue({ items: [] });
  apiM.bundles.list.mockResolvedValue({ items: [], total: 0 });
  useResolveWarnings().clearAll();
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
 * Drive the import-v2 pipeline up to `selection-ready`:
 *   1. Switch to import-v2 tab.
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
  await wrap.find('[data-test="io-tab-import-v2"]').trigger("click");
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
    // State cleared — stash element no longer rendered.
    expect(wrap.find('[data-test="io-import-v2-stash"]').exists()).toBe(false);
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
    // Modal lives in document.body (Teleport target). Drive its select
    // and Import button directly.
    const sel = document.body.querySelector<HTMLSelectElement>('[data-test="batch-default-select"]');
    expect(sel).not.toBeNull();
    if (!sel) throw new Error("batch-default-select missing");
    sel.value = "replace";
    sel.dispatchEvent(new Event("change"));
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
    expect(wrap.find('[data-test="io-import-v2-picker"]').exists()).toBe(true);
  });

  it("post-commit broken refs surface via warning store", async () => {
    apiM.importExport.commit.mockResolvedValue({
      ok: true, undo_entry_id: "u", summary: { added: 1, replaced: 0, renamed: 0 },
    });
    const wrap = mountView();
    await flushPromises();
    // Wildcard option references @{deadbeef} which is NOT in the local
    // library + NOT in the payload — broken-refs walker should flag it.
    await feedPayloadAndContinue(wrap, mkPayload({
      wildcards: [
        mkWildcardEntity("cccccccc", [{ value: "blue @{deadbeef}", weight: 1 }]),
      ],
    }));
    await flushPromises();
    const warns = useResolveWarnings().warnings.value;
    const brokenForC = warns.find(
      (w) => w.type === "broken_ref_on_import" && w.module_id === "cccccccc",
    );
    expect(brokenForC).toBeTruthy();
    expect(brokenForC?.detail).toMatchObject({ target_id: "deadbeef" });
  });

  it("all-silent-skip selection → info toast, commit NOT called, state cleared", async () => {
    // Wildcard entity from the payload — same id + same content as the
    // pre-seeded library row so the collision detector returns
    // `silent-skip` (uuid + fingerprint both match).
    const entity = mkWildcardEntity("eeeeeeee");
    // Recompute the fingerprint the way `detectCollisions` does so the
    // library snapshot_fingerprint matches the incoming entity's.
    const { moduleFingerprint } = await import("../import-export/fingerprint");
    const fp = moduleFingerprint({
      type: "wildcard",
      name: entity.name,
      description: entity.description,
      tags: entity.tags,
      payload_hash: entity.payload_hash,
    });
    // Pre-seed library row with matching id + matching snapshot_fingerprint.
    // snapshot_fingerprint is not in the static ModuleRow type (added
    // post-typing); cast via unknown to attach it for the API mock.
    const libRow = {
      ...mkModule({ id: "eeeeeeee", type: "wildcard", name: entity.name }),
      snapshot_fingerprint: fp,
    } as unknown as ModuleRow;
    apiM.modules.list.mockResolvedValue({ items: [libRow], total: 1 });
    const wrap = mountView();
    await flushPromises();
    await feedPayloadAndContinue(wrap, mkPayload({
      wildcards: [entity],
    }));
    // No conflicts + no per-item issues → orchestrator runs runCommit
    // directly. Every entity is silent-skip → buckets all empty → short-
    // circuit must trip BEFORE api.importExport.commit fires.
    expect(apiM.importExport.commit).not.toHaveBeenCalled();
    const t = useToast();
    const info = t.toasts.value.find(
      (x) => x.severity === "info" && x.summary === "Nothing to import",
    );
    expect(info).toBeTruthy();
    // State cleared — stash no longer rendered.
    expect(wrap.find('[data-test="io-import-v2-stash"]').exists()).toBe(false);
  });

  it("stale broken-refs cleared on re-import of the same entity", async () => {
    apiM.importExport.commit.mockResolvedValue({
      ok: true, undo_entry_id: "u", summary: { added: 1, replaced: 0, renamed: 0 },
    });
    const wrap = mountView();
    await flushPromises();
    // First import: wildcard with broken @{deadbeef} ref → broken-ref
    // warning lands in the store keyed to module_id=ffffffff.
    await feedPayloadAndContinue(wrap, mkPayload({
      wildcards: [
        mkWildcardEntity("ffffffff", [{ value: "blue @{deadbeef}", weight: 1 }]),
      ],
    }));
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
    // for entity 22222222. The user picks "Rename (keep both)" on the
    // batch dropdown — orchestrator mints a fresh id + appends the
    // " (imported)" suffix to the name.
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
    // Modal teleported — drive its batch dropdown directly.
    const sel = document.body.querySelector<HTMLSelectElement>(
      '[data-test="batch-default-select"]',
    );
    if (!sel) throw new Error("batch-default-select missing");
    sel.value = "rename";
    sel.dispatchEvent(new Event("change"));
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
      await wrap.find('[data-test="io-tab-import-v2"]').trigger("click");
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
});
