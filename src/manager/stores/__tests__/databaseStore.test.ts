import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useDatabaseStore } from "../databaseStore";
import type { DatabaseConfig, DatabaseInfo, MaintenanceResult } from "../../api/types";

const sampleInfo: DatabaseInfo = {
  path: "/tmp/wp.db",
  source: "WP_DB_PATH",
  size_bytes: 1024,
  mtime_iso: "2026-06-02T00:00:00+00:00",
  counts: {
    wildcards: 0, fixed_values: 0, combines: 0, derivations: 0,
    constraints: 0, bundles: 0, templates: 0, categories: 0,
  },
  migration: { current_version: 11, applied: [] },
  pragma: {
    journal_mode: "wal", foreign_keys: 1,
    page_size: 4096, page_count: 1, freelist_count: 0,
  },
};

const vacuumOk: MaintenanceResult = {
  ok: true, op: "vacuum", duration_ms: 10, bytes_reclaimed: 0,
};

const sampleConfig: DatabaseConfig = {
  preference: null,
  pending_move: null,
  locations: {
    user:   { path: "/comfy/user/wildcard-pipeline.db", exists: true, size_bytes: 1024 },
    global: { path: "/home/.comfyui/wildcard-pipeline.db", exists: true, size_bytes: 2048 },
    root:   { path: "/plugin/db/wildcard-pipeline.db", exists: false, size_bytes: null },
  },
  env_locked: false,
};

vi.mock("../../api/client", () => ({
  api: {
    database: {
      info: vi.fn(),
      maintenance: vi.fn(),
      config: vi.fn(),
      setConfig: vi.fn(),
      clearPendingMove: vi.fn(),
    },
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

import { api } from "../../api/client";

describe("databaseStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("fetchInfo populates state and toggles loading", async () => {
    (api.database.info as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(sampleInfo);
    const store = useDatabaseStore();
    expect(store.loading).toBe(false);
    const promise = store.fetchInfo();
    expect(store.loading).toBe(true);
    await promise;
    expect(store.loading).toBe(false);
    expect(store.info).toEqual(sampleInfo);
    expect(store.lastError).toBeNull();
  });

  it("fetchInfo records lastError on network failure", async () => {
    (api.database.info as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("network down"),
    );
    const store = useDatabaseStore();
    await store.fetchInfo();
    expect(store.lastError).toBe("network down");
    expect(store.info).toBeNull();
  });

  it("runOp sets runningOp during the call and re-fetches on success", async () => {
    (api.database.info as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(sampleInfo);
    (api.database.maintenance as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(vacuumOk);
    const store = useDatabaseStore();
    const promise = store.runOp("vacuum");
    expect(store.runningOp).toBe("vacuum");
    const result = await promise;
    expect(result).toEqual(vacuumOk);
    expect(store.runningOp).toBeNull();
    expect(api.database.info).toHaveBeenCalledTimes(1);
  });

  it("runOp re-fetches even when ok=false (migrate-partial safety)", async () => {
    (api.database.info as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(sampleInfo);
    (api.database.maintenance as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false, op: "vacuum", duration_ms: 5, error: "database is locked",
    });
    const store = useDatabaseStore();
    await store.runOp("vacuum");
    expect(api.database.info).toHaveBeenCalledTimes(1);
  });

  it("runOp does NOT re-fetch on network error", async () => {
    (api.database.info as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(sampleInfo);
    (api.database.maintenance as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("offline"));
    const store = useDatabaseStore();
    const result = await store.runOp("vacuum");
    expect(result.ok).toBe(false);
    expect(api.database.info).not.toHaveBeenCalled();
    expect(store.runningOp).toBeNull();
  });

  it("fetchConfig populates config and toggles configLoading", async () => {
    (api.database.config as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(sampleConfig);
    const store = useDatabaseStore();
    expect(store.configLoading).toBe(false);
    const promise = store.fetchConfig();
    expect(store.configLoading).toBe(true);
    await promise;
    expect(store.configLoading).toBe(false);
    expect(store.config).toEqual(sampleConfig);
    expect(store.configError).toBeNull();
  });

  it("fetchConfig records configError on failure", async () => {
    (api.database.config as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("boom"),
    );
    const store = useDatabaseStore();
    await store.fetchConfig();
    expect(store.configError).toBe("boom");
    expect(store.config).toBeNull();
  });

  it("setConfig sends update and stores result", async () => {
    const updated: DatabaseConfig = { ...sampleConfig, preference: "global" };
    (api.database.setConfig as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updated);
    const store = useDatabaseStore();
    const result = await store.setConfig({ preference: "global" });
    expect(api.database.setConfig).toHaveBeenCalledWith({ preference: "global" });
    expect(result).toEqual(updated);
    expect(store.config?.preference).toBe("global");
  });

  it("setConfig records configError and returns null on failure", async () => {
    (api.database.setConfig as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("nope"),
    );
    const store = useDatabaseStore();
    const result = await store.setConfig({ preference: "user" });
    expect(result).toBeNull();
    expect(store.configError).toBe("nope");
  });

  it("cancelPendingMove updates store via DELETE endpoint", async () => {
    const after: DatabaseConfig = { ...sampleConfig, pending_move: null };
    (api.database.clearPendingMove as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(after);
    const store = useDatabaseStore();
    await store.cancelPendingMove();
    expect(api.database.clearPendingMove).toHaveBeenCalled();
    expect(store.config?.pending_move).toBeNull();
  });
});
