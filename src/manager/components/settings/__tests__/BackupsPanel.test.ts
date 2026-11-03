import { describe, it, expect, beforeEach, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import BackupsPanel from "../BackupsPanel.vue";
import { api } from "../../../api/client";
import { _resetServerSettingsForTesting } from "../../../composables/useServerSettings";
import type { BackupEntry } from "../../../api/types";
import { settingsRouter } from "../../../__tests__/helpers/settingsRouter";
import ConfirmModal from "@/kit/ConfirmModal.vue";
import { useToast } from "@/kit/useToast";
import { libraryVersion } from "../../../composables/useLibraryChanged";

vi.mock("../../../api/client", () => ({
  api: {
    database: {
      backups: vi.fn(),
      createBackup: vi.fn(),
      pinBackup: vi.fn(),
      deleteBackup: vi.fn(),
      restoreBackup: vi.fn(),
      cancelRestore: vi.fn(),
      info: vi.fn(async () => null),
    },
    serverSettings: {
      get: vi.fn(async () => ({ max_ref_depth: 8, backups: { enabled: false, keep: 2, daily: true } })),
      update: vi.fn(),
    },
  },
  ApiError: class ApiError extends Error {},
}));

const db = vi.mocked(api.database);

function entry(day: number, reason: BackupEntry["reason"], pinned = false): BackupEntry {
  return {
    name: `wildcard-pipeline-202601${String(day).padStart(2, "0")}-000000-${reason}.db`,
    size: 1024,
    created_at: `2026-01-${String(day).padStart(2, "0")}T00:00:00Z`,
    reason,
    pinned,
    note: null,
  };
}

const rows = [entry(5, "manual"), entry(4, "daily", true), entry(3, "manual"), entry(2, "daily")];

describe("BackupsPanel", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    _resetServerSettingsForTesting();
    vi.clearAllMocks();
    db.backups.mockResolvedValue({ dir: "/db/backups", backups: rows, pending_restore: null });
  });

  async function mountPanel() {
    const w = mount(BackupsPanel, { global: { plugins: [await settingsRouter("library")] } });
    await flushPromises();
    return w;
  }

  it("marks unpinned backups past the keep limit, skipping pinned ones", async () => {
    const w = await mountPanel();
    const leaving = w.findAll("[data-test^='backup-leaving-']").map((el) => el.attributes("data-test"));
    expect(leaving).toEqual([`backup-leaving-${rows[3].name}`]);
    expect(w.find("[data-test='backup-pinned-count']").text()).toContain("1 pinned");
    expect(w.find(`[data-test='backup-pin-${rows[1].name}']`).attributes("aria-pressed")).toBe("true");
  });

  it("shows Backups to keep even with automatic backups off", async () => {
    const w = await mountPanel();
    expect(w.find("[data-test='backups-keep']").exists()).toBe(true);
    expect(w.find("[data-test='backups-daily']").exists()).toBe(false);
  });

  it("pins and unpins through the API", async () => {
    db.pinBackup.mockResolvedValue({ ...rows[0], pinned: true });
    const w = await mountPanel();
    await w.find(`[data-test='backup-pin-${rows[0].name}']`).trigger("click");
    await flushPromises();
    expect(db.pinBackup).toHaveBeenCalledWith(rows[0].name, true);
    await w.find(`[data-test='backup-pin-${rows[1].name}']`).trigger("click");
    await flushPromises();
    expect(db.pinBackup).toHaveBeenCalledWith(rows[1].name, false);
    expect(db.backups).toHaveBeenCalledTimes(3);
  });

  it("sends the typed note with Back up now and shows notes instead of Manual", async () => {
    db.backups.mockResolvedValue({
      dir: "/db/backups",
      backups: [{ ...rows[0], note: "before the rework" }, ...rows.slice(1)],
      pending_restore: null,
    });
    db.createBackup.mockResolvedValue({ ...rows[0], note: "before the rework", pruned: [] });
    const w = await mountPanel();
    expect(w.find(`[data-test='backup-label-${rows[0].name}']`).text()).toBe("before the rework");
    expect(w.find(`[data-test='backup-label-${rows[2].name}']`).text()).toBe("Manual");
    await w.find("[data-test='backup-note']").setValue("before the rework");
    await w.find("[data-test='backup-note']").trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(db.createBackup).toHaveBeenCalledWith("before the rework");
    expect((w.find("[data-test='backup-note']").element as HTMLInputElement).value).toBe("");
  });

  it("draws skeleton rows, not an empty list, until the backups load", async () => {
    db.backups.mockReturnValue(new Promise(() => {}));
    const w = await mountPanel();
    expect(w.find("[data-test='backup-skeleton']").exists()).toBe(true);
    expect(w.find("[data-test='backup-list']").exists()).toBe(false);
    expect(w.find("[data-test='backup-empty']").exists()).toBe(false);
  });

  it("restores at once, refreshes the library, and offers Undo", async () => {
    const pre = "wildcard-pipeline-20260106-000000-pre-restore.db";
    db.restoreBackup.mockResolvedValue({ restored: rows[2].name, pre_restore: pre });
    const toast = useToast();
    const before = libraryVersion.value;
    const w = await mountPanel();

    await w.find(`[data-test='backup-restore-${rows[2].name}']`).trigger("click");
    const modal = w.findAllComponents(ConfirmModal)[0];
    expect(modal.props("body")).toContain("no restart");
    modal.vm.$emit("confirm");
    await flushPromises();

    expect(db.restoreBackup).toHaveBeenCalledWith(rows[2].name);
    expect(libraryVersion.value).toBe(before + 1);
    const done = toast.toasts.value[toast.toasts.value.length - 1];
    expect(done?.summary).toBe("Backup restored");
    expect(done?.action?.label).toBe("Undo");

    db.restoreBackup.mockResolvedValue({ restored: pre, pre_restore: "x-pre-restore.db" });
    await done?.action?.run();
    await flushPromises();
    expect(db.restoreBackup).toHaveBeenLastCalledWith(pre);
    expect(libraryVersion.value).toBe(before + 2);
  });

  it("says why a restore was refused and changes nothing", async () => {
    db.restoreBackup.mockRejectedValue(new Error("This backup is damaged"));
    const toast = useToast();
    const before = libraryVersion.value;
    const w = await mountPanel();
    await w.find(`[data-test='backup-restore-${rows[0].name}']`).trigger("click");
    w.findAllComponents(ConfirmModal)[0].vm.$emit("confirm");
    await flushPromises();
    const last = toast.toasts.value[toast.toasts.value.length - 1];
    expect(last?.severity).toBe("error");
    expect(last?.detail).toBe("This backup is damaged");
    expect(libraryVersion.value).toBe(before);
  });
});
