/**
 * The canvas pickers draw kit Skeleton rows on their FIRST load only: a
 * reopen keeps the list already in memory and refreshes it quietly.
 */
import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

vi.mock("../../manager/api/client", () => ({
  api: {
    bundles: { list: vi.fn() },
    templates: { list: vi.fn() },
    categories: { list: vi.fn(async () => ({ items: [] })) },
  },
}));

import { api } from "../../manager/api/client";
import ModulePickerModal from "./ModulePickerModal.vue";
import BundlePickerModal from "./BundlePickerModal.vue";
import LoadTemplateModal from "../assembler/LoadTemplateModal.vue";

const apiBundles = api.bundles as unknown as Record<string, ReturnType<typeof vi.fn>>;
const apiTemplates = api.templates as unknown as Record<string, ReturnType<typeof vi.fn>>;
const stubs = { global: { stubs: { teleport: true } } } as const;

function deferred<T>() {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const BUNDLE = {
  id: "abcd1234", name: "alpha", description: "", color: "", category_id: null, tags: [],
  is_favorite: false, children: [], payload_hash: "h", version: 1, created_at: "", updated_at: "",
};
const TEMPLATE = {
  id: "t1", name: "portrait", description: "", category_id: null, tags: [], is_favorite: false,
  template_string: "$x", created_at: "", updated_at: "",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ModulePickerModal skeleton", () => {
  let pending: Array<() => void> = [];
  beforeEach(() => {
    pending = [];
    vi.stubGlobal("fetch", vi.fn((url: string) => new Promise<Response>((resolve) => {
      pending.push(() => resolve({
        ok: true, status: 200,
        json: async () => (url === "/wp/api/modules"
          ? { items: [{ id: "aaaaaaaa", type: "wildcard", name: "outfit", payload: {}, tags: [] }] }
          : { items: [] }),
      } as unknown as Response));
    })));
  });
  const settle = async () => { pending.splice(0).forEach((f) => f()); await flushPromises(); await nextTick(); };

  it("shows kit Skeleton rows on the first load, then the list", async () => {
    const w = mount(ModulePickerModal, { ...stubs, props: { visible: true } });
    await nextTick();
    expect(w.find(".wp-picker__skel .wp-skeleton").exists()).toBe(true);
    expect(w.find('.wp-picker__skel [role="status"]').text()).toContain("Loading modules");
    expect(w.find(".wp-skel").exists()).toBe(false);
    await settle();
    expect(w.find(".wp-picker__skel").exists()).toBe(false);
    expect(w.findAll(".wp-picker__row").length).toBeGreaterThan(0);
  });

  it("keeps the rows on reopen while it refreshes", async () => {
    const w = mount(ModulePickerModal, { ...stubs, props: { visible: true } });
    await settle();
    await w.setProps({ visible: false });
    await w.setProps({ visible: true });
    await nextTick();
    expect(w.find(".wp-picker__skel").exists()).toBe(false);
    expect(w.findAll(".wp-picker__row").length).toBeGreaterThan(0);
    await settle();
  });
});

describe("BundlePickerModal skeleton", () => {
  it("shows Skeleton rows on the first load only", async () => {
    const first = deferred<unknown>();
    apiBundles.list.mockReturnValueOnce(first.promise);
    const w = mount(BundlePickerModal, { ...stubs, props: { visible: true } });
    await nextTick();
    expect(w.find(".wp-bp__skel-list.wp-skeleton").exists()).toBe(true);
    first.resolve({ items: [BUNDLE], total: 1 });
    await flushPromises();
    expect(w.findAll(".wp-bp__row")).toHaveLength(1);

    apiBundles.list.mockReturnValueOnce(new Promise(() => {}));
    await w.setProps({ visible: false });
    await w.setProps({ visible: true });
    await nextTick();
    expect(w.find(".wp-bp__skel-list").exists()).toBe(false);
    expect(w.findAll(".wp-bp__row")).toHaveLength(1);
  });
});

describe("LoadTemplateModal skeleton", () => {
  it("shows Skeleton rows on the first load only", async () => {
    const first = deferred<unknown>();
    apiTemplates.list.mockReturnValueOnce(first.promise);
    const w = mount(LoadTemplateModal, { ...stubs, props: { open: true } });
    await nextTick();
    expect(w.find(".wp-ltm__skel.wp-skeleton").exists()).toBe(true);
    first.resolve({ items: [TEMPLATE], total: 1 });
    await flushPromises();
    expect(w.findAll('[data-test="load-tpl-row"]')).toHaveLength(1);

    apiTemplates.list.mockReturnValueOnce(new Promise(() => {}));
    await w.setProps({ open: false });
    await w.setProps({ open: true });
    await nextTick();
    expect(w.find(".wp-ltm__skel").exists()).toBe(false);
    expect(w.findAll('[data-test="load-tpl-row"]')).toHaveLength(1);
  });
});
