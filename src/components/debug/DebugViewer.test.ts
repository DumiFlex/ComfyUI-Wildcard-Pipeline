import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import DebugViewer from "./DebugViewer.vue";

const RUN = {
  time: "night",
  sky: "rain",
  light: "wet neon glow",
  props: "a red umbrella and a hat",
  scratch: "notes",
  __wp_debug_version__: 2,
  __wp_node_seed__: 7,
  __wp_nodes__: [{ node_id: "1", seed: 3 }, { node_id: "2", seed: 7 }],
  __wp_internal_flags__: { scratch: true },
  __wp_multi__: { props: { items: ["a red umbrella", "a hat"], sep: " and " } },
  __wp_constraint_hits__: { con1: 1 },
  __wp_trace__: [
    {
      id: "tim00001", _uid: "tim00001u", type: "wildcard", status: "ok", seed: 3, node_id: "1", name: "Time",
      writes: [{ variable: "time", value: "night" }], detail: { option_id: "night", chance: 0.6, pool: 3, live: 3 },
    },
    {
      id: "sky00001", _uid: "sky00001u", type: "wildcard", status: "ok", seed: 3, node_id: "1", name: "Weather",
      writes: [{ variable: "sky", value: "rain" }], detail: { option_id: "rain", chance: 0.4, pool: 3, live: 3 },
    },
    {
      id: "con1", _uid: "con1", type: "constraint", status: "ok", node_id: "1", name: "Dress code",
      constraint_source: "tim00001", constraint_target: "sky00001", writes: [],
      detail: { uid: "con1", reach: { mode: "first" }, cells: 0, exceptions: 1, only: true },
    },
    {
      id: "der00001", _uid: "der00001u", type: "derivation", status: "ok", seed: 7, node_id: "2", name: "Lighting",
      writes: [{ variable: "light", value: "wet neon glow" }],
      detail: {
        rules: [{
          id: "r1", fired: 1, has_else: true,
          branches: [
            { index: 0, matched: false, condition: { var: "time", op: "equals", value: "day", actual: "night", result: false } },
            {
              index: 1, matched: true,
              condition: {
                match: "all", result: true, conditions: [
                  { var: "time", op: "equals", value: "night", actual: "night", result: true },
                  { match: "any", result: true, conditions: [
                    { var: "sky", op: "equals", value: "rain", actual: "rain", result: true },
                    { var: "sky", op: "equals", value: "fog", actual: "rain", result: false },
                  ] },
                ],
              },
            },
          ],
          action: { target: "light", mode: "replace", value: "wet neon glow", result: "wet neon glow" },
        }],
      },
    },
    {
      id: "pro00001", _uid: "pro00001u", type: "wildcard", status: "ok", seed: 7, node_id: "2", name: "Props",
      writes: [{ variable: "props", value: "a red umbrella and a hat" }],
      detail: { option_ids: ["umb", "hat"], range: [2, 2], pool: 3, live: 3 },
    },
    { id: "off00001", _uid: "off00001u", type: "wildcard", status: "skipped_frame", node_id: "2", binding: "mood" },
  ],
  __wp_ref_log__: [{ owner: "pro00001u", node_id: "2", uuid: "col00001", name: "color", depth: 0, value: "red" }],
  __wp_warnings__: [
    {
      type: "unknown_ref", severity: "warn", owner_uid: "pro00001u", owner_id: "pro00001", node_id: "2",
      detail: { uuid: "deadbeef", name: "hat" }, message: "Unknown wildcard ref @{deadbeef#hat}",
    },
  ],
};

function mountRun(extra: Record<string, unknown> = {}, snapshot: unknown = RUN) {
  return mount(DebugViewer, {
    props: { snapshot: JSON.stringify(snapshot), ...extra },
    attachTo: document.body,
  });
}

async function openTab(w: ReturnType<typeof mountRun>, id: string) {
  await w.find(`[data-test="dbg-tab-${id}"]`).trigger("click");
}

describe("DebugViewer", () => {
  it("shows an empty state before the first run", () => {
    const w = mount(DebugViewer, { props: { snapshot: "" } });
    expect(w.text()).toContain("No snapshot yet.");
    expect(w.find(".wp-dbg-tabs").exists()).toBe(false);
  });

  it("opens on Variables with four tabs and counts", () => {
    const w = mountRun();
    const tabs = w.findAll(".wp-dbg-tab");
    expect(tabs.map((t) => t.text().replace(/\s+/g, " ").trim())).toEqual([
      "Variables 5", "Trace 6", "Warnings 1", "Raw",
    ]);
    expect(w.find(".wp-dbg-tab.is-active").text()).toContain("Variables");
  });

  it("summarises the run in the header", async () => {
    const w = mountRun();
    expect(w.find('[data-test="dbg-seed"]').text()).toContain("7");
    expect(w.find('[data-test="dbg-head-warn"]').text()).toContain("1 warning");
    await w.find('[data-test="dbg-head-warn"]').trigger("click");
    expect(w.find(".wp-dbg-tab.is-active").text()).toContain("Warnings");
    const clean = mountRun({}, { a: "1", __wp_trace__: [] });
    expect(clean.find('[data-test="dbg-head-ok"]').exists()).toBe(true);
  });

  it("lists variables with their writer, list items and internal flag", () => {
    const w = mountRun();
    const rows = w.findAll('[data-test="dbg-var"]');
    expect(rows).toHaveLength(5);
    const props = rows.find((r) => r.text().includes("$props"));
    expect(props?.findAll('[data-test="dbg-var-items"] li').map((li) => li.text())).toEqual([".0a red umbrella", ".1a hat"]);
    expect(props?.find('[data-test="dbg-var-src"]').text()).toContain("Props");
    const scratch = rows.find((r) => r.text().includes("$scratch"));
    expect(scratch?.classes()).toContain("is-internal");
    expect(scratch?.text()).toContain("upstream");
  });

  it("jumps from a variable to the step that wrote it", async () => {
    const w = mountRun();
    const light = w.findAll('[data-test="dbg-var"]').find((r) => r.text().includes("$light"));
    await light?.find('[data-test="dbg-var-src"]').trigger("click");
    await flushPromises();
    expect(w.find(".wp-dbg-tab.is-active").text()).toContain("Trace");
    const step = w.find('[data-step-key="3"]');
    expect(step.classes()).toContain("is-open");
    expect(step.find('[data-test="dbg-rule"]').exists()).toBe(true);
  });

  it("groups the trace by Context node, named by its codename", async () => {
    const nodeInfo = vi.fn((id: string) => ({ title: id === "1" ? "Scene" : "Details", codename: `code-${id}` }));
    const w = mountRun({ nodeInfo });
    await openTab(w, "trace");
    const heads = w.findAll('[data-test="dbg-group-head"]');
    expect(heads.map((h) => h.text().replace(/\s+/g, ""))).toEqual(["code-1seed3", "code-2seed7"]);
    expect(heads[0].get('[data-test="dbg-group-title"]').attributes("title")).toBe("Scene · node id 1");
  });

  it("names a node without a codename by its title, and a missing one by its id", async () => {
    const nodeInfo = vi.fn((id: string) => ({ title: id === "1" ? "WP Context Injector" : "", codename: "" }));
    const w = mountRun({ nodeInfo });
    await openTab(w, "trace");
    const titles = w.findAll('[data-test="dbg-group-title"]').map((t) => t.text());
    expect(titles).toEqual(["WP Context Injector", "Node 2"]);
  });

  it("explains a derivation: which branch fired and each test's result", async () => {
    const w = mountRun();
    await openTab(w, "trace");
    await w.find('[data-step-key="3"] .wp-dbg-step__row').trigger("click");
    const rule = w.find('[data-test="dbg-rule"]');
    expect(rule.find('[data-test="dbg-rule-outcome"]').text()).toBe("ELIF 1 fired");
    const tests = rule.findAll('[data-test="dbg-cond"]');
    expect(tests.map((t) => t.attributes("data-result"))).toEqual(["miss", "match", "match", "miss"]);
    expect(tests[0].text()).toContain("was night");
    expect(rule.findAll('[data-test="dbg-cond-group"]')).toHaveLength(2);
    expect(rule.find('[data-test="dbg-rule-action"]').text()).toContain("$light");
  });

  it("shows pick odds, nested picks and a step's own warnings", async () => {
    const w = mountRun();
    await openTab(w, "trace");
    expect(w.find('[data-step-key="0"]').text()).toContain("60%");
    await w.find('[data-step-key="0"] .wp-dbg-step__row').trigger("click");
    expect(w.find('[data-test="dbg-chance"]').text()).toBe("60% odds");
    await w.find('[data-step-key="4"] .wp-dbg-step__row').trigger("click");
    const props = w.find('[data-step-key="4"]');
    expect(props.find('[data-test="dbg-ref"]').text()).toContain("@color");
    expect(props.text()).toContain("Reference not found");
    expect(props.text()).toContain("2 picks (asked 2)");
  });

  it("shows constraint reach, hits and the Only rule", async () => {
    const w = mountRun();
    await openTab(w, "trace");
    await w.find('[data-step-key="2"] .wp-dbg-step__row').trigger("click");
    const c = w.find('[data-step-key="2"]');
    expect(c.text()).toContain("reaches first target");
    expect(c.find('[data-test="dbg-constraint-hits"]').text()).toBe("applied 1×");
    expect(c.text()).toContain("uses Only");
  });

  it("labels a per-frame skip", async () => {
    const w = mountRun();
    await openTab(w, "trace");
    expect(w.find('[data-step-key="5"] [data-test="dbg-status"]').text()).toBe("off this frame");
  });

  it("filters trace steps and keeps pinned ones", async () => {
    const w = mountRun();
    await openTab(w, "trace");
    await w.find('[data-test="dbg-filter"]').setValue("weather");
    expect(w.findAll('[data-test="dbg-step"]')).toHaveLength(1);
    await w.find('[data-test="dbg-filter"]').setValue("nothing-matches");
    expect(w.text()).toContain("No step matches.");
  });

  it("expands and collapses every step", async () => {
    const w = mountRun();
    await openTab(w, "trace");
    await w.find('[data-test="dbg-expand-all"]').trigger("click");
    expect(w.findAll(".wp-dbg-step.is-open")).toHaveLength(6);
    await w.find('[data-test="dbg-expand-all"]').trigger("click");
    expect(w.findAll(".wp-dbg-step.is-open")).toHaveLength(0);
  });

  it("links a warning to the module that raised it", async () => {
    const w = mountRun();
    await openTab(w, "warnings");
    const row = w.find('[data-test="dbg-warning"]');
    expect(row.text()).toContain("Reference not found");
    expect(row.text()).toContain("placeholder, or a module that was deleted");
    await row.find('[data-test="dbg-warning-owner"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-step-key="4"]').classes()).toContain("is-open");
  });

  it("offers Show node only when the canvas can focus it", async () => {
    const focusNode = vi.fn();
    const w = mountRun({ focusNode });
    await openTab(w, "trace");
    await w.find('[data-step-key="0"] .wp-dbg-step__row').trigger("click");
    await w.find('[data-test="dbg-focus-node"]').trigger("click");
    expect(focusNode).toHaveBeenCalledWith("1");
    const plain = mountRun();
    await openTab(plain, "trace");
    await plain.find('[data-step-key="0"] .wp-dbg-step__row').trigger("click");
    expect(plain.find('[data-test="dbg-focus-node"]').exists()).toBe(false);
  });

  it("opens the shared context menu on a step", async () => {
    const w = mountRun();
    await openTab(w, "trace");
    await w.find('[data-step-key="0"] .wp-dbg-step__row').trigger("contextmenu");
    await flushPromises();
    const menu = document.body.textContent ?? "";
    expect(menu).toContain("Copy seed");
    expect(menu).toContain("Copy module id");
    w.unmount();
  });

  it("an opened step repeats a value the row cut off, even a short one", async () => {
    const snap = {
      __wp_debug_version__: 2,
      a: "short but clipped",
      __wp_trace__: [{
        id: "fv000001", type: "fixed_values", status: "ok", node_id: "1",
        writes: [{ variable: "a", value: "short but clipped" }],
      }],
    };
    const w = mountRun({}, snap);
    await openTab(w, "trace");
    const val = w.find('[data-step-key="0"] .wp-dbg-step__val').element as HTMLElement;
    Object.defineProperty(val, "scrollWidth", { configurable: true, value: 300 });
    Object.defineProperty(val, "clientWidth", { configurable: true, value: 120 });
    await w.find('[data-step-key="0"] .wp-dbg-step__row').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="dbg-full-value"]').text()).toContain("short but clipped");
  });

  it("an opened step does not repeat a short value that fits", async () => {
    const snap = {
      __wp_debug_version__: 2,
      a: "fits",
      __wp_trace__: [{
        id: "fv000001", type: "fixed_values", status: "ok", node_id: "1",
        writes: [{ variable: "a", value: "fits" }],
      }],
    };
    const w = mountRun({}, snap);
    await openTab(w, "trace");
    await w.find('[data-step-key="0"] .wp-dbg-step__row').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="dbg-full-value"]').exists()).toBe(false);
  });

  it("tells the user an old snapshot has less to show", async () => {
    const old = { a: "1", __wp_trace__: [{ id: "x", type: "wildcard", status: "ok", writes: [{ variable: "a", value: "1" }] }] };
    const w = mountRun({}, old);
    await openTab(w, "trace");
    expect(w.find('[data-test="dbg-old-note"]').exists()).toBe(true);
    expect(w.find('[data-test="dbg-group-head"]').exists()).toBe(false);
  });

  it("renders @{uuid} refs in values as named chips", () => {
    const snap = {
      look: "a @{c0100001} hat",
      __wp_trace__: [
        { id: "c0100001", type: "wildcard", status: "ok", writes: [{ variable: "color", value: "red" }] },
        { id: "look0001", type: "wildcard", status: "ok", writes: [{ variable: "look", value: "a @{c0100001} hat" }] },
      ],
    };
    const w = mountRun({}, snap);
    const chip = w.find('[data-test="dbg-var"] .wp-rt-ref');
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain("color");
  });

  it("steps between loop iterations", async () => {
    const w = mountRun({ iterationCount: 3, iterationIndex: 1 });
    expect(w.find('[data-test="dbg-iter-label"]').text()).toBe("frame 2 / 3");
    await w.find('[data-test="dbg-iter-next"]').trigger("click");
    expect(w.emitted("update:iterationIndex")?.[0]).toEqual([2]);
  });

  it("shows the raw snapshot JSON", async () => {
    const w = mountRun();
    await openTab(w, "raw");
    expect(w.find(".wp-dbg-raw").text()).toContain("__wp_trace__");
  });

  const NEG_RUN = {
    ...RUN,
    __wp_negatives__: {
      sky: [{ text: "sunny", pick: null, source: "sky" }, { text: "blue sky", pick: null, source: "r1:1" }],
      props: [{ text: "broken umbrella", pick: 0, source: "props" }, { text: "cap", pick: 1, source: "props" }],
    },
  };

  it("lists each variable's negatives, its sources and a count", () => {
    const w = mountRun({}, NEG_RUN);
    expect(w.find('[data-test="dbg-neg-count"]').text()).toBe("2 negatives");
    const rows = w.findAll('[data-test="dbg-var"]');
    const sky = rows.find((r) => r.text().includes("$sky"));
    const lines = sky?.findAll('[data-test="dbg-var-neg"]') ?? [];
    expect(lines.map((l) => l.find(".wp-dbg-var-row__neg-text").text())).toEqual(["sunny", "blue sky"]);
    expect(lines[1].find('[data-test="dbg-var-neg-src"]').text()).toBe("· Lighting");
    expect(lines[0].find('[data-test="dbg-var-neg-src"]').exists()).toBe(false);
    const props = rows.find((r) => r.text().includes("$props"));
    expect(props?.find('[data-test="dbg-var-neg"]').text()).toContain("broken umbrella, cap");
    expect(props?.find('[data-test="dbg-var-neg-src"]').exists()).toBe(false);
    expect(mountRun().find('[data-test="dbg-neg-count"]').exists()).toBe(false);
  });

  it("filters variables by their negative words", async () => {
    const w = mountRun({}, NEG_RUN);
    await w.find('[data-test="dbg-filter"]').setValue("umbrella");
    expect(w.findAll('[data-test="dbg-var"]').map((r) => r.find("code").text())).toEqual(["$props"]);
  });

  it("shows a write's negative in the trace", async () => {
    const snap = {
      ...RUN,
      __wp_trace__: [{ ...RUN.__wp_trace__[0], writes: [{ variable: "time", value: "night", negative: "daylight" }] }],
    };
    const w = mountRun({}, snap);
    await openTab(w, "trace");
    await w.find(".wp-dbg-step__row").trigger("click");
    expect(w.find('[data-test="dbg-step-neg"]').text()).toBe("$timenegative:daylight");
  });

  it("keeps the negatives table in the raw JSON", async () => {
    const w = mountRun({}, NEG_RUN);
    await openTab(w, "raw");
    expect(w.find(".wp-dbg-raw").text()).toContain("__wp_negatives__");
  });
});
