import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useDatabaseStore } from "../databaseStore";
import type { DatabaseInfo, MaintenanceResult } from "../../api/types";

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

vi.mock("../../api/client", () => ({
  api: {
    database: {
      info: vi.fn(),
      maintenance: vi.fn(),
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
});
