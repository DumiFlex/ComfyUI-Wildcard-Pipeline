import { describe, expect, it, vi } from "vitest";
import { createLibraryCache, filterRows, replaceRow, STALE_MS } from "../libraryCache";

const rows = [
  { id: "aa11bb22", name: "Hair Color", type: "wildcard", category_id: "c1", is_favorite: true },
  { id: "cc33dd44", name: "Mood", type: "wildcard", category_id: null, is_favorite: false },
  { id: "ee55ff66", name: "Hair rule", type: "constraint", category_id: "c1", is_favorite: false },
];

describe("filterRows", () => {
  it("matches the server's list filter: kind, category, favourites, name-or-id substring", () => {
    expect(filterRows(rows, {}).map((r) => r.id)).toEqual(["aa11bb22", "cc33dd44", "ee55ff66"]);
    expect(filterRows(rows, {})).not.toBe(rows);
    expect(filterRows(rows, { q: "hair" }).map((r) => r.id)).toEqual(["aa11bb22", "ee55ff66"]);
    expect(filterRows(rows, { q: "DD4" }).map((r) => r.id)).toEqual(["cc33dd44"]);
    expect(filterRows(rows, { type: "wildcard", q: "hair" }).map((r) => r.id)).toEqual(["aa11bb22"]);
    expect(filterRows(rows, { category: "c1" }).map((r) => r.id)).toEqual(["aa11bb22", "ee55ff66"]);
    expect(filterRows(rows, { favorites: true }).map((r) => r.id)).toEqual(["aa11bb22"]);
    // `%` / `_` are literal, as the server escapes them.
    expect(filterRows(rows, { q: "%" })).toEqual([]);
  });
});

describe("replaceRow", () => {
  it("returns a new array with the row swapped, or the same array when absent", () => {
    const next = replaceRow(rows, { ...rows[1], name: "Calm" });
    expect(next).not.toBe(rows);
    expect(next[1].name).toBe("Calm");
    expect(rows[1].name).toBe("Mood");
    expect(replaceRow(rows, { ...rows[0], id: "zzzz0000" })).toBe(rows);
  });
});

describe("createLibraryCache", () => {
  it("shares one request between callers and revalidates a stale copy in the background", async () => {
    let now = 1000;
    const load = vi.fn().mockResolvedValue({ items: [{ id: "a" }] });
    const cache = createLibraryCache(load, () => now);
    await Promise.all([cache.ensure(), cache.ensure()]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.loaded.value).toBe(true);
    await cache.ensure();
    expect(load).toHaveBeenCalledTimes(1);
    now += STALE_MS + 1;
    load.mockResolvedValueOnce({ items: [{ id: "b" }] });
    const answered = cache.ensure();
    // Answered from the copy at once; the refetch lands after.
    expect(cache.rows.value).toEqual([{ id: "a" }]);
    expect(load).toHaveBeenCalledTimes(2);
    await answered;
    await new Promise((r) => setTimeout(r, 0));
    expect(cache.rows.value).toEqual([{ id: "b" }]);
  });

  it("a failed first fetch rejects ensure, and the next ensure tries again", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue({ items: [] });
    const cache = createLibraryCache(load);
    await expect(cache.ensure()).rejects.toThrow("down");
    expect(cache.loaded.value).toBe(false);
    await cache.ensure();
    expect(cache.loaded.value).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("the newest refresh wins when an older one lands last", async () => {
    let slow: (v: unknown) => void = () => {};
    const load = vi.fn()
      .mockReturnValueOnce(new Promise((r) => { slow = r; }))
      .mockResolvedValueOnce({ items: [{ id: "new" }] });
    const cache = createLibraryCache<{ id: string }>(load);
    const first = cache.refresh();
    await cache.refresh();
    slow({ items: [{ id: "old" }] });
    await first;
    expect(cache.rows.value).toEqual([{ id: "new" }]);
  });
});
