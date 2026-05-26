import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("../../api/client", () => {
  const row = {
    id: "t1", name: "a", description: "", category_id: null, tags: [],
    is_favorite: false, template_string: "$x", created_at: "", updated_at: "",
  };
  return {
    api: {
      templates: {
        list: vi.fn(async () => ({ items: [row], total: 1 })),
        get: vi.fn(async (id: string) => ({ ...row, id })),
        create: vi.fn(async (b: { name: string }) => ({ ...row, id: "t2", name: b.name })),
        update: vi.fn(async (id: string, b: Record<string, unknown>) => ({ ...row, id, ...b })),
        delete: vi.fn(async () => undefined),
        favorite: vi.fn(async (id: string) => ({ ...row, id, is_favorite: true })),
      },
    },
  };
});

import { useTemplateStore } from "../templateStore";

describe("templateStore", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("fetchAll populates items", async () => {
    const s = useTemplateStore();
    await s.fetchAll();
    expect(s.items.map((t) => t.id)).toEqual(["t1"]);
  });

  it("create prepends to items + catalog", async () => {
    const s = useTemplateStore();
    await s.fetchCatalog();
    await s.create({ name: "new", template_string: "$y" });
    expect(s.catalog[0].name).toBe("new");
  });

  it("update replaces row", async () => {
    const s = useTemplateStore();
    await s.fetchAll();
    await s.update("t1", { template_string: "$z" });
    expect(s.items.find((t) => t.id === "t1")?.template_string).toBe("$z");
  });

  it("remove drops row", async () => {
    const s = useTemplateStore();
    await s.fetchAll();
    await s.remove("t1");
    expect(s.items).toHaveLength(0);
  });

  it("toggleFavorite flips", async () => {
    const s = useTemplateStore();
    await s.fetchAll();
    await s.toggleFavorite("t1");
    expect(s.items.find((t) => t.id === "t1")?.is_favorite).toBe(true);
  });
});
