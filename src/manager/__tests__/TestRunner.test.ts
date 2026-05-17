import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleRow } from "../api/types";

vi.mock("../api/client", () => {
  // Post migration 004 every module's id IS its 8-hex uuid; cross-refs
  // (pipeline step.module_id, constraint source/target) carry the same
  // 8-hex form.
  const MOCK_MODULES: ModuleRow[] = [
    {
      id: "aabbccdd", type: "wildcard", name: "Hair Color",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload: {
        options: [
          { id: "o1", value: "auburn",  weight: 2, sub_category: "warm" },
          { id: "o2", value: "blonde",  weight: 1, sub_category: "cool" },
        ],
        sub_categories: ["warm", "cool"],
        var_binding: "hair_color",
      },
      payload_hash: "0".repeat(64),
      version: 1, created_at: "", updated_at: "",
    },
    {
      id: "bbbbbbbb", type: "wildcard", name: "Outfit",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload: {
        options: [
          { id: "o1", value: "{linen|cotton} dress", weight: 2, sub_category: null },
        ],
        sub_categories: [],
      },
      payload_hash: "0".repeat(64),
      version: 1, created_at: "", updated_at: "",
    },
    {
      id: "cccccccc", type: "fixed_values", name: "Subject Profile",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload: { values: [{ var: "name", value: "Mira" }, { var: "age", value: "29" }] },
      payload_hash: "0".repeat(64),
      version: 1, created_at: "", updated_at: "",
    },
    {
      id: "dddddddd", type: "combine", name: "Subject Phrase",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload: {
        template: "$name with $hair_color hair",
        output_var: "subject_phrase",
        input_vars: ["name", "hair_color"],
      },
      payload_hash: "0".repeat(64),
      version: 1, created_at: "", updated_at: "",
    },
    {
      id: "eeeeeeee", type: "derivation", name: "Always Append",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload: {
        rules: [{
          id: "r1",
          branches: [{
            condition: { var: "subject", op: "contains", value: "person" },
            action: { target_var: "subject", mode: "append", value: "wet" },
          }],
        }],
      },
      payload_hash: "0".repeat(64),
      version: 1, created_at: "", updated_at: "",
    },
    {
      id: "ffffffff", type: "constraint", name: "Hair × Outfit",
      description: "", category_id: null, tags: [], is_favorite: false,
      payload: {
        source_wildcard_id: "aabbccdd",
        target_wildcard_id: "bbbbbbbb",
        matrix: { warm: {} },
        exceptions: [],
      },
      payload_hash: "0".repeat(64),
      version: 1, created_at: "", updated_at: "",
    },
  ];
  return {
    api: {
      modules: {
        list: vi.fn().mockResolvedValue({ items: MOCK_MODULES, total: MOCK_MODULES.length }),
      },
      bundles: {
        list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      },
      test: vi.fn(),
    },
    ApiError: class extends Error {
      constructor(public status: number, message: string) { super(message); }
    },
  };
});

import TestRunner from "../views/TestRunner.vue";

beforeEach(() => {
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.clearAllMocks();
});

function mountRunner() {
  return mount(TestRunner, { global: { plugins: [] } });
}

describe("TestRunner.vue", () => {
  it("renders heading and no result before run", async () => {
    const wrap = mountRunner();
    await flushPromises();
    expect(wrap.text()).toContain("Test runner");
    // No per-kind result panels rendered yet.
    expect(wrap.find('[data-test="result-wildcard"]').exists()).toBe(false);
    expect(wrap.find('[data-test="result-fixed"]').exists()).toBe(false);
  });

  it("Run button disabled when no module selected", async () => {
    // Override modules.list to return empty so no auto-pick happens.
    const { api } = await import("../api/client");
    (api.modules.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ items: [], total: 0 });
    const wrap = mountRunner();
    await flushPromises();
    const btn = wrap.find('[data-test="run-btn"] button, button[data-test="run-btn"]');
    const el = (btn.exists() ? btn : wrap.findAll("button").find((b) => b.text().includes("Run"))) as ReturnType<typeof wrap.find>;
    // PrimeVue Button forwards :disabled to the button element.
    expect((el?.attributes ? el.attributes("disabled") : undefined)).toBeDefined();
  });

  it("kind selector switches the module dropdown to that kind only", async () => {
    const wrap = mountRunner();
    await flushPromises();
    // Click the Combine button in the segmented kind picker.
    const kindSelector = wrap.find('[data-test="kind-selector"]');
    const combineOpt = kindSelector
      .findAll("button")
      .find((el) => el.text().trim().includes("Combine"));
    expect(combineOpt).toBeTruthy();
    await combineOpt!.trigger("click");
    await flushPromises();
    // ui/Select renders the options inline once open. Click the trigger button.
    const trigger = wrap
      .find('[data-test="module-select"]')
      .find('[data-test="select-trigger"]');
    await trigger.trigger("click");
    await flushPromises();
    // Combine modules should appear in the menu; non-combine ones should not.
    const html = wrap.html();
    expect(html).toContain("Subject Phrase");
    expect(html).not.toContain("Hair Color");
  });

  it("runs wildcard kind and renders histogram panel", async () => {
    const wrap = mountRunner();
    await flushPromises();
    const runBtn = wrap.findAll("button").find((b) => b.text().includes("Run"));
    expect(runBtn).toBeTruthy();
    await runBtn!.trigger("click");
    await flushPromises();
    await flushPromises();
    expect(wrap.find('[data-test="result-wildcard"]').exists()).toBe(true);
  });

  it("runs fixed_values kind producing the bindings panel", async () => {
    const wrap = mountRunner();
    await flushPromises();
    const kindSelector = wrap.find('[data-test="kind-selector"]');
    const fixedOpt = kindSelector
      .findAll("div, span, button")
      .find((el) => el.text().trim() === "Fixed");
    await fixedOpt!.trigger("click");
    await flushPromises();
    const runBtn = wrap.findAll("button").find((b) => b.text().includes("Run"));
    await runBtn!.trigger("click");
    await flushPromises();
    await flushPromises();
    expect(wrap.find('[data-test="result-fixed"]').exists()).toBe(true);
    expect(wrap.text()).toContain("$name");
    expect(wrap.text()).toContain("Mira");
  });

  it("runs derivation kind producing rule trace", async () => {
    const wrap = mountRunner();
    await flushPromises();
    const kindSelector = wrap.find('[data-test="kind-selector"]');
    const dvOpt = kindSelector
      .findAll("div, span, button")
      .find((el) => el.text().trim() === "Derivation");
    await dvOpt!.trigger("click");
    await flushPromises();
    const runBtn = wrap.findAll("button").find((b) => b.text().includes("Run"));
    await runBtn!.trigger("click");
    await flushPromises();
    await flushPromises();
    expect(wrap.find('[data-test="result-derivation"]').exists()).toBe(true);
  });

  it("runs constraint kind producing the matrix table", async () => {
    const wrap = mountRunner();
    await flushPromises();
    const kindSelector = wrap.find('[data-test="kind-selector"]');
    const cnOpt = kindSelector
      .findAll("div, span, button")
      .find((el) => el.text().trim() === "Constraint");
    await cnOpt!.trigger("click");
    await flushPromises();
    const runBtn = wrap.findAll("button").find((b) => b.text().includes("Run"));
    await runBtn!.trigger("click");
    await flushPromises();
    await flushPromises();
    expect(wrap.find('[data-test="result-constraint"]').exists()).toBe(true);
  });
});
