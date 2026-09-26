import { mount, flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { setActivePinia, createPinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleRow, ScenarioRow, ScenarioRunResponse } from "../api/types";

vi.mock("../api/client", () => {
  const mod = (id: string, type: string, name: string, payload: Record<string, unknown>): ModuleRow => ({
    id, type, name, description: "", category_id: null, tags: [], is_favorite: false,
    payload, payload_hash: "0".repeat(64), version: 1, created_at: "", updated_at: "",
  }) as ModuleRow;
  const MODULES = [
    mod("aabbccdd", "wildcard", "Hair Color", { options: [], var_binding: "hair" }),
    mod("cccccccc", "fixed_values", "Profile", { values: [{ var: "name", value: "Mira" }] }),
    mod("dddddddd", "combine", "Prompt", { template: "$name with $hair hair", output_var: "prompt" }),
  ];
  const SCENARIO: ScenarioRow = {
    id: "sc000001", name: "Portrait", description: "", is_pinned: true,
    stack: [{ module: "aabbccdd" }, { module: "cccccccc" }, { module: "dddddddd" }],
    pins: {}, seeds: { from: 0, count: 2 }, output_var: null, baseline: null,
    last_run: null, created_at: "2026-01-01", updated_at: "2026-01-01",
  };
  const RESULT: ScenarioRunResponse = {
    runs: 2, failed: 0, elapsed_ms: 4, seeds: { first: 0, count: 2 },
    variables: {
      hair: { counts: { black: 1, red: 1 }, distinct: 2, other: 0, internal: false },
      name: { counts: { Mira: 2 }, distinct: 1, other: 0, internal: false },
      prompt: { counts: { "Mira with black hair": 1, "Mira with red hair": 1 }, distinct: 2, other: 0, internal: false },
    },
    picks: {}, constraint_hits: {},
    warnings: [{ type: "constraint_never_applied", message: "never applied", count: 2, seeds: [0, 1] }],
    samples: [0, 1].map((seed) => ({
      seed,
      vars: { hair: seed ? "red" : "black", name: "Mira", prompt: `Mira with ${seed ? "red" : "black"} hair` },
      trace: [{
        id: "aabbccdd", _uid: "s0", type: "wildcard", name: "Hair Color", binding: "hair",
        status: "ok", seed, error: null, writes: [{ variable: "hair", value: seed ? "red" : "black", overwrite: false }],
        refs: [{ uuid: "eeeeeeee", name: "Shade", option_id: "o1", depth: 0, value: seed ? "red" : "black" }],
      }],
      warnings: [],
      error: null,
    })),
    stack: [], missing: [], pins: {},
  };
  return {
    api: {
      modules: { list: vi.fn().mockResolvedValue({ items: MODULES, total: MODULES.length }) },
      bundles: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
      scenarios: {
        list: vi.fn().mockResolvedValue({ items: [SCENARIO], total: 1 }),
        create: vi.fn(),
        update: vi.fn().mockImplementation((_id: string, body: Partial<ScenarioRow>) =>
          Promise.resolve({ ...SCENARIO, ...body })),
        remove: vi.fn().mockResolvedValue(undefined),
      },
      testRun: vi.fn().mockResolvedValue(RESULT),
    },
    ApiError: class extends Error {
      constructor(public status: number, message: string) { super(message); }
    },
  };
});

import TestRunner from "../views/TestRunner.vue";
import { api } from "../api/client";

beforeEach(() => {
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

async function mountRunner(query: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/test", name: "test", component: { template: "<div/>" } }],
  });
  await router.push({ path: "/test", query });
  const wrap = mount(TestRunner, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return wrap;
}

describe("TestRunner.vue", () => {
  it("opens the first saved scenario with its stack", async () => {
    const wrap = await mountRunner();
    expect(wrap.findAll('[data-test="scenario-row"]')).toHaveLength(1);
    expect(wrap.find('[data-test="scenario-name"]').text()).toBe("Portrait");
    expect(wrap.findAll('[data-test="stack-card"]')).toHaveLength(3);
    expect(wrap.find('[data-test="run-hint"]').exists()).toBe(true);
    expect(api.testRun).not.toHaveBeenCalled();
  });

  it("runs the stack and shows stats, variables and the trace", async () => {
    const wrap = await mountRunner();
    await wrap.find('[data-test="run-btn"]').trigger("click");
    await flushPromises();
    expect(api.testRun).toHaveBeenCalledWith(expect.objectContaining({
      stack: [{ module: "aabbccdd" }, { module: "cccccccc" }, { module: "dddddddd" }],
      seeds: { from: 0, count: 2 },
    }));
    // A saved scenario records the run summary for the rail.
    expect(api.scenarios.update).toHaveBeenCalledWith("sc000001", { last_run: expect.objectContaining({ runs: 2 }) });
    expect(wrap.find('[data-test="run-stats"]').text()).toContain("2");
    expect(wrap.find('[data-test="variables-panel"]').text()).toContain("black");

    await wrap.find('[data-test="tab-samples"]').trigger("click");
    const rows = wrap.findAll('[data-test="sample-row"]');
    expect(rows).toHaveLength(2);
    await rows[1].trigger("click");
    expect(wrap.find('[data-test="trace-drawer"]').attributes("data-open")).toBe("true");
    expect(wrap.find('[data-test="trace-step"]').text()).toContain("red");
    expect(wrap.find('[data-test="trace-ref"]').text()).toContain("@Shade");
    expect(wrap.find('[data-test="trace-step"]').text()).not.toContain("no change");

    await wrap.find('[data-test="tab-warnings"]').trigger("click");
    expect(wrap.find('[data-test="warning"]').text()).toContain("2 of 2 runs");
  });

  it("deep link opens a quick run with that module and runs it", async () => {
    const wrap = await mountRunner({ kind: "wildcard", module: "aabbccdd" });
    expect(wrap.find('[data-test="scenario-name"]').text()).toBe("Quick run: Hair Color");
    expect(wrap.findAll('[data-test="stack-card"]')).toHaveLength(1);
    expect(api.testRun).toHaveBeenCalledWith(expect.objectContaining({ stack: [{ module: "aabbccdd" }] }));
  });

  it("asks before discarding unsaved changes", async () => {
    const wrap = await mountRunner();
    await wrap.findAll('[data-test="stack-remove"]')[0].trigger("click");
    expect(wrap.find('[data-test="dirty"]').exists()).toBe(true);
    await wrap.find('[data-test="new-quick-run"]').trigger("click");
    await flushPromises();
    // Still on the edited scenario until the dialog is confirmed.
    expect(wrap.find('[data-test="scenario-name"]').text()).toBe("Portrait");
    expect(document.body.textContent).toContain("Discard unsaved changes?");
    const discard = [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Discard");
    discard?.click();
    await flushPromises();
    expect(wrap.find('[data-test="scenario-name"]').text()).toBe("Quick run");
  });

  it("switching a card off and on again leaves the scenario unchanged", async () => {
    const wrap = await mountRunner();
    const sw = () => wrap.findAll('[data-test="stack-toggle"] button')[0];
    await sw().trigger("click");
    expect(wrap.find('[data-test="dirty"]').exists()).toBe(true);
    expect(wrap.findAll('[data-test="stack-card"]')[0].attributes("data-off")).toBe("true");
    await sw().trigger("click");
    expect(wrap.find('[data-test="dirty"]').exists()).toBe(false);
  });

  it("the Outputs tab picks which variable is the output", async () => {
    const wrap = await mountRunner();
    await wrap.find('[data-test="run-btn"]').trigger("click");
    await flushPromises();
    await wrap.find('[data-test="tab-outputs"]').trigger("click");
    expect(wrap.find('[data-test="output-row"]').text()).toContain("Mira with black hair");
    await wrap.find('[data-test="output-var"] [data-test="select-trigger"]').trigger("click");
    await flushPromises();
    const opt = [...document.body.querySelectorAll('[role="option"]')].find((o) => o.textContent?.trim() === "$hair");
    opt?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(wrap.find('[data-test="output-row"]').text()).toContain("black");
    expect(wrap.find('[data-test="output-row"]').text()).not.toContain("Mira");
    expect(wrap.find('[data-test="run-stats"]').text()).toContain("of $hair");
  });

  it("deletes a scenario only after confirming", async () => {
    const wrap = await mountRunner();
    await wrap.find('[data-test="scenario-delete"]').trigger("click");
    await flushPromises();
    expect(api.scenarios.remove).not.toHaveBeenCalled();
    const del = [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Delete");
    del?.click();
    await flushPromises();
    expect(api.scenarios.remove).toHaveBeenCalledWith("sc000001");
    expect(wrap.findAll('[data-test="scenario-row"]')).toHaveLength(0);
  });
});
