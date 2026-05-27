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
    templates: [],
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

  it("partitions all three decision kinds for templates", () => {
    const sel = emptySelection();
    sel.templates = [
      { entity: row("t1", "hero"), decision: { kind: "add" } },
      { entity: row("t2", "scene"), decision: { kind: "replace" } },
      {
        entity: row("t3", "mood"),
        decision: { kind: "rename", new_id: "t3_new", new_name: "mood (imported)" },
      },
    ];
    const result = buildCommitPayload(sel);

    const addT = result.adds.find((a) => a.kind === "template");
    expect(addT).toBeDefined();
    expect((addT!.entity as { id: string }).id).toBe("t1");

    const repT = result.replaces.find((r) => r.kind === "template");
    expect(repT).toBeDefined();
    expect(repT!.id).toBe("t2");

    const renT = result.renames.find((r) => r.kind === "template");
    expect(renT).toBeDefined();
    expect(renT!.old_id).toBe("t3");
    expect(renT!.new_id).toBe("t3_new");
    expect((renT!.content as { name: string }).name).toBe("mood (imported)");
  });

  it("partitions adds across all 8 entity kinds", () => {
    const sel: ResolvedSelection = {
      bundles: [{ entity: row("b1"), decision: { kind: "add" } }],
      wildcards: [{ entity: row("w1"), decision: { kind: "add" } }],
      fixed_values: [{ entity: row("f1"), decision: { kind: "add" } }],
      combines: [{ entity: row("co1"), decision: { kind: "add" } }],
      derivations: [{ entity: row("d1"), decision: { kind: "add" } }],
      constraints: [{ entity: row("cn1"), decision: { kind: "add" } }],
      categories: [{ entity: cat("cat1"), decision: { kind: "add" } }],
      templates: [{ entity: row("t1"), decision: { kind: "add" } }],
    };
    const result = buildCommitPayload(sel);
    expect(result.adds).toHaveLength(8);
    expect(result.replaces).toHaveLength(0);
    expect(result.renames).toHaveLength(0);

    // Order mirrors the partitioner call order; the contract doesn't lock
    // order on the wire but locking it here keeps regressions visible.
    // Templates partition AFTER constraints, BEFORE categories.
    const kinds = result.adds.map((a) => a.kind);
    expect(kinds).toEqual([
      "bundle",
      "wildcard",
      "fixed_values",
      "combine",
      "derivation",
      "constraint",
      "template",
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

  it("throws if category bucket receives a non-add decision (defensive runtime guard)", () => {
    // The picker can only ever produce {kind:"add"} for categories;
    // CategoryDecision narrows the type so any other decision must fail
    // at compile time. Runtime: if the type narrowing is ever loosened
    // (or someone smuggles in a value via `as any`), the partitioner
    // must throw rather than silently drop — a silent drop would hide
    // the bug and the user would see "I clicked replace and nothing
    // happened" with no diagnostic trail.
    expect(() =>
      buildCommitPayload({
        bundles: [],
        wildcards: [],
        fixed_values: [],
        combines: [],
        derivations: [],
        constraints: [],
        templates: [],
        categories: [
          // @ts-expect-error — runtime guard for if TS narrowing is ever loosened.
          { entity: cat("cat_x"), decision: { kind: "replace" } },
        ],
      }),
    ).toThrow(/non-add decision/i);
  });

  it("rename strips source-DB timestamps + version + recomputable hashes from content", () => {
    // The server's _insert_module / _insert_bundle copy client-supplied
    // created_at / updated_at / version / snapshot_fingerprint /
    // payload_hash verbatim and only fall back to now() / recompute
    // when those fields are absent. The rename path MUST strip them so
    // the imported row lands with fresh lifecycle metadata — otherwise
    // newest-first sort breaks and the cached fingerprint is keyed
    // against the wrong id.
    const result = buildCommitPayload({
      bundles: [],
      wildcards: [
        {
          entity: {
            id: "aabb1111",
            name: "old",
            description: "",
            tags: [],
            payload: {},
            payload_hash: "stale",
            snapshot_fingerprint: "stalefp",
            version: 17,
            created_at: "2020-01-01T00:00:00Z",
            updated_at: "2020-01-02T00:00:00Z",
          },
          decision: { kind: "rename", new_id: "ccdd2222", new_name: "renamed" },
        },
      ],
      fixed_values: [],
      combines: [],
      derivations: [],
      constraints: [],
      categories: [],
      templates: [],
    });
    expect(result.renames).toHaveLength(1);
    const content = result.renames[0]!.content as Record<string, unknown>;
    expect(content.id).toBe("ccdd2222");
    expect(content.name).toBe("renamed");
    expect(content).not.toHaveProperty("created_at");
    expect(content).not.toHaveProperty("updated_at");
    expect(content).not.toHaveProperty("version");
    expect(content).not.toHaveProperty("snapshot_fingerprint");
    expect(content).not.toHaveProperty("payload_hash");
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
