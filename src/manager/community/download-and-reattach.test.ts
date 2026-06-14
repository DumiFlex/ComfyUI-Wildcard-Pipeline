import { describe, it, expect, vi } from "vitest";
import { downloadDepsForDangling } from "./download-and-reattach";

describe("downloadDepsForDangling", () => {
  it("resolves the dep providing the dangling uuid, walks its closure, installs each", async () => {
    const fetchDetail = vi.fn(async (slug: string) => ({
      slug, latest_version_number: 1, dependencies: [] as Array<{ slug: string; module_id?: string }>,
    }));
    const download = vi.fn(async () => ({
      payload: { id: "aabb0001", type: "wildcard", name: "Subject", payload: { options: [] } },
      version_number: 1,
    }));
    const install = vi.fn(async () => ({ ok: true }));

    const out = await downloadDepsForDangling({
      danglingUuid: "aabb0001",
      constraintDeps: [{ slug: "author/subject", module_id: "aabb0001" }],
      fetchDetail, download, install,
    });

    expect(out.providerSlug).toBe("author/subject");
    expect(out.pulled).toEqual(["author/subject"]);
    expect(install).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(true);
  });

  it("returns providerSlug null when no dep edge provides the dangling uuid", async () => {
    const out = await downloadDepsForDangling({
      danglingUuid: "zzzz9999",
      constraintDeps: [{ slug: "author/subject", module_id: "aabb0001" }],
      fetchDetail: vi.fn(), download: vi.fn(), install: vi.fn(),
    });
    expect(out.providerSlug).toBeNull();
    expect(out.pulled).toEqual([]);
    expect(out.ok).toBe(false);
  });

  it("stops + reports error when an install fails", async () => {
    const out = await downloadDepsForDangling({
      danglingUuid: "aabb0001",
      constraintDeps: [{ slug: "author/subject", module_id: "aabb0001" }],
      fetchDetail: vi.fn(async (slug: string) => ({ slug, latest_version_number: 1, dependencies: [] })),
      download: vi.fn(async () => ({ payload: { id: "aabb0001", type: "wildcard", name: "S", payload: {} }, version_number: 1 })),
      install: vi.fn(async () => ({ ok: false, error: { message: "boom" } })),
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("boom");
  });
});
