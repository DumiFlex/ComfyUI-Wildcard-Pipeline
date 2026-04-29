import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api/client";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("api.modules", () => {
  it("list passes type + q query params", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], total: 0 }));
    await api.modules.list({ type: "wildcard", q: "foo" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/wp/api/modules?type=wildcard&q=foo");
    expect(init).toMatchObject({ method: "GET" });
  });

  it("list omits empty params", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], total: 0 }));
    await api.modules.list({});
    expect(fetchMock.mock.calls[0]![0]).toBe("/wp/api/modules");
  });

  it("list maps favorites=true → '1'", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], total: 0 }));
    await api.modules.list({ favorites: true });
    expect(fetchMock.mock.calls[0]![0]).toBe("/wp/api/modules?favorites=1");
  });

  it("create posts JSON body", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "1234abcd", type: "wildcard", name: "x" }, 201),
    );
    const row = await api.modules.create({ type: "wildcard", name: "x", payload: {} });
    expect(row.id).toBe("1234abcd");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ type: "wildcard", name: "x", payload: {} });
  });

  it("404 throws ApiError with status + message", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "module not found" }, 404));
    await expect(api.modules.get("ghost")).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining("module not found"),
    });
  });

  it("204 returns undefined", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const result = await api.modules.delete("wc_a");
    expect(result).toBeUndefined();
  });

  it("snapshot calls POST", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ library_id: "x" }));
    await api.modules.snapshot("wc_a_111");
    expect(fetchMock).toHaveBeenCalledWith(
      "/wp/api/modules/wc_a_111/snapshot",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("duplicate calls POST", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "wc_a_111_copy" }, 201));
    await api.modules.duplicate("wc_a_111");
    expect(fetchMock).toHaveBeenCalledWith(
      "/wp/api/modules/wc_a_111/duplicate",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("favorite calls POST", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "wc_a_111", is_favorite: true }));
    await api.modules.favorite("wc_a_111");
    expect(fetchMock).toHaveBeenCalledWith(
      "/wp/api/modules/wc_a_111/favorite",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("match posts body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ matched: false }));
    await api.modules.match({ type: "wildcard", name: "x", payload_hash: "abc" });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      type: "wildcard", name: "x", payload_hash: "abc",
    });
  });
});

describe("api.categories", () => {
  it("create posts body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "style", name: "Style" }, 201));
    await api.categories.create({ name: "Style", color: "#a970ff" });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).name).toBe("Style");
  });

  it("409 throws ApiError", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "category name not unique: 'Style'" }, 409));
    await expect(api.categories.create({ name: "Style" })).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe("api.test + api.exportBundle + api.importBundle", () => {
  it("test endpoint forwards samples", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [], histogram: {} }));
    await api.test({ type: "wildcard", payload: {}, instance: {}, samples: 3 });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string).samples).toBe(3);
  });

  it("exportBundle returns JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ version: 1, modules: [], categories: [] }));
    const bundle = await api.exportBundle();
    expect(bundle.version).toBe(1);
  });

  it("importBundle posts body", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ modules_imported: 1, categories_imported: 0, skipped: [] }),
    );
    await api.importBundle({ version: 1, modules: [], categories: [] });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
  });
});

describe("ApiError", () => {
  it("captures status code", () => {
    const e = new ApiError(500, "boom");
    expect(e.status).toBe(500);
    expect(e.message).toBe("boom");
    expect(e.name).toBe("ApiError");
  });
});
