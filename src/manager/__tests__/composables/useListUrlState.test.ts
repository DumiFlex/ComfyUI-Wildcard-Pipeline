import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { defineComponent, h } from "vue";
import { useListUrlState, BASE_LIST_SCHEMA } from "../../composables/useListUrlState";
import type { UrlSchema } from "../../composables/useUrlState";

async function harness<T>(query: Record<string, string>, build: () => T): Promise<T> {
  let state: T;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/list", component: { template: "<div />" } }],
  });
  await router.push({ path: "/list", query });
  await router.isReady();
  const Harness = defineComponent({
    setup() {
      state = build();
      return () => h("div");
    },
  });
  mount(Harness, { global: { plugins: [router] } });
  return state!;
}

describe("useListUrlState", () => {
  it("returns state matching BASE_LIST_SCHEMA defaults when no query present", async () => {
    const state = await harness({}, () => useListUrlState());
    expect(state.q).toBe("");
    expect(state.page).toBe(1);
    expect(state.pageSize).toBe(15);
    expect(state.sortBy).toBe("updated-desc");
    expect(state.category).toBeNull();
    expect(state.tags).toEqual([]);
    expect(state.favorites).toBe(false);
  });

  it("merges extraSchema fields on top of base", async () => {
    const extra: UrlSchema<{ filters: string[] }> = {
      filters: { type: "csv", default: [] },
    };
    const state = await harness({}, () => useListUrlState(extra));
    expect(state.filters).toEqual([]);
    expect(state.q).toBe(""); // base field still present
  });

  it("reads URL values via base aliases (cat, ps, fav, tag, sort)", async () => {
    const state = await harness(
      { cat: "c1", ps: "25", fav: "1", tag: "red,blue", sort: "name-asc" },
      () => useListUrlState(),
    );
    expect(state.category).toBe("c1");
    expect(state.pageSize).toBe(25);
    expect(state.favorites).toBe(true);
    expect(state.tags).toEqual(["red", "blue"]);
    expect(state.sortBy).toBe("name-asc");
  });

  it("extra fields without aliases use literal state key as URL key", async () => {
    const extra: UrlSchema<{ filters: string[] }> = {
      filters: { type: "csv", default: [] },
    };
    const state = await harness(
      { filters: "a,b" },
      () => useListUrlState(extra),
    );
    expect(state.filters).toEqual(["a", "b"]);
  });

  it("BASE_LIST_SCHEMA exposes the canonical 7 base fields", () => {
    expect(Object.keys(BASE_LIST_SCHEMA).sort()).toEqual(
      ["category", "favorites", "page", "pageSize", "q", "sortBy", "tags"].sort(),
    );
    expect(BASE_LIST_SCHEMA.category.urlKey).toBe("cat");
    expect(BASE_LIST_SCHEMA.pageSize.urlKey).toBe("ps");
    expect(BASE_LIST_SCHEMA.favorites.urlKey).toBe("fav");
    expect(BASE_LIST_SCHEMA.tags.urlKey).toBe("tag");
    expect(BASE_LIST_SCHEMA.sortBy.urlKey).toBe("sort");
  });
});
