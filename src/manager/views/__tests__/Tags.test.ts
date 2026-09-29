import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";

vi.mock("../../api/client", () => ({
  ApiError: class extends Error {},
  api: {
    modules: { list: vi.fn() },
    bundles: { list: vi.fn() },
    templates: { list: vi.fn() },
    libraryTags: { rename: vi.fn(), delete: vi.fn() },
  },
}));

import { api } from "../../api/client";
import Tags from "../Tags.vue";

const mocked = api as unknown as {
  modules: { list: ReturnType<typeof vi.fn> };
  bundles: { list: ReturnType<typeof vi.fn> };
  templates: { list: ReturnType<typeof vi.fn> };
  libraryTags: { rename: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
};

const UPDATED = { updated: { modules: 1, bundles: 0, templates: 0 } };

async function mountTags() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/tags", component: { template: "<div/>" } },
      { path: "/all", component: { template: "<div/>" } },
      { path: "/templates", component: { template: "<div/>" } },
    ],
  });
  await router.push("/tags");
  const wrap = mount(Tags, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return { wrap, router };
}

beforeEach(() => {
  setActivePinia(createPinia());
  mocked.modules.list.mockResolvedValue({
    items: [
      { id: "m1", type: "wildcard", tags: ["outfit", "nsfw"] },
      { id: "m2", type: "wildcard", tags: ["outfit"] },
    ],
    total: 2,
  });
  mocked.bundles.list.mockResolvedValue({ items: [], total: 0 });
  mocked.templates.list.mockResolvedValue({ items: [{ id: "t1", tags: ["portrait"] }], total: 1 });
  mocked.libraryTags.rename.mockReset().mockResolvedValue(UPDATED);
  mocked.libraryTags.delete.mockReset().mockResolvedValue(UPDATED);
  document.body.innerHTML = "";
});

describe("Tags.vue", () => {
  it("lists every tag with per-kind counts, most used first", async () => {
    const { wrap } = await mountTags();
    const rows = wrap.findAll("tbody tr");
    expect(rows.map((r) => r.find("td").text())).toEqual(["outfit", "nsfw", "portrait"]);
    expect(rows[0].findAll("td").map((td) => td.text()).slice(1, 4)).toEqual(["2", "—", "—"]);
  });

  it("opens a template-only tag in the Templates list", async () => {
    const { wrap, router } = await mountTags();
    await wrap.find('[data-test="tag-open-portrait"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/templates?tag=portrait");
  });

  it("renames to a new name straight away", async () => {
    const { wrap } = await mountTags();
    await wrap.find('[data-test="tag-rename-nsfw"]').trigger("click");
    const input = wrap.find('[data-test="tag-rename-input"]');
    await input.setValue("adult");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(mocked.libraryTags.rename).toHaveBeenCalledWith("nsfw", "adult");
  });

  it("asks before merging into an existing tag", async () => {
    const { wrap } = await mountTags();
    await wrap.find('[data-test="tag-rename-nsfw"]').trigger("click");
    const input = wrap.find('[data-test="tag-rename-input"]');
    await input.setValue("outfit");
    input.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushPromises();
    expect(document.body.querySelector('[data-test="confirm-title"]')?.textContent)
      .toContain('Merge "nsfw" into "outfit"?');
    expect(mocked.libraryTags.rename).not.toHaveBeenCalled();

    (document.body.querySelector('[data-test="confirm-confirm"]') as HTMLButtonElement).click();
    await flushPromises();
    expect(mocked.libraryTags.rename).toHaveBeenCalledWith("nsfw", "outfit");
  });

  it("deletes a tag after confirming", async () => {
    const { wrap } = await mountTags();
    await wrap.find('[data-test="tag-delete-outfit"]').trigger("click");
    await flushPromises();
    expect(document.body.querySelector('[data-test="confirm-body"]')?.textContent)
      .toContain("Removes it from 2 items");
    (document.body.querySelector('[data-test="confirm-confirm"]') as HTMLButtonElement).click();
    await flushPromises();
    expect(mocked.libraryTags.delete).toHaveBeenCalledWith("outfit");
  });
});
