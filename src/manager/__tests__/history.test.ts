import { describe, expect, it } from "vitest";
import {
  HISTORY_MAX,
  appendSnapshot,
  readHistory,
  stripHistory,
} from "../utils/history";
import type { ModuleHistoryEntry } from "../api/types";

const baseRecord = (overrides: Partial<{ name: string; description: string; tags: string[] }> = {}) => ({
  name: "alpha",
  description: "",
  category_id: null,
  tags: [],
  ...overrides,
});

describe("readHistory", () => {
  it("returns [] when payload is missing or wrong shape", () => {
    expect(readHistory(undefined)).toEqual([]);
    expect(readHistory(null)).toEqual([]);
    expect(readHistory("nope")).toEqual([]);
    expect(readHistory({})).toEqual([]);
  });

  it("returns [] when history key is not an array", () => {
    expect(readHistory({ history: "string" })).toEqual([]);
    expect(readHistory({ history: 42 })).toEqual([]);
  });

  it("filters out malformed entries", () => {
    const valid: ModuleHistoryEntry = {
      saved_at: "2025-01-01T00:00:00Z",
      name: "ok",
      payload: {},
    };
    const out = readHistory({
      history: [valid, null, { saved_at: 1, name: "bad" }, { name: "no-ts", payload: {} }],
    });
    expect(out).toEqual([valid]);
  });

  it("returns the entries when shape is valid", () => {
    const entries: ModuleHistoryEntry[] = [
      { saved_at: "2025-01-01T00:00:00Z", name: "v1", payload: { foo: 1 } },
      { saved_at: "2025-01-02T00:00:00Z", name: "v2", payload: { foo: 2 } },
    ];
    expect(readHistory({ history: entries })).toEqual(entries);
  });
});

describe("stripHistory", () => {
  it("removes the history key without mutating the input", () => {
    const original = { foo: 1, bar: "x", history: [{ a: 1 }] };
    const out = stripHistory(original);
    expect(out).toEqual({ foo: 1, bar: "x" });
    // Input is untouched.
    expect("history" in original).toBe(true);
  });

  it("returns an empty object for nullish/non-object input", () => {
    expect(stripHistory(undefined as unknown as Record<string, unknown>)).toEqual({});
    expect(stripHistory(null as unknown as Record<string, unknown>)).toEqual({});
  });

  it("preserves untouched payloads", () => {
    expect(stripHistory({ a: 1, b: [1, 2] })).toEqual({ a: 1, b: [1, 2] });
  });
});

describe("appendSnapshot", () => {
  it("adds a new entry when no prior history exists", () => {
    const next = appendSnapshot(baseRecord({ name: "v1" }), { foo: 1 });
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe("v1");
    expect(next[0].payload).toEqual({ foo: 1 });
    expect(next[0].saved_at).toMatch(/^\d{4}-/);
  });

  it("preserves prior entries", () => {
    const earlier: ModuleHistoryEntry = {
      saved_at: "2024-01-01T00:00:00Z",
      name: "older",
      payload: { foo: 0 },
    };
    const oldPayload: Record<string, unknown> = { foo: 1, history: [earlier] };
    const next = appendSnapshot(baseRecord({ name: "v2" }), oldPayload);
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(earlier);
    expect(next[1].name).toBe("v2");
  });

  it("trims to HISTORY_MAX (oldest dropped) after 4 saves", () => {
    expect(HISTORY_MAX).toBe(3);

    // Save 1: payload starts with no history.
    let payload: Record<string, unknown> = { v: 1 };
    let history = appendSnapshot(baseRecord({ name: "v1" }), payload);
    payload = { v: 2, history };

    // Save 2.
    history = appendSnapshot(baseRecord({ name: "v2" }), payload);
    payload = { v: 3, history };

    // Save 3.
    history = appendSnapshot(baseRecord({ name: "v3" }), payload);
    payload = { v: 4, history };

    // Save 4 — pre-save record was "v4" with v=4, going to "v5".
    history = appendSnapshot(baseRecord({ name: "v4" }), payload);

    expect(history).toHaveLength(HISTORY_MAX);
    expect(history.map((h) => h.name)).toEqual(["v2", "v3", "v4"]);
  });

  it("strips history from the snapshot's stored payload (no nesting)", () => {
    const earlier: ModuleHistoryEntry = {
      saved_at: "2024-01-01T00:00:00Z",
      name: "older",
      payload: { foo: 0 },
    };
    const oldPayload: Record<string, unknown> = { foo: 1, history: [earlier] };
    const recordPayload: Record<string, unknown> = { foo: 1, history: [earlier] };
    const next = appendSnapshot(
      { ...baseRecord({ name: "v2" }), payload: recordPayload },
      oldPayload,
    );
    const snap = next[next.length - 1];
    expect("history" in snap.payload).toBe(false);
    expect(snap.payload).toEqual({ foo: 1 });
  });

  it("clones tags so later mutation doesn't reach the snapshot", () => {
    const tags = ["a", "b"];
    const next = appendSnapshot(
      baseRecord({ tags }),
      {},
    );
    tags.push("c");
    expect(next[0].tags).toEqual(["a", "b"]);
  });
});
