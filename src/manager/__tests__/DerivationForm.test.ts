import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";

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
import DerivationForm from "../views/DerivationForm.vue";
import type { DerivationRule } from "../api/types";

const apiMod = api.modules as unknown as Record<string, ReturnType<typeof vi.fn>>;
const apiCat = api.categories as unknown as Record<string, ReturnType<typeof vi.fn>>;

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
      { path: "/derivations", component: { template: "<div/>" } },
    ],
  });
}

function findByText(wrap: ReturnType<typeof mount>, text: string) {
  return wrap.findAll("button").find((b) => b.text().includes(text));
}

describe("DerivationForm.vue", () => {
  it("renders 'New derivation' heading when no id", async () => {
    const wrap = mount(DerivationForm, {
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    expect(wrap.text()).toContain("New derivation");
    expect(wrap.text()).toContain("All rules evaluate independently");
  });

  it("starts with no rules and shows the empty-state card", async () => {
    const wrap = mount(DerivationForm, {
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    expect(wrap.find('[data-test="rules-empty"]').exists()).toBe(true);
    const vm = wrap.vm as unknown as { rules: DerivationRule[] };
    expect(vm.rules).toEqual([]);
  });

  it("Add rule increments the rules length", async () => {
    const wrap = mount(DerivationForm, {
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    const vm = wrap.vm as unknown as { rules: DerivationRule[] };
    expect(vm.rules.length).toBe(0);
    const btn = wrap.find('[data-test="add-rule"]');
    await btn.trigger("click");
    await flushPromises();
    expect(vm.rules.length).toBe(1);
    // First rule has a single IF branch by default
    expect(vm.rules[0].branches.length).toBe(1);
    expect(vm.rules[0].else).toBeUndefined();
  });

  it("save calls api.modules.create with type 'derivation' and the rules payload", async () => {
    apiMod.create.mockResolvedValue({
      id: "dv_a", type: "derivation", name: "D1",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload: { rules: [] }, version: 1, created_at: "", updated_at: "",
    });
    const wrap = mount(DerivationForm, {
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    const nameInput = wrap.find("#dv-name");
    await nameInput.setValue("D1");
    await nameInput.trigger("input");

    // Add one rule so the payload is non-trivial
    await wrap.find('[data-test="add-rule"]').trigger("click");
    await flushPromises();

    const saveBtn = findByText(wrap, "Save");
    await saveBtn?.trigger("click");
    await flushPromises();

    expect(apiMod.create).toHaveBeenCalledTimes(1);
    expect(apiMod.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "derivation",
        name: "D1",
        payload: expect.objectContaining({
          rules: expect.arrayContaining([
            expect.objectContaining({
              branches: expect.any(Array),
            }),
          ]),
        }),
      }),
    );
  });

  it("save without name shows warn and does not call api", async () => {
    const wrap = mount(DerivationForm, {
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    const saveBtn = findByText(wrap, "Save");
    await saveBtn?.trigger("click");
    await flushPromises();
    expect(apiMod.create).not.toHaveBeenCalled();
  });

  it("loads existing derivation payload when id is given", async () => {
    apiMod.get.mockResolvedValue({
      id: "dv_a",
      type: "derivation",
      name: "Wet weather",
      description: "",
      category_id: null,
      tags: [],
      is_favorite: false,
      payload: {
        rules: [
          {
            id: "r1",
            branches: [
              {
                condition: { var: "weather", op: "equals", value: "rain" },
                action: { target_var: "outfit", mode: "replace", value: "raincoat" },
              },
            ],
          },
        ],
      },
      version: 1,
      created_at: "",
      updated_at: "",
    });
    const wrap = mount(DerivationForm, {
      props: { id: "dv_a" },
      global: { plugins: [makeRouter(), PrimeVue, ToastService] },
    });
    await flushPromises();
    expect(wrap.text()).toContain("Edit derivation");
    expect(apiMod.get).toHaveBeenCalledWith("dv_a");
    const vm = wrap.vm as unknown as { rules: DerivationRule[] };
    expect(vm.rules.length).toBe(1);
    expect(vm.rules[0].branches[0].condition.op).toBe("equals");
    expect(vm.rules[0].branches[0].action.target_var).toBe("outfit");
  });
});
