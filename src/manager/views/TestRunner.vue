<script setup lang="ts">
/**
 * Test Runner — kind-aware module dry-run.
 *
 * The user picks a module kind, then a module of that kind, then runs N
 * samples through the in-browser resolver (`utils/resolver.ts`). Each kind
 * gets a tailored result panel modelled after the React prototype at
 * `docs/design-handoff/wildcardpipeline/project/screens/utilities.jsx`
 * (`TestRunnerScreen` → `TR*Results`).
 *
 * Resolution runs client-side so the page can show step-by-step traces,
 * before/after deltas, and weighted-matrix previews without round-tripping
 * to the backend on every sample. The backend `/wp/api/test` endpoint is
 * still used for plain wildcard histograms (see `runWildcardHistogram`).
 */
import { computed, onMounted, ref, watch } from "vue";
import Button from "primevue/button";
import Card from "primevue/card";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import { useToast } from "primevue/usetoast";
import { api } from "../api/client";
import RichTextPreview from "../components/RichTextPreview.vue";
import {
  applyConstraint,
  evalDerivation,
  expandInlineChoices,
  expandRefs,
  fillTemplate,
  pickWeightedOption,
  resolveWildcard,
  runStep,
  wildcardVar,
} from "../utils/resolver";
import { toIdentifier } from "../utils/slug";
import type {
  CombinePayload,
  ConstraintPayload,
  DerivationPayload,
  DerivationRule,
  ModuleRow,
  ModuleType,
  PipelinePayload,
  WildcardOption,
  WildcardPayload,
} from "../api/types";

const toast = useToast();

/* -------------------------- kind metadata -------------------------- */

interface KindOption { value: ModuleType; label: string; icon: string; color: string }
const KINDS: KindOption[] = [
  { value: "pipeline",     label: "Pipeline",   icon: "pi pi-list",       color: "var(--wp-kind-pipeline)" },
  { value: "wildcard",     label: "Wildcard",   icon: "pi pi-th-large",   color: "var(--wp-kind-wildcard)" },
  { value: "combine",      label: "Combine",    icon: "pi pi-share-alt",  color: "var(--wp-kind-combine)" },
  { value: "constraint",   label: "Constraint", icon: "pi pi-sitemap",    color: "var(--wp-kind-constraint)" },
  { value: "derivation",   label: "Derivation", icon: "pi pi-code",       color: "var(--wp-kind-derivation)" },
  { value: "fixed_values", label: "Fixed",      icon: "pi pi-tag",        color: "var(--wp-kind-fixed)" },
];

const KIND_HINT: Record<ModuleType, string> = {
  pipeline:     "Runs the pipeline top-to-bottom for N samples and traces every step.",
  wildcard:     "Resolves the wildcard N times, expanding {a|b|c} choices and @refs.",
  combine:      "Fills the template against upstream wildcards for N samples.",
  constraint:   "Computes the adjusted weight matrix per source value (deterministic).",
  derivation:   "Runs each rule for N samples and reports per-rule fire rate.",
  fixed_values: "Resolves 1 sample showing all $var = value bindings.",
};

const KIND_DEFAULT_SAMPLES: Record<ModuleType, number> = {
  pipeline: 25, wildcard: 100, combine: 100,
  constraint: 1, derivation: 100, fixed_values: 1,
};

/* ------------------------------ state ------------------------------ */

const kind = ref<ModuleType>("wildcard");
const moduleId = ref<string | null>(null);
const samples = ref<number>(KIND_DEFAULT_SAMPLES.wildcard);
const running = ref(false);
const allModules = ref<ModuleRow[]>([]);

interface WildcardEntry { template: string; count: number; pct: number; resolved: string[] }
interface WildcardResult { type: "wildcard"; samples: number; entries: WildcardEntry[]; hasInline: boolean; hasRefs: boolean }
interface FixedResult { type: "fixed_values"; bindings: { name: string; value: string }[] }
interface CombineResult { type: "combine"; samples: number; rendered: string[]; distribution: { value: string; count: number; pct: number }[] }
interface DerivationSampleTrace { ruleId: string; fired: "branch" | "else" | "skip"; branchIndex: number | null; delta: Record<string, string> }
interface DerivationResult { type: "derivation"; samples: number; rules: DerivationRule[]; perSample: { trace: DerivationSampleTrace[]; before: Record<string, string>; after: Record<string, string> }[]; fireCounts: Record<string, { branch: number; else: number; skip: number }> }
interface ConstraintRow { value: string; before: number; after: { source: string; weight: number; mode: "allow"|"exclude"|"boost"|"reduce" }[] }
interface ConstraintResult { type: "constraint"; targetName: string; sourceName: string; sourceValues: string[]; rows: ConstraintRow[] }
interface PipelineRunTrace { steps: { kind: string; name: string; note: string }[]; ctx: Record<string, string>; primary: string }
interface PipelineResult { type: "pipeline"; samples: number; runs: PipelineRunTrace[]; finalCounts: { value: string; count: number; pct: number }[] }
type RunResult = WildcardResult | FixedResult | CombineResult | DerivationResult | ConstraintResult | PipelineResult;

const result = ref<RunResult | null>(null);
const traceIndex = ref(0);

/* ------------------------- derived helpers ------------------------- */

const filteredModules = computed(() =>
  allModules.value.filter((m) => m.type === kind.value),
);

const selectedModule = computed(() =>
  allModules.value.find((m) => m.id === moduleId.value) ?? null,
);

const wildcards = computed(() => allModules.value.filter((m) => m.type === "wildcard"));

watch(kind, (k) => {
  result.value = null;
  traceIndex.value = 0;
  // Auto-pick first module of the new kind, plus reset samples to kind default.
  const first = allModules.value.find((m) => m.type === k);
  moduleId.value = first?.id ?? null;
  samples.value = KIND_DEFAULT_SAMPLES[k];
});

watch(moduleId, () => {
  result.value = null;
  traceIndex.value = 0;
});

/* ----------------------------- mount ------------------------------ */

onMounted(async () => {
  try {
    const res = await api.modules.list({});
    allModules.value = res.items;
    // Auto-select first wildcard so the page is immediately usable.
    const first = allModules.value.find((m) => m.type === kind.value);
    if (first) moduleId.value = first.id;
  } catch (e) {
    toast.add({ severity: "error", summary: "Failed to load modules", detail: String(e), life: 3000 });
  }
});

/* --------------------------- run logic ----------------------------- */

function runWildcardHistogram(mod: ModuleRow, n: number): WildcardResult {
  const payload = mod.payload as Partial<WildcardPayload>;
  const options = payload.options ?? [];
  const counts = new Map<string, number>();
  const samplesByTpl = new Map<string, string[]>();
  const wcs = wildcards.value;
  for (let i = 0; i < n; i++) {
    const picked = pickWeightedOption(options);
    if (!picked) continue;
    const tpl = picked.value || "(empty)";
    counts.set(tpl, (counts.get(tpl) ?? 0) + 1);
    const inlined = expandInlineChoices(picked.value || "");
    const expanded = expandRefs(inlined, {}, wcs);
    if (expanded !== picked.value) {
      const list = samplesByTpl.get(tpl) ?? [];
      if (list.length < 3 && !list.includes(expanded)) list.push(expanded);
      samplesByTpl.set(tpl, list);
    }
  }
  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0) || 1;
  const entries: WildcardEntry[] = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([template, count]) => ({
      template,
      count,
      pct: count / total * 100,
      resolved: samplesByTpl.get(template) ?? [],
    }));
  const hasInline = options.some((o: WildcardOption) => /\{[^{}]*\|[^{}]*\}/.test(o.value || ""));
  const hasRefs = options.some((o: WildcardOption) => /(^|[^@])@([a-zA-Z_])/.test(o.value || ""));
  return { type: "wildcard", samples: n, entries, hasInline, hasRefs };
}

function runFixed(mod: ModuleRow): FixedResult {
  const payload = mod.payload as { values?: { var?: string; name?: string; value?: string }[] };
  const bindings = (payload.values ?? []).map((v) => ({
    name: (v.var || v.name || "").replace(/^\$/, ""),
    value: (v.value ?? "").toString(),
  })).filter((b) => b.name);
  return { type: "fixed_values", bindings };
}

function runCombine(mod: ModuleRow, n: number): CombineResult {
  const payload = mod.payload as Partial<CombinePayload>;
  const tpl = payload.template ?? "";
  const wcs = wildcards.value;
  const rendered: string[] = [];
  const counts = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const ctx: Record<string, string> = {};
    const filled = fillTemplate(tpl, ctx, wcs);
    if (rendered.length < 6) rendered.push(filled);
    counts.set(filled, (counts.get(filled) ?? 0) + 1);
  }
  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0) || 1;
  const distribution = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([value, count]) => ({ value, count, pct: count / total * 100 }));
  return { type: "combine", samples: n, rendered, distribution };
}

function seedDerivationCtx(payload: DerivationPayload): Record<string, string> {
  // Resolve the variables each rule references against the wildcard catalog.
  const ctx: Record<string, string> = { subject: "portrait of a person", scene: "outdoor", negative: "" };
  const wcs = wildcards.value;
  const byVar = new Map<string, ModuleRow>();
  for (const w of wcs) byVar.set(wildcardVar(w), w);
  for (const rule of payload.rules ?? []) {
    for (const br of rule.branches ?? []) {
      const name = br.condition?.var;
      if (!name) continue;
      if (ctx[name] === undefined) {
        const w = byVar.get(name);
        ctx[name] = w ? resolveWildcard(w, ctx, wcs) : "";
      }
    }
  }
  return ctx;
}

function runDerivation(mod: ModuleRow, n: number): DerivationResult {
  const payload = mod.payload as unknown as DerivationPayload;
  const rules = payload.rules ?? [];
  const perSample: DerivationResult["perSample"] = [];
  const fireCounts: Record<string, { branch: number; else: number; skip: number }> = {};
  for (const r of rules) fireCounts[r.id] = { branch: 0, else: 0, skip: 0 };
  for (let i = 0; i < n; i++) {
    const ctx = seedDerivationCtx(payload);
    const before = { ...ctx };
    const trace = evalDerivation(payload, ctx);
    const sample: DerivationSampleTrace[] = trace.map((t) => ({
      ruleId: t.rule.id,
      fired: t.fired,
      branchIndex: t.branchIndex,
      delta: t.delta,
    }));
    for (const t of sample) {
      const c = fireCounts[t.ruleId];
      if (!c) continue;
      c[t.fired] += 1;
    }
    perSample.push({ trace: sample, before, after: { ...ctx } });
  }
  return { type: "derivation", samples: n, rules, perSample, fireCounts };
}

function runConstraintMatrix(mod: ModuleRow): ConstraintResult {
  const payload = mod.payload as unknown as ConstraintPayload;
  const target = allModules.value.find((m) => m.id === payload.target_wildcard_id);
  const source = allModules.value.find((m) => m.id === payload.source_wildcard_id);
  const targetName = target?.name ?? "(missing target)";
  const sourceName = source?.name ?? "(missing source)";
  if (!target || !source) {
    return { type: "constraint", targetName, sourceName, sourceValues: [], rows: [] };
  }
  const targetPayload = target.payload as Partial<WildcardPayload>;
  const sourcePayload = source.payload as Partial<WildcardPayload>;
  const sourceValues = (sourcePayload.options ?? []).map((o) => o.value);
  const wcs = wildcards.value;
  const rows: ConstraintRow[] = (targetPayload.options ?? []).map((opt) => {
    const after = sourceValues.map((sv) => {
      const adjusted = applyConstraint(payload, sv, wcs);
      const matched = adjusted.find((a) => a.value === opt.value);
      return {
        source: sv,
        weight: matched?.weight ?? 0,
        mode: matched?._mode ?? "allow",
      };
    });
    return { value: opt.value, before: Number(opt.weight) || 0, after };
  });
  return { type: "constraint", targetName, sourceName, sourceValues, rows };
}

function runPipeline(mod: ModuleRow, n: number): PipelineResult {
  const payload = mod.payload as unknown as PipelinePayload;
  const runs: PipelineRunTrace[] = [];
  const finalCounts = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const ctx: Record<string, string> = {};
    const stepTrace: PipelineRunTrace["steps"] = [];
    for (const step of payload.steps ?? []) {
      const trace = runStep(step, allModules.value, ctx);
      stepTrace.push({ kind: trace.kind, name: trace.name, note: trace.note });
    }
    // Pick primary output: last combine's output_var if any, else longest value.
    let primary = "";
    for (let s = (payload.steps ?? []).length - 1; s >= 0; s--) {
      const stp = payload.steps[s];
      const m = allModules.value.find((x) => x.id === stp.module_id);
      if (m && m.type === "combine") {
        const out = ((m.payload as Partial<CombinePayload>).output_var ?? "").replace(/^\$/, "");
        if (out && ctx[out] !== undefined) { primary = ctx[out]; break; }
      }
    }
    if (!primary) {
      primary = Object.values(ctx).reduce(
        (a, b) => (String(b).length > String(a).length ? b : a),
        "",
      );
    }
    finalCounts.set(primary || "(empty)", (finalCounts.get(primary || "(empty)") ?? 0) + 1);
    runs.push({ steps: stepTrace, ctx: { ...ctx }, primary });
  }
  const total = Array.from(finalCounts.values()).reduce((a, b) => a + b, 0) || 1;
  const sorted = Array.from(finalCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([value, count]) => ({ value, count, pct: count / total * 100 }));
  return { type: "pipeline", samples: n, runs, finalCounts: sorted };
}

async function run() {
  const mod = selectedModule.value;
  if (!mod) return;
  running.value = true;
  result.value = null;
  traceIndex.value = 0;
  // Defer to next tick so the loading state paints before heavy work.
  await new Promise((r) => setTimeout(r, 0));
  try {
    const n = Math.max(1, samples.value || 1);
    if (mod.type === "wildcard")          result.value = runWildcardHistogram(mod, n);
    else if (mod.type === "fixed_values") result.value = runFixed(mod);
    else if (mod.type === "combine")      result.value = runCombine(mod, n);
    else if (mod.type === "constraint")   result.value = runConstraintMatrix(mod);
    else if (mod.type === "derivation")   result.value = runDerivation(mod, n);
    else if (mod.type === "pipeline")     result.value = runPipeline(mod, n);
  } catch (e) {
    toast.add({ severity: "error", summary: "Run failed", detail: String(e), life: 4000 });
  } finally {
    running.value = false;
  }
}

/* ------------------------ render-time helpers ---------------------- */

const usesSamples = computed(
  () => kind.value !== "fixed_values" && kind.value !== "constraint",
);

const subtitle = computed(() => KIND_HINT[kind.value]);

const selectedKindMeta = computed(() => KINDS.find((k) => k.value === kind.value) ?? KINDS[0]);

function modeColor(mode: "allow" | "exclude" | "boost" | "reduce"): string {
  if (mode === "boost")   return "var(--wp-success, #34d399)";
  if (mode === "reduce")  return "var(--wp-warn, #fbbf24)";
  if (mode === "exclude") return "var(--wp-danger, #f87171)";
  return "var(--wp-text)";
}

const sampleCursor = computed(() => {
  const r = result.value;
  if (!r) return null;
  if (r.type === "pipeline")  return { count: r.runs.length };
  if (r.type === "derivation") return { count: r.perSample.length };
  return null;
});

function nextSample() {
  const c = sampleCursor.value;
  if (!c) return;
  traceIndex.value = Math.min(c.count - 1, traceIndex.value + 1);
}
function prevSample() {
  if (!sampleCursor.value) return;
  traceIndex.value = Math.max(0, traceIndex.value - 1);
}

const wildcardVarPreview = computed(() => {
  const mod = selectedModule.value;
  if (!mod || mod.type !== "wildcard") return null;
  const payload = mod.payload as Partial<WildcardPayload>;
  return (payload.var_binding ?? "").trim() || toIdentifier(mod.name);
});
</script>

<template>
  <div class="p-6 text-wp-text max-w-4xl">
    <h1 class="text-xl font-semibold m-0">Test runner</h1>
    <p class="text-sm text-wp-text2 m-0 mt-1 mb-4">
      Resolve any module against the engine and inspect its output. Pipelines run end-to-end with a per-step trace.
    </p>

    <Card>
      <template #content>
        <div class="tr-config">
          <div class="tr-row">
            <label class="tr-label">Module kind</label>
            <SelectButton
              v-model="kind"
              :options="KINDS"
              option-label="label"
              option-value="value"
              data-test="kind-selector"
              aria-label="Module kind"
              :allow-empty="false"
            >
              <template #option="slotProps">
                <span class="tr-kind-opt">
                  <i :class="slotProps.option.icon" class="text-xs" aria-hidden="true" />
                  <span>{{ slotProps.option.label }}</span>
                </span>
              </template>
            </SelectButton>
          </div>

          <div class="tr-row tr-row--inputs">
            <div class="tr-input tr-input--module">
              <label for="tr-module" class="tr-label">Module</label>
              <Select
                id="tr-module"
                v-model="moduleId"
                :options="filteredModules"
                option-label="name"
                option-value="id"
                placeholder="Select a module…"
                filter
                class="w-full"
                data-test="module-select"
              />
            </div>
            <div v-if="usesSamples" class="tr-input tr-input--samples">
              <label for="tr-samples" class="tr-label">Samples</label>
              <InputNumber id="tr-samples" v-model="samples" :min="1" :max="10000" class="w-full" />
            </div>
            <div class="tr-input tr-input--run">
              <Button
                label="Run"
                icon="pi pi-bolt"
                severity="primary"
                :loading="running"
                :disabled="!moduleId || running"
                data-test="run-btn"
                @click="run"
              />
            </div>
          </div>

          <div class="tr-hint" data-test="kind-hint">
            <i :class="selectedKindMeta.icon" class="text-xs" aria-hidden="true" :style="{ color: selectedKindMeta.color }" />
            <span>{{ subtitle }}</span>
            <span v-if="kind === 'wildcard' && wildcardVarPreview" class="tr-hint__var">
              · resolves into <code>${{ wildcardVarPreview }}</code>
            </span>
          </div>
        </div>
      </template>
    </Card>

    <!-- Wildcard panel -->
    <div v-if="result?.type === 'wildcard'" class="mt-4" data-test="result-wildcard">
      <Card>
        <template #title>
          <div class="tr-card-title">
            <span>Histogram — {{ result.samples }} samples</span>
          </div>
        </template>
        <template #content>
          <div v-if="result.hasInline || result.hasRefs" class="tr-flags">
            <span>Bins by template;</span>
            <span v-if="result.hasInline" class="tr-flag-chip"><code>{a|b|c}</code> expanded</span>
            <span v-if="result.hasRefs" class="tr-flag-chip">@refs resolved</span>
          </div>
          <div class="tr-hist">
            <div v-for="entry in result.entries" :key="entry.template" class="tr-hist-row">
              <div class="tr-hist-template">
                <RichTextPreview :value="entry.template" />
                <div v-if="entry.resolved.length" class="tr-hist-resolved">
                  <div v-for="(s, j) in entry.resolved" :key="j" class="tr-hist-resolved-line">↳ {{ s }}</div>
                </div>
              </div>
              <div class="tr-hist-bar">
                <div class="tr-hist-bar-fill" :style="{ width: entry.pct + '%' }" />
              </div>
              <div class="tr-hist-count">{{ entry.count }}</div>
            </div>
          </div>
        </template>
      </Card>
    </div>

    <!-- Fixed panel -->
    <div v-else-if="result?.type === 'fixed_values'" class="mt-4" data-test="result-fixed">
      <Card>
        <template #title>Resolved bindings</template>
        <template #content>
          <p class="text-xs text-wp-text2 m-0 mb-3">
            Fixed values are deterministic — every run emits the same {{ result.bindings.length }} binding(s).
          </p>
          <div class="tr-fixed-grid">
            <template v-for="b in result.bindings" :key="b.name">
              <code class="tr-var">${{ b.name }}</code>
              <span class="tr-mono">{{ b.value }}</span>
            </template>
          </div>
        </template>
      </Card>
    </div>

    <!-- Combine panel -->
    <div v-else-if="result?.type === 'combine'" class="mt-4 space-y-4" data-test="result-combine">
      <Card>
        <template #title>Sample renderings</template>
        <template #content>
          <div class="tr-combine-list">
            <div v-for="(s, i) in result.rendered" :key="i" class="tr-combine-row">
              <RichTextPreview :value="s" />
            </div>
          </div>
        </template>
      </Card>
      <Card>
        <template #title>
          Distribution — {{ result.samples }} samples · {{ result.distribution.length }} unique
        </template>
        <template #content>
          <div class="tr-hist">
            <div v-for="entry in result.distribution" :key="entry.value" class="tr-hist-row">
              <div class="tr-hist-template tr-mono tr-truncate">{{ entry.value }}</div>
              <div class="tr-hist-bar"><div class="tr-hist-bar-fill" :style="{ width: entry.pct + '%' }" /></div>
              <div class="tr-hist-count">{{ entry.count }}</div>
            </div>
          </div>
        </template>
      </Card>
    </div>

    <!-- Constraint panel -->
    <div v-else-if="result?.type === 'constraint'" class="mt-4" data-test="result-constraint">
      <Card>
        <template #title>Effective weights — before vs after</template>
        <template #content>
          <p class="text-xs text-wp-text2 m-0 mb-3">
            Each column shows resolved weights of <strong>{{ result.targetName }}</strong>
            conditioned on a value of <strong>{{ result.sourceName }}</strong>.
          </p>
          <div v-if="result.rows.length" class="tr-cn-scroll">
            <table class="tr-cn-table">
              <thead>
                <tr>
                  <th class="text-left">{{ result.targetName }}</th>
                  <th class="text-right">w</th>
                  <th v-for="sv in result.sourceValues" :key="sv" class="text-right tr-truncate">{{ sv }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in result.rows" :key="row.value">
                  <td class="tr-mono">{{ row.value }}</td>
                  <td class="tr-mono text-right text-wp-text2">{{ row.before }}</td>
                  <td
                    v-for="cell in row.after" :key="cell.source"
                    class="tr-mono text-right"
                    :style="{ color: modeColor(cell.mode), opacity: cell.mode === 'exclude' ? 0.55 : 1 }"
                  >{{ cell.weight === 0 ? "—" : (Number.isInteger(cell.weight) ? cell.weight : cell.weight.toFixed(2)) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="text-xs text-wp-text2">Constraint references a wildcard that no longer exists.</div>
          <div class="tr-cn-legend">
            <span><span class="tr-dot" style="color: var(--wp-success, #34d399)">●</span> boost</span>
            <span><span class="tr-dot">●</span> allow</span>
            <span><span class="tr-dot" style="color: var(--wp-warn, #fbbf24)">●</span> reduce</span>
            <span><span class="tr-dot" style="color: var(--wp-danger, #f87171)">●</span> exclude</span>
          </div>
        </template>
      </Card>
    </div>

    <!-- Derivation panel -->
    <div v-else-if="result?.type === 'derivation'" class="mt-4 space-y-4" data-test="result-derivation">
      <Card>
        <template #title>
          <div class="tr-card-title-row">
            <span>Rule trace — sample {{ traceIndex + 1 }} of {{ result.perSample.length }}</span>
            <div class="tr-trace-nav">
              <Button size="small" severity="secondary" outlined icon="pi pi-chevron-left" :disabled="traceIndex <= 0" @click="prevSample" />
              <Button size="small" severity="secondary" outlined icon="pi pi-chevron-right" :disabled="traceIndex >= result.perSample.length - 1" @click="nextSample" />
            </div>
          </div>
        </template>
        <template #content>
          <div class="tr-rule-trace">
            <div v-for="(t, i) in result.perSample[traceIndex].trace" :key="i" class="tr-rule-row">
              <span class="tr-rule-id">rule {{ String(i + 1).padStart(2, '0') }} <code class="text-wp-text3">{{ t.ruleId }}</code></span>
              <span class="tr-rule-status" :data-status="t.fired">{{ t.fired === 'skip' ? 'skipped' : t.fired === 'else' ? 'else fired' : `branch ${ (t.branchIndex ?? 0) + 1 } fired` }}</span>
              <div class="tr-rule-delta">
                <template v-for="(v, k) in t.delta" :key="k">
                  <code>${{ k }} = "{{ v }}"</code>
                </template>
                <span v-if="!Object.keys(t.delta).length" class="text-wp-text3">(no change)</span>
              </div>
            </div>
          </div>
        </template>
      </Card>
      <Card>
        <template #title>Per-rule fire rate — {{ result.samples }} samples</template>
        <template #content>
          <div class="tr-hist">
            <div v-for="rule in result.rules" :key="rule.id" class="tr-hist-row">
              <div class="tr-hist-template">
                <code>{{ rule.id }}</code>
                <div class="text-wp-text3 text-xs">
                  branch {{ result.fireCounts[rule.id]?.branch ?? 0 }} · else {{ result.fireCounts[rule.id]?.else ?? 0 }} · skip {{ result.fireCounts[rule.id]?.skip ?? 0 }}
                </div>
              </div>
              <div class="tr-hist-bar">
                <div
                  class="tr-hist-bar-fill"
                  :style="{ width: ((((result.fireCounts[rule.id]?.branch ?? 0) + (result.fireCounts[rule.id]?.else ?? 0)) / Math.max(1, result.samples)) * 100) + '%' }"
                />
              </div>
              <div class="tr-hist-count">
                {{ Math.round(((((result.fireCounts[rule.id]?.branch ?? 0) + (result.fireCounts[rule.id]?.else ?? 0)) / Math.max(1, result.samples)) * 100)) }}%
              </div>
            </div>
          </div>
        </template>
      </Card>
    </div>

    <!-- Pipeline panel -->
    <div v-else-if="result?.type === 'pipeline'" class="mt-4 space-y-4" data-test="result-pipeline">
      <Card>
        <template #title>
          <div class="tr-card-title-row">
            <span>Pipeline trace — sample {{ traceIndex + 1 }} of {{ result.runs.length }}</span>
            <div class="tr-trace-nav">
              <Button size="small" severity="secondary" outlined icon="pi pi-chevron-left" :disabled="traceIndex <= 0" @click="prevSample" />
              <Button size="small" severity="secondary" outlined icon="pi pi-chevron-right" :disabled="traceIndex >= result.runs.length - 1" @click="nextSample" />
            </div>
          </div>
        </template>
        <template #content>
          <div class="tr-step-trace">
            <div v-for="(s, i) in result.runs[traceIndex].steps" :key="i" class="tr-step-row" :data-kind="s.kind">
              <span class="tr-step-idx">{{ String(i + 1).padStart(2, '0') }}</span>
              <span class="tr-step-kind">{{ s.kind }}</span>
              <span class="tr-step-name">{{ s.name }}</span>
              <span class="tr-step-note">{{ s.note }}</span>
            </div>
          </div>
        </template>
      </Card>
      <Card>
        <template #title>Resolved context (final)</template>
        <template #content>
          <div class="tr-fixed-grid">
            <template v-for="(v, k) in result.runs[traceIndex].ctx" :key="k">
              <code class="tr-var">${{ k }}</code>
              <span class="tr-mono tr-truncate">{{ v }}</span>
            </template>
          </div>
        </template>
      </Card>
      <Card>
        <template #title>
          Output distribution — {{ result.samples }} run(s) · {{ result.finalCounts.length }} unique
        </template>
        <template #content>
          <div class="tr-hist">
            <div v-for="entry in result.finalCounts" :key="entry.value" class="tr-hist-row">
              <div class="tr-hist-template tr-mono tr-truncate">{{ entry.value || '(empty)' }}</div>
              <div class="tr-hist-bar"><div class="tr-hist-bar-fill" :style="{ width: entry.pct + '%' }" /></div>
              <div class="tr-hist-count">{{ entry.count }}</div>
            </div>
          </div>
        </template>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.tr-config { display: flex; flex-direction: column; gap: 12px; }
.tr-row { display: flex; flex-direction: column; gap: 6px; }
.tr-row--inputs {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) 140px auto;
  gap: 12px;
  align-items: end;
}
.tr-row--inputs .tr-input--run { align-self: end; }
.tr-label {
  font-size: 11px; text-transform: uppercase;
  letter-spacing: 0.5px; color: var(--wp-text2);
}
.tr-kind-opt { display: inline-flex; align-items: center; gap: 6px; }
.tr-hint {
  font-size: 11.5px; color: var(--wp-text2);
  display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin-top: 4px;
}
.tr-hint__var code {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  color: var(--wp-accent-text, #c4b5fd);
}

.tr-card-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.tr-card-title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.tr-trace-nav { display: flex; gap: 4px; }

.tr-flags {
  font-size: 11.5px; color: var(--wp-text2);
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-bottom: 10px;
}
.tr-flag-chip {
  padding: 1px 6px; border-radius: 4px;
  background: var(--wp-bg2);
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 11px;
}

.tr-hist { display: flex; flex-direction: column; gap: 6px; }
.tr-hist-row {
  display: grid;
  grid-template-columns: minmax(180px, 280px) 1fr 50px;
  gap: 10px;
  align-items: center;
}
.tr-hist-template { min-width: 0; font-size: 12px; }
.tr-hist-resolved { margin-top: 2px; font-size: 11px; color: var(--wp-text3); line-height: 1.45; }
.tr-hist-resolved-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tr-hist-bar {
  height: 14px;
  background: var(--wp-bg3);
  border-radius: 5px;
  overflow: hidden;
}
.tr-hist-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--wp-accent-500, #8b5cf6), color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 60%, white));
  border-radius: 5px;
  transition: width .25s;
}
.tr-hist-count {
  text-align: right;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 12px;
  color: var(--wp-text2);
}

.tr-fixed-grid {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 6px 14px;
  font-size: 12.5px;
  align-items: center;
}
.tr-var {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  color: var(--wp-accent-text, #c4b5fd);
  font-size: 12px;
}
.tr-mono {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 12px;
  min-width: 0;
}
.tr-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.tr-combine-list { display: flex; flex-direction: column; gap: 6px; }
.tr-combine-row {
  padding: 8px 10px;
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: 6px;
}

.tr-cn-scroll { overflow-x: auto; }
.tr-cn-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.tr-cn-table th {
  padding: 6px 8px;
  color: var(--wp-text2);
  font-weight: 500;
  border-bottom: 1px solid var(--wp-border);
  white-space: nowrap;
}
.tr-cn-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--wp-border);
}
.tr-cn-legend {
  display: flex; gap: 14px; margin-top: 12px;
  font-size: 11px; color: var(--wp-text2);
}
.tr-dot { color: var(--wp-text); }

.tr-rule-trace { display: flex; flex-direction: column; gap: 6px; }
.tr-rule-row {
  display: grid;
  grid-template-columns: 220px auto 1fr;
  gap: 10px;
  align-items: center;
  padding: 6px 10px;
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: 6px;
  font-size: 12px;
}
.tr-rule-id { font-family: var(--wp-font-mono, ui-monospace, monospace); color: var(--wp-text); }
.tr-rule-status {
  font-size: 11px; padding: 2px 8px; border-radius: 4px;
  background: var(--wp-bg3); color: var(--wp-text2);
}
.tr-rule-status[data-status="branch"] { background: color-mix(in oklab, var(--wp-kind-derivation, #fbbf24) 18%, transparent); color: var(--wp-kind-derivation, #fbbf24); }
.tr-rule-status[data-status="else"]   { background: color-mix(in oklab, var(--wp-info, #60a5fa) 18%, transparent); color: var(--wp-info, #60a5fa); }
.tr-rule-delta {
  display: flex; flex-wrap: wrap; gap: 6px;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  min-width: 0;
}
.tr-rule-delta code {
  background: var(--wp-bg3);
  padding: 1px 6px; border-radius: 4px;
}

.tr-step-trace { display: flex; flex-direction: column; gap: 4px; }
.tr-step-row {
  display: grid;
  grid-template-columns: 32px 110px 180px 1fr;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 5px;
  background: var(--wp-bg2);
  border-left: 3px solid var(--step-color, var(--wp-border));
  align-items: center;
}
.tr-step-row[data-kind="wildcard"]     { --step-color: var(--wp-kind-wildcard); }
.tr-step-row[data-kind="fixed_values"] { --step-color: var(--wp-kind-fixed); }
.tr-step-row[data-kind="combine"]      { --step-color: var(--wp-kind-combine); }
.tr-step-row[data-kind="derivation"]   { --step-color: var(--wp-kind-derivation); }
.tr-step-row[data-kind="constraint"]   { --step-color: var(--wp-kind-constraint); }
.tr-step-row[data-kind="pipeline"]     { --step-color: var(--wp-kind-pipeline); }
.tr-step-idx {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 11px; color: var(--wp-text3);
}
.tr-step-kind {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--step-color, var(--wp-text2));
}
.tr-step-name { font-size: 12.5px; color: var(--wp-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tr-step-note {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 11.5px; color: var(--wp-text2);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

@media (max-width: 720px) {
  .tr-row--inputs { grid-template-columns: 1fr; }
  .tr-rule-row { grid-template-columns: 1fr; }
  .tr-step-row { grid-template-columns: 28px 90px 1fr; }
  .tr-step-row > .tr-step-note { grid-column: 1 / -1; padding-left: 130px; }
}
</style>
