import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
vi.mock("../api/client", () => ({
  api: {
    modules: {
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    },
    categories: { list: vi.fn().mockResolvedValue({ items: [] }) },
  },
}));

import { api } from "../api/client";
import ConstraintEditor from "../views/ConstraintEditor.vue";
import type {
  ConstraintMatrix as Matrix,
  ModuleRow,
} from "../api/types";

const apiMod = api.modules as unknown as Record<string, ReturnType<typeof vi.fn>>;
const apiCat = api.categories as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeWildcardRow(id: string, name: string, opts: {
  values?: string[];
  subs?: string[];
} = {}): ModuleRow {
  return {
    id,
    name,
    type: "wildcard",
    description: "",
    category_id: null,
    tags: [],
    is_favorite: false,
    payload: {
      options: (opts.values ?? []).map((v, i) => ({ id: `o${i}`, value: v, weight: 1 })),
      sub_categories: opts.subs ?? [],
    },
    payload_hash: "0".repeat(64),
    version: 1,
    created_at: "",
    updated_at: "",
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  Object.values(apiMod).forEach((fn) => fn.mockReset());
  apiMod.list.mockResolvedValue({ items: [], total: 0 });
  apiCat.list.mockResolvedValue({ items: [] });
});
afterEach(() => {
  vi.clearAllMocks();
});

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" } },
      { path: "/constraints", component: { template: "<div/>" } },
    ],
  });
}

describe("ConstraintEditor.vue", () => {
  it("renders 'New constraint' heading when no id", async () => {
    const wrap = mount(ConstraintEditor, {
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    expect(wrap.text()).toContain("New constraint");
  });

  it("loads existing constraint payload when id is given", async () => {
    // Both axes are now sub_categories (matrix is subcat × subcat, not
    // value × subcat) — give source its own sub_categories so the row
    // matches the matrix payload key.
    apiMod.list.mockResolvedValue({
      items: [
        makeWildcardRow("wc_src", "Outfit", { subs: ["jeans", "tux"] }),
        makeWildcardRow("wc_tgt", "HairColor", { subs: ["warm", "cool"] }),
      ],
      total: 2,
    });
    apiMod.get.mockResolvedValue({
      id: "cn_a", type: "constraint", name: "Outfit x Hair",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload: {
        source_wildcard_id: "wc_src",
        target_wildcard_id: "wc_tgt",
        matrix: { jeans: { warm: { mode: "boost", factor: 2 } } } as Matrix,
        exceptions: [],
      },
      version: 1, created_at: "", updated_at: "",
    });
    const wrap = mount(ConstraintEditor, {
      props: { id: "cn_a" },
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    expect(wrap.text()).toContain("Edit constraint");
    const cell = wrap.find('button[data-test="cell-jeans-warm"]');
    expect(cell.exists()).toBe(true);
    expect(cell.attributes("data-mode")).toBe("boost");
  });

  it("save calls api.modules.create with type 'constraint'", async () => {
    apiMod.list.mockResolvedValue({
      items: [
        makeWildcardRow("wc_src", "Outfit", { subs: ["jeans"] }),
        makeWildcardRow("wc_tgt", "HairColor", { subs: ["warm"] }),
      ],
      total: 2,
    });
    apiMod.create.mockResolvedValue({
      id: "cn_a", type: "constraint", name: "C1",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload: {
        source_wildcard_id: "wc_src",
        target_wildcard_id: "wc_tgt",
        matrix: {},
        exceptions: [],
      },
      version: 1, created_at: "", updated_at: "",
    });
    const wrap = mount(ConstraintEditor, {
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    const nameInput = wrap.find('[data-test="identity-name"]');
    await nameInput.setValue("C1");
    const vm = wrap.vm as unknown as {
      sourceWildcardId: string | null;
      targetWildcardId: string | null;
    };
    vm.sourceWildcardId = "wc_src";
    vm.targetWildcardId = "wc_tgt";
    await flushPromises();
    const saveBtn = wrap.find('[data-test="save-btn"]');
    await saveBtn.trigger("click");
    await flushPromises();
    expect(apiMod.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "constraint",
        name: "C1",
        payload: expect.objectContaining({
          source_wildcard_id: "wc_src",
          target_wildcard_id: "wc_tgt",
        }),
      }),
    );
  });

  it("exception value labels resolve @{uuid} tokens to wildcard names", async () => {
    // Source wildcard has an option whose value contains a nested @{uuid}
    // ref to the target wildcard. Issue #6 from 2026-05-24 live QA: the
    // exception dropdown's option label should resolve the @{uuid} to the
    // referenced wildcard's name, not show the raw 8-hex id.
    apiMod.list.mockResolvedValue({
      items: [
        makeWildcardRow("c0f09840", "Color", { values: ["blue"] }),
        makeWildcardRow("deadbeef", "Source", {
          values: ["i love @{c0f09840}", "plain"],
        }),
      ],
      total: 2,
    });
    apiMod.get.mockResolvedValue({
      id: "cn_a", type: "constraint", name: "C",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload: {
        source_wildcard_id: "deadbeef",
        target_wildcard_id: "deadbeef",
        matrix: {},
        exceptions: [],
      },
      version: 1, created_at: "", updated_at: "",
    });
    const wrap = mount(ConstraintEditor, {
      props: { id: "cn_a" },
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    const vm = wrap.vm as unknown as { displayLabel: (s: string) => string };
    expect(vm.displayLabel("i love @{c0f09840}")).toBe("i love @Color");
    expect(vm.displayLabel("plain")).toBe("plain");
    expect(vm.displayLabel("missing @{12345678}")).toBe("missing @?12345678");
  });

  it("exception source rehydrates from source_id when option value renamed upstream", async () => {
    // Exception stores legacy `source = "old_value"` + `source_id = "opt_aaaa"`.
    // The source wildcard's option `opt_aaaa` has since been renamed
    // value-wise to "new_value". On load, the editor should refresh
    // `source` to the current option value (resolved via id) so the
    // dropdown's v-model matches a real option and renders the chip
    // instead of "Pick value".
    apiMod.list.mockResolvedValue({
      items: [
        {
          id: "deadbeef", name: "Src", type: "wildcard",
          description: "", category_id: null, tags: [], is_favorite: false,
          payload: {
            options: [
              { id: "opt_aaaa", value: "new_value", weight: 1 },
            ],
            sub_categories: [],
          },
          payload_hash: "0".repeat(64), version: 1, created_at: "", updated_at: "",
        },
      ],
      total: 1,
    });
    apiMod.get.mockResolvedValue({
      id: "cn_a", type: "constraint", name: "C",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload: {
        source_wildcard_id: "deadbeef",
        target_wildcard_id: "deadbeef",
        matrix: {},
        exceptions: [
          {
            source: "old_value", target: "new_value",
            source_id: "opt_aaaa", target_id: "opt_aaaa",
            mode: "allow", factor: 1,
          },
        ],
      },
      version: 1, created_at: "", updated_at: "",
    });
    const wrap = mount(ConstraintEditor, {
      props: { id: "cn_a" },
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    const vm = wrap.vm as unknown as {
      exceptions: Array<{ source: string; source_id?: string; target: string }>;
    };
    expect(vm.exceptions[0].source).toBe("new_value");
    expect(vm.exceptions[0].source_id).toBe("opt_aaaa");
  });

  it("save without source/target shows warn and does not call api", async () => {
    const wrap = mount(ConstraintEditor, {
      global: { plugins: [makeRouter()] },
    });
    await flushPromises();
    const nameInput = wrap.find('[data-test="identity-name"]');
    await nameInput.setValue("C1");
    const saveBtn = wrap.find('[data-test="save-btn"]');
    await saveBtn.trigger("click");
    await flushPromises();
    expect(apiMod.create).not.toHaveBeenCalled();
  });
});
