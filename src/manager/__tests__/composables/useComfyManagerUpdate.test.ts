import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComfyManagerUpdate } from "../../composables/useComfyManagerUpdate";
import { detectManager, type ManagerFlavor } from "../../utils/comfy-manager-api";

(globalThis as unknown as { __APP_VERSION__: string }).__APP_VERSION__ = "2.9.0";

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.useRealTimers());

type Res = { ok: boolean; status?: number; text?: string; json?: unknown };

function res(o: Res, headers: Record<string, string> = {}): Response {
  return {
    ok: o.ok,
    status: o.status ?? (o.ok ? 200 : 500),
    text: async () => o.text ?? "",
    json: async () => o.json ?? {},
    headers: new Headers(headers),
  } as Response;
}

/** Fake server: answers the routes of ONE Manager flavor (others 404) plus
 *  our own `/wp` config route. */
function mockManager(opts: {
  flavor?: ManagerFlavor;
  install?: Res;
  start?: Res;
  status?: unknown;
  reboot?: () => Promise<Response>;
  /** Successive `/wp` identities; the last one repeats. null = server down. */
  servers?: ({ startupId: string; version: string } | null)[];
} = {}) {
  const flavor = opts.flavor ?? "v3";
  const prefix = flavor === "v3" ? "/manager" : "/v2/manager";
  const servers = opts.servers ?? [{ startupId: "a", version: "2.9.0" }, { startupId: "b", version: "2.10.0" }];
  let serverCalls = 0;
  return vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === "/wp/api/database/config") {
      const s = servers[Math.min(serverCalls++, servers.length - 1)];
      if (s === null) throw new Error("ECONNREFUSED");
      return res({ ok: true }, { "X-WP-Startup-Id": s.startupId, "X-WP-Version": s.version });
    }
    if (!url.startsWith(`${prefix}/`)) return res({ ok: false, status: 404 });
    const path = url.slice(prefix.length);
    if (path === "/is_legacy_manager_ui") {
      return res({ ok: true, json: { is_legacy_manager_ui: flavor === "v4-legacy" } });
    }
    if (path === "/queue/install" || path === "/queue/task" || path === "/queue/batch") {
      return res(opts.install ?? { ok: true, json: { failed: [] } });
    }
    if (path === "/queue/start") return res(opts.start ?? { ok: true });
    if (path === "/queue/status") {
      return res({ ok: true, json: opts.status ?? { total_count: 1, done_count: 1, is_processing: false } });
    }
    if (path === "/reboot") return opts.reboot ? opts.reboot() : res({ ok: true });
    return res({ ok: false, status: 404 });
  });
}

function bodyOf(fetchMock: ReturnType<typeof mockManager>, path: string): Record<string, unknown> {
  const call = fetchMock.mock.calls.find((c) => String(c[0]) === path);
  expect(call, `expected a call to ${path}`).toBeTruthy();
  return JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
}

function stubReload() {
  const reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  });
  return reload;
}

describe("detectManager", () => {
  it.each<ManagerFlavor>(["v3", "v4", "v4-legacy"])("recognises %s", async (flavor) => {
    vi.stubGlobal("fetch", mockManager({ flavor }));
    expect(await detectManager()).toBe(flavor);
  });

  it("returns null when no Manager answers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no manager")));
    expect(await detectManager()).toBeNull();
  });
});

describe("useComfyManagerUpdate", () => {
  it("probe returns available when a Manager answers", async () => {
    vi.stubGlobal("fetch", mockManager({ flavor: "v4" }));
    const u = useComfyManagerUpdate();
    expect(await u.probe()).toBe("available");
  });

  it("probe returns absent on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no manager")));
    const u = useComfyManagerUpdate();
    expect(await u.probe()).toBe("absent");
  });

  it("legacy Manager: queues on /manager/queue/install, pinned + remote", async () => {
    const fetchMock = mockManager();
    vi.stubGlobal("fetch", fetchMock);
    const u = useComfyManagerUpdate();
    const p = u.runUpdate("2.10.0"); // newer than __APP_VERSION__ 2.9.0
    expect(u.phase.value).toBe("installing");
    await p;
    expect(u.phase.value).toBe("staged");
    const body = bodyOf(fetchMock, "/manager/queue/install");
    expect(body.selected_version).toBe("2.10.0");
    expect(body.mode).toBe("remote");
    expect(fetchMock.mock.calls.some((c) => c[0] === "/manager/queue/start")).toBe(true);
  });

  it("built-in Manager: queues an install task on /v2/manager/queue/task", async () => {
    const fetchMock = mockManager({ flavor: "v4" });
    vi.stubGlobal("fetch", fetchMock);
    const u = useComfyManagerUpdate();
    await u.runUpdate("2.10.0");
    expect(u.phase.value).toBe("staged");
    const body = bodyOf(fetchMock, "/v2/manager/queue/task");
    expect(body.kind).toBe("install");
    expect(body.ui_id).toEqual(expect.any(String));
    expect(body.client_id).toEqual(expect.any(String));
    expect(body.params).toMatchObject({ id: "comfyui-wildcard-pipeline", selected_version: "2.10.0", mode: "remote" });
    expect(fetchMock.mock.calls.some((c) => c[0] === "/v2/manager/queue/start")).toBe(true);
    expect(fetchMock.mock.calls.some((c) => c[0] === "/manager/queue/install")).toBe(false);
  });

  it("built-in Manager with the legacy UI: installs through /v2/manager/queue/batch", async () => {
    const fetchMock = mockManager({ flavor: "v4-legacy" });
    vi.stubGlobal("fetch", fetchMock);
    const u = useComfyManagerUpdate();
    await u.runUpdate("2.10.0");
    expect(u.phase.value).toBe("staged");
    const body = bodyOf(fetchMock, "/v2/manager/queue/batch") as { install: Record<string, unknown>[] };
    expect(body.install[0]).toMatchObject({ id: "comfyui-wildcard-pipeline", selected_version: "2.10.0" });
    // The batch call starts the queue itself.
    expect(fetchMock.mock.calls.some((c) => c[0] === "/v2/manager/queue/start")).toBe(false);
  });

  it("built-in Manager with the legacy UI: a refused batch item is a forbidden error", async () => {
    vi.stubGlobal("fetch", mockManager({
      flavor: "v4-legacy",
      install: { ok: true, json: { failed: ["comfyui-wildcard-pipeline"] } },
    }));
    const u = useComfyManagerUpdate();
    await u.runUpdate("2.10.0");
    expect(u.phase.value).toBe("error");
    expect(u.errorKind.value).toBe("forbidden");
  });

  it("runUpdate refuses a downgrade / non-newer target (2.10.0 bug guard)", async () => {
    const fetchMock = mockManager();
    vi.stubGlobal("fetch", fetchMock);
    const u = useComfyManagerUpdate();
    await u.runUpdate("2.8.0"); // older than installed 2.9.0
    expect(u.phase.value).toBe("error");
    expect(u.errorKind.value).toBe("failed");
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/queue/install"))).toBe(false);
  });

  it("runUpdate maps install 403 to forbidden error", async () => {
    vi.stubGlobal("fetch", mockManager({ install: { ok: false, status: 403, text: "security" } }));
    const u = useComfyManagerUpdate();
    await u.runUpdate("2.10.0");
    expect(u.phase.value).toBe("error");
    expect(u.errorKind.value).toBe("forbidden");
  });

  it("runUpdate maps a non-403 install failure to failed error", async () => {
    vi.stubGlobal("fetch", mockManager({ install: { ok: false, status: 500, text: "boom" } }));
    const u = useComfyManagerUpdate();
    await u.runUpdate("2.10.0");
    expect(u.phase.value).toBe("error");
    expect(u.errorKind.value).toBe("failed");
  });

  it("reboot waits for the new process and reloads when it runs the target version", async () => {
    vi.useFakeTimers();
    const reload = stubReload();
    const fetchMock = mockManager({
      flavor: "v4",
      reboot: () => Promise.reject(new Error("socket closed")),
      // before restart, old process still up, server down, new process
      servers: [
        { startupId: "a", version: "2.9.0" },
        { startupId: "a", version: "2.9.0" },
        null,
        { startupId: "b", version: "2.10.0" },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const u = useComfyManagerUpdate();
    await u.probe();
    await u.runUpdate("2.10.0");
    const p = u.reboot();
    expect(u.phase.value).toBe("restarting");
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    expect(fetchMock.mock.calls.some((c) => c[0] === "/v2/manager/reboot")).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(u.errorKind.value).toBeNull();
  });

  it("reboot reports not_applied when the restarted server still runs the old version", async () => {
    vi.useFakeTimers();
    const reload = stubReload();
    vi.stubGlobal("fetch", mockManager({
      servers: [{ startupId: "a", version: "2.9.0" }, { startupId: "b", version: "2.9.0" }],
    }));
    const u = useComfyManagerUpdate();
    await u.runUpdate("2.10.0");
    const p = u.reboot();
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(reload).not.toHaveBeenCalled();
    expect(u.phase.value).toBe("error");
    expect(u.errorKind.value).toBe("not_applied");
    expect(u.errorMessage.value).toContain("v2.9.0");
  });

  it("reboot gives up with an error when ComfyUI never comes back", async () => {
    vi.useFakeTimers();
    const reload = stubReload();
    vi.stubGlobal("fetch", mockManager({ servers: [{ startupId: "a", version: "2.9.0" }, null] }));
    const u = useComfyManagerUpdate();
    await u.runUpdate("2.10.0");
    const p = u.reboot();
    await vi.advanceTimersByTimeAsync(200_000);
    await p;
    expect(reload).not.toHaveBeenCalled();
    expect(u.errorKind.value).toBe("failed");
  });
});
