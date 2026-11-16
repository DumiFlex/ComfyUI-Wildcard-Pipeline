import { flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/client", () => ({
  api: {
    health: { scan: vi.fn(), ignore: vi.fn() },
    modules: { list: vi.fn(), update: vi.fn() },
    bundles: { list: vi.fn() },
    templates: { list: vi.fn() },
    categories: { list: vi.fn() },
  },
}));
// No canvas tab in tests: skip the wait for an answer.
vi.mock("../../utils/ai-context", () => ({ askCanvasFacts: vi.fn().mockResolvedValue(undefined) }));

import { api } from "../../api/client";
import { useHealthStore } from "../healthStore";
import { useModuleStore } from "../moduleStore";

const m = api as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const SCAN = { findings: [], ignored: [], counts: { problem: 0, warning: 0, tidy: 0 }, checks: [], canvas: false, checked_at: "" };
const row = (id: string, updated_at = "2026-01-01") => ({ id, name: id, type: "wildcard", updated_at, payload: {} });

beforeEach(() => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  m.health.scan.mockResolvedValue(SCAN);
  m.bundles.list.mockResolvedValue({ items: [], total: 0 });
  m.templates.list.mockResolvedValue({ items: [], total: 0 });
  m.categories.list.mockResolvedValue({ items: [] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("healthStore", () => {
  it("scans once at boot: after the catalogs land, not again because they landed", async () => {
    let land: (v: unknown) => void = () => {};
    m.modules.list.mockReturnValueOnce(new Promise((r) => { land = r; }));
    const health = useHealthStore();
    expect(health.ensure()).toBe(true);
    expect(health.ensure()).toBe(false);
    // A page asking for a scan while the first one waits joins it.
    void health.refresh();
    await flushPromises();
    expect(m.health.scan).not.toHaveBeenCalled();
    expect(health.loading).toBe(true);
    land({ items: [row("aaaa0001")], total: 1 });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(2000);
    expect(m.health.scan).toHaveBeenCalledTimes(1);
    expect(m.modules.list).toHaveBeenCalledTimes(1);
  });

  it("scans again once after a later library change", async () => {
    m.modules.list.mockResolvedValue({ items: [row("aaaa0001")], total: 1 });
    m.modules.update.mockResolvedValue(row("aaaa0001", "2026-02-02"));
    const health = useHealthStore();
    health.ensure();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(2000);
    expect(m.health.scan).toHaveBeenCalledTimes(1);
    await useModuleStore().update("aaaa0001", { name: "x" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(m.health.scan).toHaveBeenCalledTimes(2);
  });
});
