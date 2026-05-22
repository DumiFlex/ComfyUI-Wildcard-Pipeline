import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../../api/client";
import {
  buildCommitPayload,
  type CommitPayload,
  type ResolvedCategoryEntity,
  type ResolvedEntity,
  type ResolvedSelection,
} from "../commit";

// ── helpers ─────────────────────────────────────────────────────────────

function emptySelection(): ResolvedSelection {
  return {
    bundles: [],
    wildcards: [],
    fixed_values: [],
    combines: [],
    derivations: [],
    constraints: [],
    categories: [],
  };
}

function row(id: string, name = "x"): ResolvedEntity["entity"] {
  return { id, name, payload: { options: [] }, tags: [] };
}

function cat(id: string, name = "Style"): ResolvedCategoryEntity["entity"] {
  return { id, name, color: null };
}

// ── buildCommitPayload ──────────────────────────────────────────────────

describe("buildCommitPayload", () => {
  it("partitions all three decision kinds for wildcards", () => {
    const sel = emptySelection();
    sel.wildcards = [
      { entity: row("w1", "alpha"), decision: { kind: "add" } },
      { entity: row("w2", "beta"), decision: { kind: "replace" } },
      {
        entity: row("w3", "gamma"),
        decision: { kind: "rename", new_id: "w3_new", new_name: "gamma (imported)" },
      },
    ];
    const result = buildCommitPayload(sel);

    expect(result.adds).toHaveLength(1);
    expect(result.adds[0]?.kind).toBe("wildcard");
    expect((result.adds[0]?.entity as { id: string }).id).toBe("w1");

    expect(result.replaces).toHaveLength(1);
    expect(result.replaces[0]?.kind).toBe("wildcard");
    expect(result.replaces[0]?.id).toBe("w2");
    expect((result.replaces[0]?.new_content as { id: string }).id).toBe("w2");

    expect(result.renames).toHaveLength(1);
    expect(result.renames[0]?.kind).toBe("wildcard");
    expect(result.renames[0]?.old_id).toBe("w3");
    expect(result.renames[0]?.new_id).toBe("w3_new");
    expect((result.renames[0]?.content as { id: string }).id).toBe("w3_new");
  });

  it("partitions adds across all 7 entity kinds", () => {
    const sel: ResolvedSelection = {
      bundles: [{ entity: row("b1"), decision: { kind: "add" } }],
      wildcards: [{ entity: row("w1"), decision: { kind: "add" } }],
      fixed_values: [{ entity: row("f1"), decision: { kind: "add" } }],
      combines: [{ entity: row("co1"), decision: { kind: "add" } }],
      derivations: [{ entity: row("d1"), decision: { kind: "add" } }],
      constraints: [{ entity: row("cn1"), decision: { kind: "add" } }],
      categories: [{ entity: cat("cat1"), decision: { kind: "add" } }],
    };
    const result = buildCommitPayload(sel);
    expect(result.adds).toHaveLength(7);
    expect(result.replaces).toHaveLength(0);
    expect(result.renames).toHaveLength(0);

    // Order mirrors the partitioner call order; the contract doesn't lock
    // order on the wire but locking it here keeps regressions visible.
    const kinds = result.adds.map((a) => a.kind);
    expect(kinds).toEqual([
      "bundle",
      "wildcard",
      "fixed_values",
      "combine",
      "derivation",
      "constraint",
      "category",
    ]);
  });

  it("stamps new_id onto content.id for renames", () => {
    const sel = emptySelection();
    sel.bundles = [{
      entity: row("b_orig", "pack"),
      decision: { kind: "rename", new_id: "b_fresh", new_name: "pack (imported)" },
    }];
    const result = buildCommitPayload(sel);
    expect(result.renames).toHaveLength(1);
    const r = result.renames[0]!;
    expect(r.kind).toBe("bundle");
    expect(r.old_id).toBe("b_orig");
    expect(r.new_id).toBe("b_fresh");
    // content.id MUST equal new_id — the engine inserts the row at new_id,
    // and reading the wrong id from content would orphan the row.
    expect((r.content as { id: string }).id).toBe("b_fresh");
  });

  it("stamps new_name onto content.name for renames", () => {
    const sel = emptySelection();
    sel.constraints = [{
      entity: row("cn_orig", "exclusive"),
      decision: { kind: "rename", new_id: "cn_fresh", new_name: "exclusive (imported)" },
    }];
    const result = buildCommitPayload(sel);
    expect(result.renames).toHaveLength(1);
    expect((result.renames[0]?.content as { name: string }).name).toBe(
      "exclusive (imported)",
    );
  });

  it("rejects category decisions other than add at the type level", () => {
    const sel: ResolvedSelection = emptySelection();
    // The picker can only ever produce {kind:"add"} for categories.
    // Trying to wire a replace decision must fail at compile time.
    sel.categories = [
      // @ts-expect-error — categories accept only {kind:"add"}; replace is invalid.
      { entity: cat("cat_x"), decision: { kind: "replace" } },
    ];
    // Runtime: even if someone bypasses the type system, the defensive
    // dispatch in buildCommitPayload only emits when kind === "add", so
    // a smuggled-in replace silently drops rather than corrupting the
    // server contract. Verify the result actually filters it out.
    const result = buildCommitPayload(sel);
    expect(result.adds).toHaveLength(0);
    expect(result.replaces).toHaveLength(0);
    expect(result.renames).toHaveLength(0);
  });

  it("returns three empty arrays for an empty selection", () => {
    const result = buildCommitPayload(emptySelection());
    expect(result).toEqual({ adds: [], replaces: [], renames: [] });
  });
});

// ── api.importExport.commit + undo ──────────────────────────────────────

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

describe("api.importExport.commit", () => {
  it("POSTs to /wp/api/import/commit and returns undo_entry_id", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: true, undo_entry_id: "abc123", summary: { added: 1 } }),
    );
    const payload: CommitPayload = { adds: [], replaces: [], renames: [] };
    const result = await api.importExport.commit(payload);
    expect(result.undo_entry_id).toBe("abc123");
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/wp/api/import/commit");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      adds: [], replaces: [], renames: [],
    });
  });

  it("throws ApiError on 400 with the server-supplied message", async () => {
    // Mock returns a *fresh* Response per call. Response bodies can only
    // be read once, so a single shared Response across two calls would
    // give us an empty body the second time.
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(
        { error: "module id collision on add: 'aabbccdd'" }, 400,
      )),
    );
    let caught: unknown;
    try {
      await api.importExport.commit({ adds: [], replaces: [], renames: [] });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({
      status: 400,
      message: expect.stringContaining("collision"),
    });
  });
});

describe("api.importExport.undo", () => {
  it("POSTs to /wp/api/import/undo with undo_entry_id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const result = await api.importExport.undo("abc123");
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/wp/api/import/undo");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      undo_entry_id: "abc123",
    });
  });

  it("throws ApiError on 404 (unknown undo_entry_id)", async () => {
    // mockImplementation returns a fresh Response per call so each
    // assertion can re-parse the body — see the 400 test above.
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(
        { error: "undo entry 'ghost' not found" }, 404,
      )),
    );
    let caught: unknown;
    try {
      await api.importExport.undo("ghost");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({
      status: 404,
      message: expect.stringContaining("not found"),
    });
  });
});
