/**
 * State for the Test Runner workbench: the saved scenarios, the one being
 * edited (a draft that may be unsaved), and its latest run.
 *
 * A "quick run" is a draft with no id — what Send to Test Runner opens. It
 * behaves like any scenario until the user saves it.
 */
import { computed, ref } from "vue";
import { api } from "../api/client";
import type {
  BundleRow,
  ModuleRow,
  ScenarioRow,
  ScenarioRunResponse,
  ScenarioSeedSpec,
  ScenarioStackItem,
} from "../api/types";
import { useToast } from "./useToast";
import {
  DEFAULT_SEEDS,
  defaultOutputVar,
  describeItem,
  lastRunSummary,
  unsetReads,
} from "../utils/scenario";

export interface ScenarioDraft {
  id: string | null;
  name: string;
  is_pinned: boolean;
  stack: ScenarioStackItem[];
  pins: Record<string, string>;
  seeds: ScenarioSeedSpec;
  /** null = follow the stack (last combine's output). */
  output_var: string | null;
}

/** Samples returned in full per run; counts always cover every seed. */
export const SAMPLE_LIMIT = 200;

function emptyDraft(name = "Quick run"): ScenarioDraft {
  return { id: null, name, is_pinned: false, stack: [], pins: {}, seeds: { ...DEFAULT_SEEDS }, output_var: null };
}

function draftFromRow(row: ScenarioRow): ScenarioDraft {
  return {
    id: row.id, name: row.name, is_pinned: row.is_pinned,
    stack: row.stack.map((i) => ({ ...i })), pins: { ...row.pins },
    seeds: { ...row.seeds } as ScenarioSeedSpec, output_var: row.output_var,
  };
}

/** The fields that make a draft differ from its saved row. */
function editable(d: ScenarioDraft) {
  return { name: d.name, is_pinned: d.is_pinned, stack: d.stack, pins: d.pins, seeds: d.seeds, output_var: d.output_var };
}

export function useScenarioWorkbench() {
  const toast = useToast();

  const modules = ref<ModuleRow[]>([]);
  const bundles = ref<BundleRow[]>([]);
  const scenarios = ref<ScenarioRow[]>([]);
  const loading = ref(false);

  const draft = ref<ScenarioDraft>(emptyDraft());
  /** Snapshot of the draft as last saved/loaded, for the dirty check. */
  const savedJson = ref(JSON.stringify(editable(draft.value)));
  const result = ref<ScenarioRunResponse | null>(null);
  /** The output variable the current result was rendered for. */
  const running = ref(false);
  const saving = ref(false);
  const runError = ref<string | null>(null);

  const dirty = computed(() => JSON.stringify(editable(draft.value)) !== savedJson.value);

  const stackViews = computed(() =>
    draft.value.stack.map((item) => describeItem(item, modules.value, bundles.value)),
  );

  /** Per stack item, the `$vars` it reads that nothing earlier sets. */
  const unset = computed(() =>
    unsetReads(draft.value.stack, modules.value, bundles.value, draft.value.pins),
  );

  const outputVar = computed(() => draft.value.output_var ?? defaultOutputVar(stackViews.value));

  async function loadLibrary(): Promise<void> {
    loading.value = true;
    try {
      const [mods, bdls, scns] = await Promise.all([
        api.modules.list({}),
        api.bundles.list({}),
        api.scenarios.list(),
      ]);
      modules.value = mods.items;
      bundles.value = bdls.items;
      scenarios.value = scns.items;
    } catch (e) {
      toast.push({ severity: "error", summary: "Couldn't load the library", detail: String(e), life: 4000 });
    } finally {
      loading.value = false;
    }
  }

  function markSaved(): void {
    savedJson.value = JSON.stringify(editable(draft.value));
  }

  function openScenario(row: ScenarioRow): void {
    draft.value = draftFromRow(row);
    markSaved();
    result.value = null;
    runError.value = null;
  }

  /** Start an unsaved quick run, optionally seeded with one stack item. */
  function newQuickRun(item?: ScenarioStackItem): void {
    const d = emptyDraft();
    if (item) {
      d.stack = [item];
      const view = describeItem(item, modules.value, bundles.value);
      d.name = `Quick run: ${view.name}`;
    }
    draft.value = d;
    markSaved();
    result.value = null;
    runError.value = null;
  }

  async function run(): Promise<void> {
    if (!draft.value.stack.length || running.value) return;
    running.value = true;
    runError.value = null;
    try {
      const res = await api.testRun({
        stack: draft.value.stack,
        pins: draft.value.pins,
        seeds: draft.value.seeds,
        sample_limit: SAMPLE_LIMIT,
      });
      result.value = res;
      const id = draft.value.id;
      if (id) {
        // Persist the rail summary without touching the user's unsaved edits.
        const row = await api.scenarios.update(id, { last_run: { ...lastRunSummary(res) } });
        scenarios.value = scenarios.value.map((s) => (s.id === id ? row : s));
      }
    } catch (e) {
      runError.value = e instanceof Error ? e.message : String(e);
      toast.push({ severity: "error", summary: "Run failed", detail: runError.value, life: 4000 });
    } finally {
      running.value = false;
    }
  }

  async function save(): Promise<ScenarioRow | null> {
    saving.value = true;
    try {
      const body = { ...editable(draft.value), name: draft.value.name.trim() || "Untitled scenario" };
      const row = draft.value.id
        ? await api.scenarios.update(draft.value.id, body)
        : await api.scenarios.create({
          ...body,
          last_run: result.value ? { ...lastRunSummary(result.value) } : null,
        });
      draft.value = draftFromRow(row);
      markSaved();
      const others = scenarios.value.filter((s) => s.id !== row.id);
      scenarios.value = [row, ...others].sort(
        (a, b) => Number(b.is_pinned) - Number(a.is_pinned) || b.updated_at.localeCompare(a.updated_at),
      );
      toast.push({ severity: "success", summary: "Scenario saved", life: 1800 });
      return row;
    } catch (e) {
      toast.push({ severity: "error", summary: "Couldn't save the scenario", detail: String(e), life: 4000 });
      return null;
    } finally {
      saving.value = false;
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await api.scenarios.remove(id);
      scenarios.value = scenarios.value.filter((s) => s.id !== id);
      if (draft.value.id === id) newQuickRun();
      toast.push({ severity: "success", summary: "Scenario deleted", life: 1800 });
    } catch (e) {
      toast.push({ severity: "error", summary: "Couldn't delete the scenario", detail: String(e), life: 4000 });
    }
  }

  async function togglePin(row: ScenarioRow): Promise<void> {
    try {
      const updated = await api.scenarios.update(row.id, { is_pinned: !row.is_pinned });
      scenarios.value = scenarios.value
        .map((s) => (s.id === row.id ? updated : s))
        .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || b.updated_at.localeCompare(a.updated_at));
      if (draft.value.id === row.id) {
        draft.value.is_pinned = updated.is_pinned;
        const saved = JSON.parse(savedJson.value) as ReturnType<typeof editable>;
        savedJson.value = JSON.stringify({ ...saved, is_pinned: updated.is_pinned });
      }
    } catch (e) {
      toast.push({ severity: "error", summary: "Couldn't pin the scenario", detail: String(e), life: 4000 });
    }
  }

  return {
    modules, bundles, scenarios, loading,
    draft, dirty, result, running, saving, runError,
    stackViews, outputVar, unset,
    loadLibrary, openScenario, newQuickRun, run, save, remove, togglePin,
  };
}
