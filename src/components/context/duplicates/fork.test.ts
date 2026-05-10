// forkModule — POSTs an edited draft to /wp/api/modules creating a
// new library entry. Returns the new uuid + hash + suffixed name so
// the caller can swap them onto the local draft.
//
// Auto-suffixes the display name with " (copy)", " (copy 2)", etc.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { forkModule } from "./fork";

beforeEach(() => {
  global.fetch = vi.fn();
});

describe("forkModule", () => {
  it("POSTs to /wp/api/modules with edited payload + meta", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "new123", payload_hash: "h_new" }),
    } as Response);

    const draft = {
      id: "old456",
      type: "wildcard" as const,
      meta: { name: "hair_style" },
      payload: { options: [] },
    };
    const result = await forkModule(draft, new Set(["hair_style"]));
    expect(result.newId).toBe("new123");
    expect(result.newHash).toBe("h_new");
    expect(result.suffixedName).toBe("hair_style (copy)");

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("/wp/api/modules");
    const body = JSON.parse(call[1].body);
    expect(body.type).toBe("wildcard");
    expect(body.name).toBe("hair_style (copy)");
    expect(body.payload).toEqual({ options: [] });
  });

  it("escalates to (copy 2) when (copy) already exists in library", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "n2", payload_hash: "h2" }),
    } as Response);
    const draft = {
      id: "old",
      type: "wildcard" as const,
      meta: { name: "hair_style" },
      payload: {},
    };
    const existingNames = new Set(["hair_style", "hair_style (copy)"]);
    const result = await forkModule(draft, existingNames);
    expect(result.suffixedName).toBe("hair_style (copy 2)");
  });

  it("strips existing (copy) suffix before bumping", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "n3", payload_hash: "h3" }),
    } as Response);
    const draft = {
      id: "old",
      type: "wildcard" as const,
      meta: { name: "hair_style (copy)" },
      payload: {},
    };
    const existingNames = new Set(["hair_style", "hair_style (copy)"]);
    const result = await forkModule(draft, existingNames);
    expect(result.suffixedName).toBe("hair_style (copy 2)");
  });

  it("throws on HTTP error", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);
    const draft = { id: "old", type: "wildcard" as const, meta: { name: "x" }, payload: {} };
    await expect(forkModule(draft, new Set())).rejects.toThrow("HTTP 500");
  });

  it("throws on uuid collision (409)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 409,
    } as Response);
    const draft = { id: "old", type: "wildcard" as const, meta: { name: "x" }, payload: {} };
    await expect(forkModule(draft, new Set())).rejects.toThrow("HTTP 409");
  });
});
