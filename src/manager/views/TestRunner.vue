<script setup lang="ts">
/**
 * Test Runner — a scenario workbench on the real engine.
 *
 * A scenario is a stack of library modules and bundles (run like a Context
 * node), pinned `$var` values and a seed range. Every run goes through
 * `POST /wp/api/test/run`, one real chain seed per run, so what this page
 * shows is what the canvas produces for the same seeds.
 *
 * "Send to Test Runner" deep-links here as `?kind=<kind>&module=<id>` and
 * opens an unsaved quick run holding that module or bundle.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "../components/ui/Button.vue";
import Icon, { ICON_SM } from "../components/ui/Icon.vue";
import ScenarioRail from "../components/test-runner/ScenarioRail.vue";
import StackBuilder from "../components/test-runner/StackBuilder.vue";
import SeedControl from "../components/test-runner/SeedControl.vue";
import VariablesPanel from "../components/test-runner/VariablesPanel.vue";
import OutputsPanel from "../components/test-runner/OutputsPanel.vue";
import SamplesPanel from "../components/test-runner/SamplesPanel.vue";
import WarningsPanel from "../components/test-runner/WarningsPanel.vue";
import ComparePanel from "../components/test-runner/ComparePanel.vue";
import AiRunBar from "../components/test-runner/AiRunBar.vue";
import WpTabs, { type TabItem } from "@/kit/WpTabs.vue";
import { useAiConfig } from "../composables/useAiConfig";
import TraceDrawer from "../components/test-runner/TraceDrawer.vue";
import InspectorDrawer from "../components/test-runner/InspectorDrawer.vue";
import { useScenarioWorkbench } from "../composables/useScenarioWorkbench";
import { currentPageNote, registerPageNote } from "../composables/useOpenEditor";
import { registerAiAction } from "../composables/useAiActions";
import { useDeleteConfirm } from "../composables/useDeleteConfirm";
import ConfirmModal from "../components/ui/ConfirmModal.vue";
import { buildUuidToName } from "../utils/wildcardSyntax";
import { seedLabel } from "../utils/scenario";
import { inspectItem } from "../utils/inspect";
import type { ScenarioRow, ScenarioStackItem } from "../api/types";

const route = useRoute();
const router = useRouter();
const wb = useScenarioWorkbench();
const ai = useAiConfig();
const { draft, result } = wb;

// Tell the AI chat what this run holds, so it can explain a warning or a
// result the user is looking at.
registerPageNote(() => {
  const stack = wb.stackViews.value
    .map((v) => `${v.name} (${v.kind}${v.id ? ` ${v.id}` : ""}${v.enabled ? "" : ", off"})`)
    .join(", ");
  const bits = [`Test Runner scenario "${draft.value.name || "Quick run"}" with ${stack || "nothing"}`];
  // The same stack in run_test's words, so the chat can re-run it as is.
  const runStack = draft.value.stack
    .filter((item) => item.enabled !== false)
    .map((item) => "bundle" in item ? { item: item.bundle }
      : item.instance && Object.keys(item.instance).length
        ? { item: item.module, instance: item.instance } : { item: item.module });
  const pins = Object.fromEntries(Object.entries(draft.value.pins ?? {}).filter(([, v]) => v !== ""));
  bits.push(`run_test args: ${JSON.stringify({ stack: runStack, ...(Object.keys(pins).length ? { pins } : {}) })}`);
  const r = result.value;
  if (r) {
    bits.push(`Last run: ${r.runs} seeds, ${r.failed} failed`);
    const vars = Object.entries(r.variables).slice(0, 8).map(([name, v]) => {
      const top = Object.entries(v.counts).slice(0, 3).map(([val, n]) => `${val} ${n}`).join(", ");
      return `$${name}: ${v.distinct} values (${top})`;
    });
    if (vars.length) bits.push(vars.join("; "));
    const warns = r.warnings.slice(0, 6).map((w) => `${w.type}: ${w.message} (${w.count} runs)`);
    bits.push(warns.length ? `Warnings: ${warns.join("; ")}` : "No warnings");
  }
  return bits.join(". ");
});

type Tab = "variables" | "outputs" | "samples" | "warnings" | "compare";
const tab = ref<Tab>("variables");
const traceSeed = ref<number | null>(null);
const editingName = ref(false);

const uuidToName = computed(() => buildUuidToName(wb.modules.value));

const traceSample = computed(() =>
  traceSeed.value === null ? null : result.value?.samples.find((s) => s.seed === traceSeed.value) ?? null,
);

const warningCount = computed(() => result.value?.warnings.reduce((n, w) => n + w.count, 0) ?? 0);
const uniqueOutputs = computed(() => {
  const out = wb.outputVar.value;
  return out ? result.value?.variables[out]?.distinct ?? null : null;
});

const TABS = computed<TabItem<Tab>[]>(() => [
  { id: "variables", label: "Variables", count: result.value ? Object.keys(result.value.variables).length : undefined },
  { id: "outputs", label: "Outputs" },
  { id: "samples", label: "Samples", count: result.value?.samples.length },
  { id: "warnings", label: "Warnings", count: result.value ? warningCount.value + result.value.failed : undefined },
  // The Compare count is a change count, not a total, so it is coloured.
  {
    id: "compare", label: "Compare", count: wb.diff.value ? wb.diff.value.changed.length : undefined,
    tone: wb.diff.value ? (wb.diff.value.same ? "success" : "warn") : undefined,
  },
]);

function openTrace(seed: number): void {
  inspectIndex.value = null;
  traceSeed.value = seed;
}

/* ---------------------------- inspector ---------------------------- */

const inspectIndex = ref<number | null>(null);
const inspectView = computed(() =>
  inspectIndex.value === null ? null : wb.stackViews.value[inspectIndex.value] ?? null,
);
const inspectData = computed(() => {
  const v = inspectView.value;
  if (!v || inspectIndex.value === null) return null;
  return inspectItem(v, inspectIndex.value, wb.modules.value, wb.bundles.value, v.enabled ? result.value : null);
});
/** The last run still lines up with the inspected card. */
const inspectHasRun = computed(() => {
  const i = inspectIndex.value;
  const v = inspectView.value;
  return !!v && i !== null && !!result.value?.stack.some((s) => s.index === i && s.id === v.id);
});

function openInspector(i: number): void {
  traceSeed.value = null;
  inspectIndex.value = inspectIndex.value === i ? null : i;
}

const EDIT_ROUTES: Record<string, string> = {
  wildcard: "wildcards-edit",
  combine: "combines-edit",
  derivation: "derivations-edit",
  constraint: "constraints-edit",
  fixed_values: "fixed-values-edit",
  bundle: "bundles-edit",
};

function editInspected(): void {
  const v = inspectView.value;
  if (!v) return;
  const name = EDIT_ROUTES[v.kind];
  if (name) guardDirty(() => void router.push({ name, params: { id: v.id } }));
}

watch(() => draft.value.id, () => { traceSeed.value = null; inspectIndex.value = null; });
// The inspected card moved or was removed: close rather than show another.
watch(() => draft.value.stack.length, () => { inspectIndex.value = null; });

/* --------------------------- deep link ---------------------------- */

function deepLinkItem(): ScenarioStackItem | null {
  const kind = route.query.kind;
  const id = route.query.module;
  if (typeof id !== "string" || !id) return null;
  return kind === "bundle" ? { bundle: id } : { module: id };
}

/** `?uses=<id>` narrows the rail to scenarios holding that module/bundle. */
const usesId = ref<string | null>(typeof route.query.uses === "string" && route.query.uses ? route.query.uses : null);
const uses = computed(() => {
  const id = usesId.value;
  if (!id) return null;
  const name = wb.modules.value.find((m) => m.id === id)?.name ?? wb.bundles.value.find((b) => b.id === id)?.name ?? id;
  return { id, name };
});

/** The quick run as it was opened (Send to Test Runner, or the chat's last
 *  `show_test`): replacing it loses nothing the user did. */
let untouched = "";

let markReady: () => void = () => {};
/** Resolves once the page has loaded the library and opened its scenario. */
const ready = new Promise<void>((resolve) => { markReady = resolve; });

onMounted(async () => {
  try {
    await openFirst();
  } finally {
    markReady();
  }
});

async function openFirst(): Promise<void> {
  await wb.loadLibrary();
  const item = deepLinkItem();
  const using = usesId.value
    ? wb.scenarios.value.find((s) => s.stack.some((i) => ("module" in i ? i.module : i.bundle) === usesId.value))
    : undefined;
  if (using) {
    wb.openScenario(using);
  } else if (item) {
    wb.newQuickRun(item);
    untouched = JSON.stringify(draft.value);
    void wb.run();
  } else if (wb.scenarios.value.length) {
    wb.openScenario(wb.scenarios.value[0]);
  }
}

// The chat's `show_test`: set the stack (seeds, pins, output) up as a quick
// run where the user can see it, run it unless told not to, save it when
// named, and tell the chat what came out (the same text as the page note).
registerAiAction("show_test", async (args) => {
  await ready;
  const stack = (Array.isArray(args.stack) ? args.stack : []) as ScenarioStackItem[];
  if (!stack.length) return "couldn't: the stack is empty";
  const count = Math.min(500, Math.max(1, Number(args.seeds) || 20));
  /** Add / remove keep the open run's seeds and pins unless given. */
  const editing = args.change === "add" || args.change === "remove";
  const idOf = (i: ScenarioStackItem): string => ("module" in i ? i.module : i.bundle);
  if (editing) {
    // Edit the open stack in place (saved scenario or quick run alike):
    // the user asked for this change, so nothing of theirs is lost.
    const ids = new Set(stack.map(idOf));
    if (args.change === "add") {
      const have = new Set(draft.value.stack.map(idOf));
      const fresh = stack.filter((i) => !have.has(idOf(i))).map((i) => ({ ...i }));
      if (!fresh.length) return "couldn't: those are already on the stack";
      draft.value.stack = [...draft.value.stack, ...fresh];
    } else {
      const kept = draft.value.stack.filter((i) => !ids.has(idOf(i)));
      if (kept.length === draft.value.stack.length) return "couldn't: none of those are on the stack";
      if (!kept.length) return "couldn't: that would empty the stack; replace it instead";
      draft.value.stack = kept;
    }
  } else {
    const userEdited = draft.value.id ? wb.dirty.value : JSON.stringify(draft.value) !== untouched;
    if (wb.dirty.value && draft.value.stack.length && userEdited) {
      return "couldn't: the open scenario has unsaved changes; ask the user to save or discard them first";
    }
    wb.newQuickRun(stack[0]);
    draft.value.stack = stack.map((item) => ({ ...item }));
  }
  const from = typeof args.from === "number" ? Math.max(0, Math.floor(args.from)) : null;
  if (!editing || from !== null || typeof args.seeds === "number") {
    draft.value.seeds = from !== null ? { from, count } : { random: true, count };
  }
  const pins = args.pins && typeof args.pins === "object" ? args.pins as Record<string, unknown> : null;
  if (!editing || pins) {
    draft.value.pins = Object.fromEntries(Object.entries(pins ?? {}).map(([k, v]) => [k, String(v)]));
  }
  if (typeof args.output === "string" && args.output) draft.value.output_var = args.output;
  if (typeof args.save === "string" && args.save) draft.value.name = args.save;
  // What the server added to the stack (a constraint's wildcards), said back.
  const notes: string[] = Array.isArray(args.notes) ? args.notes.filter((n): n is string => typeof n === "string") : [];
  if (args.run !== false) {
    await wb.run();
    if (wb.runError.value) return `couldn't run it: ${wb.runError.value}`;
  }
  if (typeof args.save === "string" && args.save) {
    notes.push((await wb.save()) ? `saved it as the scenario "${args.save}"` : "couldn't save it");
  }
  untouched = JSON.stringify(draft.value);
  if (args.run === false) {
    return `set it up in the Test Runner without running${notes.length ? `; ${notes.join("; ")}` : ""}. `
      + "The user presses Run when ready.";
  }
  return `ran it in the Test Runner, where the user sees the results${notes.length ? `; ${notes.join("; ")}` : ""}. `
    + currentPageNote();
});

/* ---------------------------- actions ----------------------------- */

const delConfirm = useDeleteConfirm<ScenarioRow>();

const deleteTitle = computed(() => `Delete "${delConfirm.pending.value?.name ?? ""}"?`);

async function performDelete(row: ScenarioRow): Promise<void> {
  await wb.remove(row.id);
}

/** Leaving an unsaved scenario asks first; the action waits here until
 *  the dialog resolves it. */
const pendingLeave = ref<(() => void) | null>(null);

function guardDirty(action: () => void): void {
  if (wb.dirty.value && draft.value.stack.length) pendingLeave.value = action;
  else action();
}

function confirmLeave(): void {
  const action = pendingLeave.value;
  pendingLeave.value = null;
  action?.();
}

function onSelect(row: ScenarioRow): void {
  if (row.id === draft.value.id) return;
  guardDirty(() => wb.openScenario(row));
}

function onNew(): void {
  guardDirty(() => wb.newQuickRun());
}

function onKeydown(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key === "Enter") {
    e.preventDefault();
    void wb.run();
  } else if (e.key.toLowerCase() === "s") {
    e.preventDefault();
    void wb.save();
  }
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div class="wp-tr" data-test="test-runner">
    <ScenarioRail
      :scenarios="wb.scenarios.value"
      :active-id="draft.id"
      :quick-run-name="draft.id ? null : draft.name"
      :rerun="wb.rerun.value"
      :uses="uses"
      @clear-uses="usesId = null"
      @select="onSelect"
      @rerun-pinned="wb.rerunPinned"
      @new="onNew"
      @toggle-pin="wb.togglePin"
      @delete="delConfirm.ask"
    />

    <main class="wp-tr__main">
      <div class="wp-tr__bar">
        <div class="wp-tr__title">
          <input
            v-if="editingName"
            id="wp-tr-name"
            v-model="draft.name"
            class="wp-tr__name-input"
            aria-label="Scenario name"
            data-test="scenario-name-input"
            @blur="editingName = false"
            @keydown.enter="editingName = false"
          >
          <h1 v-else>
            <button type="button" class="wp-tr__name" title="Rename" data-test="scenario-name" @click="editingName = true">
              {{ draft.name || "Untitled scenario" }}<Icon class="wp-tr__pen" name="pi-pencil" :size="ICON_SM" />
            </button>
          </h1>
          <p class="wp-tr__sub">
            {{ draft.stack.length }} item{{ draft.stack.length === 1 ? "" : "s" }}
            <template v-if="wb.outputVar.value"> · output <code>${{ wb.outputVar.value }}</code></template>
            · {{ seedLabel(draft.seeds) }}
            <span v-if="wb.dirty.value" class="wp-tr__dirty" data-test="dirty">· unsaved changes</span>
          </p>
        </div>
        <span class="wp-tr__sp" />
        <SeedControl v-model="draft.seeds" />
        <Button
          :disabled="!draft.stack.length || wb.saving.value || (!wb.dirty.value && !!draft.id)"
          :loading="wb.saving.value"
          title="Ctrl + S"
          data-test="save-btn"
          @click="wb.save"
        >{{ draft.id ? "Save" : "Save scenario" }}</Button>
        <Button
          variant="primary"
          icon="pi-play"
          :disabled="!draft.stack.length"
          :loading="wb.running.value"
          title="Ctrl + Enter"
          data-test="run-btn" data-ai-anchor="run" data-ai-label="Run button"
          @click="wb.run()"
        >{{ wb.running.value ? "Running…" : "Run" }}</Button>
      </div>

      <div class="wp-tr__content">
        <StackBuilder
          v-model:stack="draft.stack"
          v-model:pins="draft.pins"
          data-ai-anchor="stack"
          data-ai-label="Stack: the modules and bundles to run"
          :views="wb.stackViews.value"
          :unset="wb.unset.value"
          :modules="wb.modules.value"
          :bundles="wb.bundles.value"
          :inspecting="inspectIndex"
          @inspect="openInspector"
        />

        <div v-if="!draft.stack.length" class="wp-tr__start" data-test="start-hint">
          <strong>Add a module or bundle to start.</strong>
          <span>Stack upstream modules in front of the one you're testing, the way they sit on the canvas, and pin any value a node further up would provide. Then Run: every seed goes through the real engine.</span>
        </div>

        <template v-else-if="result">
          <p v-if="result.missing.length" class="wp-tr__missing" data-test="missing">
            Skipped {{ result.missing.length }} item{{ result.missing.length === 1 ? "" : "s" }} no longer in the library.
          </p>
          <div class="wp-tr__stats" data-test="run-stats" data-ai-anchor="run-stats" data-ai-label="Run summary: runs, seeds, failures">
            <div><span>Runs</span><strong>{{ result.runs }}</strong><em>{{ seedLabel(wb.ranSeeds.value ?? draft.seeds) }}</em></div>
            <div><span>Unique outputs</span><strong>{{ uniqueOutputs ?? "none" }}</strong><em>{{ wb.outputVar.value ? `of $${wb.outputVar.value}` : "no output variable" }}</em></div>
            <div><span>Warnings</span><strong :data-warn="warningCount + result.failed ? 'true' : 'false'">{{ warningCount + result.failed }}</strong><em>{{ result.failed ? `${result.failed} runs failed` : result.warnings.length ? `${result.warnings.length} kinds` : "none reported" }}</em></div>
            <div><span>Engine time</span><strong>{{ result.elapsed_ms < 1000 ? `${Math.round(result.elapsed_ms)} ms` : `${(result.elapsed_ms / 1000).toFixed(2)} s` }}</strong><em>real engine, seeded</em></div>
          </div>

          <AiRunBar v-if="ai.ready.value" :result="result" />
          <section class="wp-tr__results" aria-label="Results">
            <WpTabs
              v-model="tab"
              class="wp-tr__tabs"
              :tabs="TABS"
              aria-label="Results"
              test-prefix="tab"
              data-ai-anchor="result-tabs"
              data-ai-label="Result tabs: variables, outputs, samples, warnings, compare"
            >
              <template #panel>
                <div class="wp-tr__pane">
                  <VariablesPanel v-if="tab === 'variables'" :result="result" :views="wb.stackViews.value" :output-var="wb.outputVar.value" />
                  <OutputsPanel
                    v-else-if="tab === 'outputs'"
                    :result="result"
                    :views="wb.stackViews.value"
                    :output-var="wb.outputVar.value"
                    @open="openTrace"
                    @update:output-var="(v) => (draft.output_var = v)"
                  />
                  <SamplesPanel v-else-if="tab === 'samples'" :result="result" :views="wb.stackViews.value" :output-var="wb.outputVar.value" :selected-seed="traceSeed" @open="openTrace" />
                  <WarningsPanel v-else-if="tab === 'warnings'" :result="result" :uuid-to-name="uuidToName" @open="openTrace" />
                  <ComparePanel
                    v-else
                    :result="result"
                    :baseline="wb.baseline.value"
                    :diff="wb.diff.value"
                    :saved="!!draft.id && !wb.dirty.value"
                    :running="wb.running.value"
                    @set-baseline="wb.setBaseline"
                    @clear-baseline="wb.clearBaseline"
                    @run-baseline-seeds="wb.runBaselineSeeds"
                    @open="openTrace"
                  />
                </div>
              </template>
            </WpTabs>
          </section>
        </template>

        <div v-else class="wp-tr__start" data-test="run-hint">
          <strong>{{ wb.running.value ? "Running…" : "Ready to run." }}</strong>
          <span>Press Run (Ctrl + Enter) to send {{ seedLabel(draft.seeds) }} through the engine.</span>
        </div>
      </div>
    </main>

    <TraceDrawer :sample="traceSample" @close="traceSeed = null" />
    <InspectorDrawer
      :view="inspectView"
      :index="inspectIndex"
      :data="inspectData"
      :has-run="inspectHasRun"
      @close="inspectIndex = null"
      @edit="editInspected"
    />

    <ConfirmModal
      :open="delConfirm.visible.value"
      :title="deleteTitle"
      body="The scenario and its saved run are removed. The modules it uses stay in your library."
      confirm-label="Delete"
      tone="danger"
      @confirm="delConfirm.confirm(performDelete)"
      @cancel="delConfirm.cancel"
    />
    <ConfirmModal
      :open="pendingLeave !== null"
      title="Discard unsaved changes?"
      body="This scenario has changes that are not saved. Leaving it drops them."
      confirm-label="Discard"
      tone="danger"
      @confirm="confirmLeave"
      @cancel="pendingLeave = null"
    />
  </div>
</template>

<style scoped>
.wp-tr {
  display: grid; grid-template-columns: 260px minmax(0, 1fr);
  height: 100%; min-height: 0;
}
.wp-tr__main { min-width: 0; overflow: auto; display: flex; flex-direction: column; }
.wp-tr__bar {
  position: sticky; top: 0; z-index: 20;
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--wp-space-5);
  padding: var(--wp-space-4) var(--wp-space-7);
  background: color-mix(in oklab, var(--wp-bg) 92%, transparent); backdrop-filter: blur(6px);
  border-bottom: 1px solid var(--wp-border);
}
.wp-tr__title { min-width: 0; }
.wp-tr__title h1 { margin: 0; font-size: var(--wp-text-lg); font-weight: var(--wp-weight-semibold); }
.wp-tr__name {
  background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: text;
  display: inline-flex; align-items: center; gap: var(--wp-space-3);
}
.wp-tr__pen { color: var(--wp-text-dim); opacity: 0; transition: opacity .12s; }
.wp-tr__name:hover .wp-tr__pen, .wp-tr__name:focus-visible .wp-tr__pen { opacity: 1; }
.wp-tr__name:focus-visible { outline: 2px solid var(--wp-border-focus); }
.wp-tr__name-input {
  font-size: var(--wp-text-lg); font-weight: var(--wp-weight-semibold); color: var(--wp-text);
  background: var(--wp-bg-2); border: 1px solid var(--wp-border-focus); border-radius: var(--wp-radius-sm);
  padding: 0 var(--wp-space-3);
}
.wp-tr__sub { margin: var(--wp-space-1) 0 0; font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-tr__sub code { color: var(--wp-accent-text); }
.wp-tr__dirty { color: var(--wp-warn); }
.wp-tr__sp { flex: 1; }
.wp-tr__content { padding: var(--wp-space-6) var(--wp-space-7) var(--wp-space-8); display: flex; flex-direction: column; gap: var(--wp-space-6); }
.wp-tr__start {
  display: flex; flex-direction: column; gap: var(--wp-space-3); align-items: flex-start;
  padding: var(--wp-space-7); border: 1px dashed var(--wp-border-strong); border-radius: var(--wp-radius);
  color: var(--wp-text-muted); font-size: var(--wp-text-sm); max-width: 72ch;
}
.wp-tr__start strong { color: var(--wp-text); font-size: var(--wp-text-md); }
.wp-tr__missing { margin: 0; font-size: var(--wp-text-sm); color: var(--wp-warn); }
.wp-tr__stats {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1px; background: var(--wp-border); border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius); overflow: hidden;
}
.wp-tr__stats > div { background: var(--wp-bg-2); padding: var(--wp-space-5) var(--wp-space-6); display: flex; flex-direction: column; }
.wp-tr__stats span {
  font-size: var(--wp-text-xs); font-weight: var(--wp-weight-semibold);
  letter-spacing: .08em; text-transform: uppercase; color: var(--wp-text-dim);
}
.wp-tr__stats strong { font-size: var(--wp-text-xl); line-height: var(--wp-line-xl); font-variant-numeric: tabular-nums; }
.wp-tr__stats strong[data-warn="true"] { color: var(--wp-warn); }
.wp-tr__stats em { font-style: normal; font-size: var(--wp-text-xs); color: var(--wp-text-muted); }
.wp-tr__results { background: var(--wp-bg-2); border: 1px solid var(--wp-border); border-radius: var(--wp-radius); }
/* The tab row lines up with the pane's padding. */
.wp-tr__tabs :deep(.wp-tabset__list) { padding: 0 var(--wp-space-5); }
.wp-tr__pane { padding: var(--wp-space-6); }
/* Page area narrower than 700px (usePageWidth; the chat can take the rest). */
.wp-content[data-lt~="700"] .wp-tr { grid-template-columns: 1fr; height: auto; }
.wp-content[data-lt~="700"] .wp-tr__main { overflow: visible; }
</style>
