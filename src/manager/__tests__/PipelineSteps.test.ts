import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PipelineSteps from "../components/PipelineSteps.vue";
import type { ModuleRow, ModuleType, PipelineStep } from "../api/types";

function makeModule(over: Partial<ModuleRow>): ModuleRow {
  return {
    id: "m_a",
    uuid: "aabbccdd",
    type: "wildcard",
    name: "alpha",
    description: "",
    category_id: null,
    tags: [],
    is_favorite: false,
    payload: {},
    payload_hash: "0".repeat(64),
    version: 1,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function makeStep(over: Partial<PipelineStep>): PipelineStep {
  return { id: "step_aaa", module_id: "m_a", enabled: true, ...over };
}

function buildKindGroups(modules: ModuleRow[]): Record<ModuleType, ModuleRow[]> {
  const groups: Record<ModuleType, ModuleRow[]> = {
    wildcard: [], fixed_values: [], combine: [],
    derivation: [], constraint: [], pipeline: [],
  };
  for (const m of modules) groups[m.type].push(m);
  return groups;
}

function mountSteps(steps: PipelineStep[], modules: ModuleRow[]) {
  const modulesById = new Map(modules.map((m) => [m.id, m]));
  return mount(PipelineSteps, {
    props: {
      steps,
      modulesById,
      modulesByKind: buildKindGroups(modules),
    },
    global: { plugins: [] },
  });
}

describe("PipelineSteps.vue", () => {
  it("renders empty state when no steps", () => {
    const wrap = mountSteps([], []);
    expect(wrap.text()).toContain("No modules yet");
    expect(wrap.findAll('[data-test^="pipeline-step-"]').length).toBe(0);
  });

  it("renders one row per step with name resolved from catalog", () => {
    const mod = makeModule({ id: "m_a", name: "Hair Color", type: "wildcard" });
    const mod2 = makeModule({ id: "m_b", name: "Outfit", type: "fixed_values" });
    const steps = [
      makeStep({ id: "s1", module_id: "m_a" }),
      makeStep({ id: "s2", module_id: "m_b" }),
    ];
    const wrap = mountSteps(steps, [mod, mod2]);
    expect(wrap.findAll('[data-test^="pipeline-step-"]').length).toBe(2);
    expect(wrap.text()).toContain("Hair Color");
    expect(wrap.text()).toContain("Outfit");
  });

  it("emits update:steps with reordered list when step moved down", async () => {
    const a = makeModule({ id: "m_a", name: "alpha", type: "wildcard" });
    const b = makeModule({ id: "m_b", name: "beta", type: "wildcard" });
    const steps = [
      makeStep({ id: "s1", module_id: "m_a" }),
      makeStep({ id: "s2", module_id: "m_b" }),
    ];
    const wrap = mountSteps(steps, [a, b]);
    const downBtn = wrap.find('[data-test="step-down-0"]');
    await downBtn.trigger("click");
    const emitted = wrap.emitted("update:steps");
    expect(emitted).toBeTruthy();
    const next = (emitted ?? [])[0][0] as PipelineStep[];
    expect(next.map((s) => s.module_id)).toEqual(["m_b", "m_a"]);
  });

  it("emits open-picker event when add button clicked", async () => {
    const wrap = mountSteps([], []);
    const addBtn = wrap.find('[data-test="pipeline-add-step"]');
    await addBtn.trigger("click");
    expect(wrap.emitted("open-picker")).toBeTruthy();
  });

  it("emits update:steps when toggle enabled clicked", async () => {
    const mod = makeModule({ id: "m_a", name: "alpha", type: "wildcard" });
    const steps = [makeStep({ id: "s1", module_id: "m_a", enabled: true })];
    const wrap = mountSteps(steps, [mod]);
    await wrap.find('[data-test="step-toggle-0"]').trigger("click");
    const emitted = wrap.emitted("update:steps");
    expect(emitted).toBeTruthy();
    const next = (emitted ?? [])[0][0] as PipelineStep[];
    expect(next[0].enabled).toBe(false);
  });

  it("emits update:steps when remove clicked", async () => {
    const mod = makeModule({ id: "m_a", name: "alpha", type: "wildcard" });
    const steps = [
      makeStep({ id: "s1", module_id: "m_a" }),
      makeStep({ id: "s2", module_id: "m_a" }),
    ];
    const wrap = mountSteps(steps, [mod]);
    await wrap.find('[data-test="step-remove-0"]').trigger("click");
    const emitted = wrap.emitted("update:steps");
    expect(emitted).toBeTruthy();
    const next = (emitted ?? [])[0][0] as PipelineStep[];
    expect(next.length).toBe(1);
    expect(next[0].id).toBe("s2");
  });

  // Subtitle helper exposes the module's `$var` summary on the collapsed
  // row so users can scan resolution order without expanding each step.
  // Each kind has a different "exported binding" shape — pin them here so
  // a future refactor on the helper doesn't silently drop a kind's preview.
  describe("subtitle preview", () => {
    it("shows $var_binding for wildcard kind", () => {
      const mod = makeModule({
        id: "m_a", type: "wildcard", name: "Hair Color",
        payload: { var_binding: "hair_color" },
      });
      const wrap = mountSteps([makeStep({ module_id: "m_a" })], [mod]);
      expect(wrap.text()).toContain("$hair_color");
    });

    it("shows truncated $name list with +N for fixed_values", () => {
      const mod = makeModule({
        id: "m_a", type: "fixed_values", name: "Subject Profile",
        payload: { values: [
          { name: "name", value: "Alice" },
          { name: "age", value: "30" },
          { name: "build", value: "tall" },
          { name: "occupation", value: "engineer" },
        ]},
      });
      const wrap = mountSteps([makeStep({ module_id: "m_a" })], [mod]);
      expect(wrap.text()).toContain("$name, $age, $build, +1");
    });

    it("shows $output_var for combine kind", () => {
      const mod = makeModule({
        id: "m_a", type: "combine", name: "Phrase",
        payload: { output_var: "subject_phrase" },
      });
      const wrap = mountSteps([makeStep({ module_id: "m_a" })], [mod]);
      expect(wrap.text()).toContain("$subject_phrase");
    });

    it("shows step count for pipeline kind", () => {
      const mod = makeModule({
        id: "m_a", type: "pipeline", name: "Inner",
        payload: { steps: [{}, {}, {}] },
      });
      const wrap = mountSteps([makeStep({ module_id: "m_a" })], [mod]);
      expect(wrap.text()).toContain("3 steps");
    });

    it("shows source × target for constraint kind", () => {
      const wc1 = makeModule({ id: "m_src", type: "wildcard", name: "mood" });
      const wc2 = makeModule({ id: "m_tgt", type: "wildcard", name: "color" });
      const mod = makeModule({
        id: "m_c", type: "constraint", name: "mood_x_color",
        payload: { source_wildcard_id: "m_src", target_wildcard_id: "m_tgt" },
      });
      const wrap = mountSteps([makeStep({ module_id: "m_c" })], [wc1, wc2, mod]);
      expect(wrap.text()).toContain("mood × color");
    });
  });

  it("emits update:steps with duplicated row when duplicate clicked", async () => {
    const mod = makeModule({ id: "m_a", name: "alpha", type: "wildcard" });
    const steps = [makeStep({ id: "s1", module_id: "m_a" })];
    const wrap = mountSteps(steps, [mod]);
    await wrap.find('[data-test="step-duplicate-0"]').trigger("click");
    const emitted = wrap.emitted("update:steps");
    expect(emitted).toBeTruthy();
    const next = (emitted ?? [])[0][0] as PipelineStep[];
    expect(next.length).toBe(2);
    expect(next[0].module_id).toBe("m_a");
    expect(next[1].module_id).toBe("m_a");
    expect(next[1].id).not.toBe(next[0].id);
  });
});
