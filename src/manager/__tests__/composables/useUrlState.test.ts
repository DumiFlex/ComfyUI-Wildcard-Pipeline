import { defineComponent } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import { useUrlState, type UrlSchema } from "../../composables/useUrlState";

interface State {
  q: string;
  category: string | null;
  page: number;
  filters: string[];
}

const SCHEMA: UrlSchema<State> = {
  q: { type: "string", default: "" },
  category: { type: "string-or-null", default: null, urlKey: "cat" },
  page: { type: "int", default: 1 },
  filters: { type: "csv", default: [] },
};

const Host = defineComponent({
  setup() {
    const state = useUrlState<State>(SCHEMA);
    return { state };
  },
  template: `<div>
    <span data-test="q">{{ state.q }}</span>
    <span data-test="cat">{{ state.category }}</span>
    <span data-test="page">{{ state.page }}</span>
    <span data-test="filters">{{ state.filters.join(",") }}</span>
  </div>`,
});

function makeRouter(initial: string) {
  const r = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: Host }],
  });
  void r.push(initial);
  return r;
}

let wrappers: ReturnType<typeof mount>[] = [];

beforeEach(() => { wrappers = []; });
afterEach(() => {
  for (const w of wrappers) { try { w.unmount(); } catch { /* */ } }
  wrappers = [];
});

async function mountAt(path: string) {
  const router = makeRouter(path);
  await router.isReady();
  const wrap = mount(Host, { global: { plugins: [router] } });
  wrappers.push(wrap);
  await flushPromises();
  return { wrap, router };
}

describe("useUrlState", () => {
  it("reads defaults when URL has no params", async () => {
    const { wrap } = await mountAt("/");
    expect(wrap.find('[data-test="q"]').text()).toBe("");
    expect(wrap.find('[data-test="cat"]').text()).toBe("");
    expect(wrap.find('[data-test="page"]').text()).toBe("1");
    expect(wrap.find('[data-test="filters"]').text()).toBe("");
  });

  it("parses params from URL on mount", async () => {
    const { wrap } = await mountAt("/?q=mood&cat=Style&page=3&filters=a,b");
    expect(wrap.find('[data-test="q"]').text()).toBe("mood");
    expect(wrap.find('[data-test="cat"]').text()).toBe("Style");
    expect(wrap.find('[data-test="page"]').text()).toBe("3");
    expect(wrap.find('[data-test="filters"]').text()).toBe("a,b");
  });

  it("writes back to URL when state changes (defaults omitted)", async () => {
    const { wrap, router } = await mountAt("/");
    const vm = wrap.vm as unknown as { state: State };
    vm.state.q = "hello";
    vm.state.page = 2;
    await flushPromises();
    await nextTick();
    expect(router.currentRoute.value.query.q).toBe("hello");
    expect(router.currentRoute.value.query.page).toBe("2");
    expect(router.currentRoute.value.query.cat).toBeUndefined();
    expect(router.currentRoute.value.query.filters).toBeUndefined();
  });

  it("ignores unknown query keys", async () => {
    const { wrap } = await mountAt("/?q=foo&unknown=bar");
    expect(wrap.find('[data-test="q"]').text()).toBe("foo");
  });

  it("coerces int type and falls back to default on invalid", async () => {
    const { wrap } = await mountAt("/?page=notanumber");
    expect(wrap.find('[data-test="page"]').text()).toBe("1");
  });

  it("trims empty CSV pieces", async () => {
    const { wrap } = await mountAt("/?filters=a,,b,");
    expect(wrap.find('[data-test="filters"]').text()).toBe("a,b");
  });
});
