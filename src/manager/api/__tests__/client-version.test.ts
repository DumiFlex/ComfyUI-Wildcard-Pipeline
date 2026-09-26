import { afterEach, describe, expect, it, vi } from "vitest";

// Fresh module per test: the client keeps its startup-id / version cache
// at module scope.
async function loadClient() {
  vi.resetModules();
  return (await import("../client")).api;
}

function respond(headers: Record<string, string>) {
  return new Response(JSON.stringify({ items: [], total: 0 }), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("api client — installed version check", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("flags the page stale once, with the new version, when the pack was updated", async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      respond({ "X-WP-Startup-Id": "a", "X-WP-Version": "9.9.9" }));
    vi.stubGlobal("fetch", fetchMock);
    const seen: unknown[] = [];
    const onEvent = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("wp:server-restarted", onEvent);
    const api = await loadClient();
    await api.categories.list();
    await api.categories.list();
    window.removeEventListener("wp:server-restarted", onEvent);
    expect(seen).toEqual([{ version: "9.9.9" }]);
  });

  it("stays quiet when the installed version matches this build", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () =>
      respond({ "X-WP-Startup-Id": "a", "X-WP-Version": __APP_VERSION__ })));
    const onEvent = vi.fn();
    window.addEventListener("wp:server-restarted", onEvent);
    const api = await loadClient();
    await api.categories.list();
    window.removeEventListener("wp:server-restarted", onEvent);
    expect(onEvent).not.toHaveBeenCalled();
  });
});
