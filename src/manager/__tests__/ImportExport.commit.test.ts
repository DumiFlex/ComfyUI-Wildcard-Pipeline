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
});
