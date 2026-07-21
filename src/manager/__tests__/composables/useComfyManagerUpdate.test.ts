import { beforeEach, describe, expect, it, vi } from "vitest";
import { useComfyManagerUpdate } from "../../composables/useComfyManagerUpdate";

(globalThis as unknown as { __APP_VERSION__: string }).__APP_VERSION__ = "2.9.0";

beforeEach(() => vi.restoreAllMocks());

/** Route a fetch mock by URL + method. `status` route returns `done`
 *  immediately unless overridden. */
function mockManager(opts: {
  install?: { ok: boolean; status?: number; text?: string };
  start?: { ok: boolean };
  status?: unknown;
  reboot?: () => Promise<Response>;
} = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.includes("/manager/queue/install")) {
      const o = opts.install ?? { ok: true };
      return { ok: o.ok, status: o.status ?? (o.ok ? 200 : 500), text: async () => o.text ?? "" } as Response;
    }
    if (url.includes("/manager/queue/start")) {
      const o = opts.start ?? { ok: true };
      return { ok: o.ok, status: o.ok ? 200 : 500, text: async () => "" } as Response;
    }
    if (url.includes("/manager/queue/status")) {
      const s = opts.status ?? { total_count: 1, done_count: 1, in_progress: false };
      return { ok: true, status: 200, json: async () => s } as Response;
    }
    if (url.includes("/manager/reboot")) {
      if (opts.reboot) return opts.reboot();
      return { ok: true, status: 200, text: async () => "" } as Response;
    }
    void method;
    throw new Error(`unexpected url ${url}`);
  });
}

describe("useComfyManagerUpdate", () => {
  it("probe returns available on 200 status", async () => {
    vi.stubGlobal("fetch", mockManager());
    const u = useComfyManagerUpdate();
    expect(await u.probe()).toBe("available");
  });

  it("probe returns absent on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no manager")));
    const u = useComfyManagerUpdate();
    expect(await u.probe()).toBe("absent");
  });

  it("runUpdate happy path: idle -> installing -> staged", async () => {
    vi.stubGlobal("fetch", mockManager());
    const u = useComfyManagerUpdate();
    const p = u.runUpdate();
    expect(u.phase.value).toBe("installing");
    await p;
    expect(u.phase.value).toBe("staged");
  });

  it("runUpdate maps install 403 to forbidden error", async () => {
    vi.stubGlobal("fetch", mockManager({ install: { ok: false, status: 403, text: "security" } }));
    const u = useComfyManagerUpdate();
    await u.runUpdate();
    expect(u.phase.value).toBe("error");
    expect(u.errorKind.value).toBe("forbidden");
  });

  it("runUpdate maps a non-403 install failure to failed error", async () => {
    vi.stubGlobal("fetch", mockManager({ install: { ok: false, status: 500, text: "boom" } }));
    const u = useComfyManagerUpdate();
    await u.runUpdate();
    expect(u.phase.value).toBe("error");
    expect(u.errorKind.value).toBe("failed");
  });

  it("reboot sets restarting and treats a dropped connection as soft success", async () => {
    vi.stubGlobal("fetch", mockManager({ reboot: () => Promise.reject(new Error("socket closed")) }));
    const u = useComfyManagerUpdate();
    await u.reboot();
    expect(u.phase.value).toBe("restarting");
    expect(u.errorKind.value).toBeNull();
  });
});
