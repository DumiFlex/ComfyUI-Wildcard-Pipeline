<script setup lang="ts">
/**
 * Test Runner — kind-aware module dry-run.
 *
 * Faithful port of `TestRunnerScreen` from
 * `docs/design-handoff/wildcardpipeline/project/screens/utilities.jsx`.
 * Uses ui/* primitives only — no PrimeVue.
 */
import { computed, onMounted, ref, watch } from "vue";
import Button from "../components/ui/Button.vue";
import Card from "../components/ui/Card.vue";
import Field from "../components/ui/Field.vue";
import Icon from "../components/ui/Icon.vue";
import Input from "../components/ui/Input.vue";
import Select from "../components/ui/Select.vue";
import { useToast } from "../composables/useToast";
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
  { value: "pipeline",     label: "Pipeline",   icon: "pi-list",       color: "var(--wp-kind-pipeline)" },
  { value: "wildcard",     label: "Wildcard",   icon: "pi-th-large",   color: "var(--wp-kind-wildcard)" },
  { value: "combine",      label: "Combine",    icon: "pi-share-alt",  color: "var(--wp-kind-combine)" },
  { value: "constraint",   label: "Constraint", icon: "pi-sitemap",    color: "var(--wp-kind-constraint)" },
  { value: "derivation",   label: "Derivation", icon: "pi-code",       color: "var(--wp-kind-derivation)" },
  { value: "fixed_values", label: "Fixed",      icon: "pi-tag",        color: "var(--wp-kind-fixed)" },
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

const moduleOptions = computed(() =>
  filteredModules.value.map((m) => ({ value: m.id, label: m.name })),
);

const selectedModule = computed(() =>
  allModules.value.find((m) => m.id === moduleId.value) ?? null,
);

const wildcards = computed(() => allModules.value.filter((m) => m.type === "wildcard"));

watch(kind, (k) => {
  result.value = null;
  traceIndex.value = 0;
  const first = allModules.value.find((m) => m.type === k);
  moduleId.value = first?.id ?? null;
  samples.value = KIND_DEFAULT_SAMPLES[k];
});

watch(moduleId, () => {
  result.value = null;
  traceIndex.value = 0;
});

onMounted(async () => {
  try {
    const res = await api.modules.list({});
    allModules.value = res.items;
    const first = allModules.value.find((m) => m.type === kind.value);
    if (first) moduleId.value = first.id;
  } catch (e) {
    toast.push({ severity: "error", summary: "Failed to load modules", detail: String(e), life: 3000 });
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
  // Yield once so the loading state paints before heavy work.
  await Promise.resolve();
  try {
    const n = Math.max(1, samples.value || 1);
    if (mod.type === "wildcard")          result.value = runWildcardHistogram(mod, n);
    else if (mod.type === "fixed_values") result.value = runFixed(mod);
    else if (mod.type === "combine")      result.value = runCombine(mod, n);
    else if (mod.type === "constraint")   result.value = runConstraintMatrix(mod);
    else if (mod.type === "derivation")   result.value = runDerivation(mod, n);
    else if (mod.type === "pipeline")     result.value = runPipeline(mod, n);
  } catch (e) {
    toast.push({ severity: "error", summary: "Run failed", detail: String(e), life: 4000 });
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
  if (mode === "boost")   return "var(--wp-success)";
  if (mode === "reduce")  return "var(--wp-warn)";
  if (mode === "exclude") return "var(--wp-danger)";
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

function pickKind(k: ModuleType) {
  kind.value = k;
}
</script>

<template>
  <div class="wp-page wp-tr-page">
    <div class="wp-page__header">
      <div class="wp-page__title-wrap">
        <h1 class="wp-page__title">Test runner</h1>
        <p class="wp-page__subtitle">
          Resolve any module against the engine and inspect the output. Pipelines run end-to-end with a per-step trace.
        </p>
      </div>
    </div>

    <Card title="Configuration">
      <div class="wp-tr-config">
        <Field label="Module kind">
          <div class="wp-seg" data-test="kind-selector" role="radiogroup" aria-label="Module kind">
            <button
              v-for="k in KINDS"
              :key="k.value"
              type="button"
              class="wp-seg__btn"
              role="radio"
              :aria-checked="kind === k.value"
              :data-active="kind === k.value ? 'true' : 'false'"
              :style="kind === k.value ? {
                borderColor: k.color,
                background: `color-mix(in oklab, ${k.color} 18%, transparent)`,
                color: k.color,
              } : undefined"
              @click="pickKind(k.value)"
            >
              <Icon :name="k.icon" :size="11" /> {{ k.label }}
            </button>
          </div>
        </Field>

        <div class="wp-tr-row" :data-with-samples="usesSamples ? 'true' : 'false'">
          <Field label="Module" class="wp-tr-row__module">
            <Select
              v-model="moduleId"
              :options="moduleOptions"
              placeholder="Select a module…"
              data-test="module-select"
              aria-label="Module"
            />
          </Field>
          <Field v-if="usesSamples" label="Samples" class="wp-tr-row__samples">
            <Input
              type="number"
              :model-value="samples"
              aria-label="Samples"
              @update:model-value="(v) => samples = Number(v) || 1"
            />
          </Field>
          <div class="wp-tr-row__run">
            <Button
              variant="primary"
              icon="pi-bolt"
              :loading="running"
              :disabled="!moduleId || running"
              data-test="run-btn"
              @click="run"
            >{{ running ? "Running…" : "Run" }}</Button>
          </div>
        </div>

        <div class="wp-tr-hint" data-test="kind-hint">
          <Icon :name="selectedKindMeta.icon" :size="11" />
          <span>{{ subtitle }}</span>
          <span v-if="kind === 'wildcard' && wildcardVarPreview" class="wp-tr-hint__var">
            · resolves into <code class="wp-mono">${{ wildcardVarPreview }}</code>
          </span>
        </div>
      </div>
    </Card>

    <!-- Wildcard panel -->
    <Card
      v-if="result?.type === 'wildcard'"
      :title="`Histogram — ${result.samples} samples`"
      data-test="result-wildcard"
    >
      <template #actions>
        <Button variant="ghost" size="sm" icon="pi-refresh" @click="run">Re-run</Button>
      </template>
      <div v-if="result.hasInline || result.hasRefs" class="wp-tr-flags wp-dim">
        <span>Bins by template;</span>
        <span v-if="result.hasInline" class="wp-tr-flag-chip"><code>{a|b|c}</code> expanded</span>
        <span v-if="result.hasRefs" class="wp-tr-flag-chip">@refs resolved</span>
      </div>
      <div class="wp-hist">
        <div v-for="entry in result.entries" :key="entry.template" class="wp-hist__row">
          <div class="wp-hist__template">
            <RichTextPreview :value="entry.template" />
            <div v-if="entry.resolved.length" class="wp-hist__resolved wp-mono wp-dim">
              <div v-for="(s, j) in entry.resolved" :key="j" class="wp-hist__resolved-line">↳ {{ s }}</div>
            </div>
          </div>
          <div class="wp-bar">
            <div
              class="wp-bar__fill"
              :style="{
                width: entry.pct + '%',
                background: `linear-gradient(90deg, var(--wp-kind-wildcard), color-mix(in oklab, var(--wp-kind-wildcard) 60%, white))`,
              }"
            />
          </div>
          <div class="wp-mono wp-hist__count">{{ entry.count }}</div>
        </div>
      </div>
    </Card>

    <!-- Fixed panel -->
    <Card
      v-else-if="result?.type === 'fixed_values'"
      title="Resolved bindings"
      data-test="result-fixed"
    >
      <template #actions>
        <Button variant="ghost" size="sm" icon="pi-refresh" @click="run">Re-run</Button>
      </template>
      <p class="wp-dim wp-tr-help">
        Fixed values are deterministic — every run emits the same {{ result.bindings.length }} binding(s).
      </p>
      <div class="wp-tr-fixed-grid">
        <template v-for="b in result.bindings" :key="b.name">
          <code class="wp-tr-var wp-mono">${{ b.name }}</code>
          <span class="wp-mono">{{ b.value }}</span>
        </template>
      </div>
    </Card>

    <!-- Combine panel -->
    <template v-else-if="result?.type === 'combine'">
      <Card title="Sample renderings" data-test="result-combine">
        <template #actions>
          <Button variant="ghost" size="sm" icon="pi-refresh" @click="run">Re-run</Button>
        </template>
        <div class="wp-tr-combine-list">
          <div v-for="(s, i) in result.rendered" :key="i" class="wp-tr-combine-row">
            <RichTextPreview :value="s" />
          </div>
        </div>
      </Card>
      <Card :title="`Distribution — ${result.samples} samples · ${result.distribution.length} unique`">
        <div class="wp-hist">
          <div v-for="entry in result.distribution" :key="entry.value" class="wp-hist__row">
            <div class="wp-hist__template wp-mono wp-truncate">{{ entry.value }}</div>
            <div class="wp-bar">
              <div
                class="wp-bar__fill"
                :style="{ width: entry.pct + '%', background: 'var(--wp-kind-combine)' }"
              />
            </div>
            <div class="wp-mono wp-hist__count">{{ entry.count }}</div>
          </div>
        </div>
      </Card>
    </template>

    <!-- Constraint panel -->
    <Card
      v-else-if="result?.type === 'constraint'"
      title="Effective weights — before vs after"
      data-test="result-constraint"
    >
      <template #actions>
        <Button variant="ghost" size="sm" icon="pi-refresh" @click="run">Recompute</Button>
      </template>
      <p class="wp-dim wp-tr-help">
        Each column shows resolved weights of <strong>{{ result.targetName }}</strong>
        conditioned on a value of <strong>{{ result.sourceName }}</strong>.
      </p>
      <div v-if="result.rows.length" class="wp-tr-cn-scroll">
        <table class="wp-tr-cn-table">
          <thead>
            <tr>
              <th class="wp-tr-cn-table__lhs">{{ result.targetName }}</th>
              <th class="wp-tr-cn-table__w">w</th>
              <th
                v-for="sv in result.sourceValues"
                :key="sv"
                class="wp-tr-cn-table__sv wp-truncate"
              >{{ sv }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in result.rows" :key="row.value">
              <td class="wp-mono">{{ row.value }}</td>
              <td class="wp-mono wp-tr-cn-table__w wp-dim">{{ row.before }}</td>
              <td
                v-for="cell in row.after"
                :key="cell.source"
                class="wp-mono wp-tr-cn-table__sv"
                :style="{ color: modeColor(cell.mode), opacity: cell.mode === 'exclude' ? 0.55 : 1 }"
              >{{ cell.weight === 0 ? "—" : (Number.isInteger(cell.weight) ? cell.weight : cell.weight.toFixed(2)) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="wp-dim">Constraint references a wildcard that no longer exists.</div>
      <div class="wp-tr-cn-legend">
        <span><span class="wp-tr-dot" style="color: var(--wp-success)">●</span> boost</span>
        <span><span class="wp-tr-dot">●</span> allow</span>
        <span><span class="wp-tr-dot" style="color: var(--wp-warn)">●</span> reduce</span>
        <span><span class="wp-tr-dot" style="color: var(--wp-danger)">●</span> exclude</span>
      </div>
    </Card>

    <!-- Derivation panel -->
    <template v-else-if="result?.type === 'derivation'">
      <Card data-test="result-derivation"
        :title="`Rule trace — sample ${traceIndex + 1} of ${result.perSample.length}`">
        <template #actions>
          <Button variant="ghost" size="sm" icon="pi-chevron-left" :disabled="traceIndex <= 0" @click="prevSample" />
          <Button variant="ghost" size="sm" icon="pi-chevron-right" :disabled="traceIndex >= result.perSample.length - 1" @click="nextSample" />
          <Button variant="ghost" size="sm" icon="pi-refresh" @click="run">Re-run</Button>
        </template>
        <div class="wp-tr-rule-trace">
          <div v-for="(t, i) in result.perSample[traceIndex].trace" :key="i" class="wp-tr-rule-row">
            <span class="wp-tr-rule-id wp-mono">rule {{ String(i + 1).padStart(2, '0') }}</span>
            <span class="wp-tr-rule-status" :data-status="t.fired">
              {{ t.fired === 'skip' ? 'skipped' : t.fired === 'else' ? 'else fired' : `branch ${ (t.branchIndex ?? 0) + 1 } fired` }}
            </span>
            <div class="wp-tr-rule-delta wp-mono">
              <template v-for="(v, k) in t.delta" :key="k">
                <code>${{ k }} = "{{ v }}"</code>
              </template>
              <span v-if="!Object.keys(t.delta).length" class="wp-dim">(no change)</span>
            </div>
          </div>
        </div>
      </Card>
      <Card :title="`Per-rule fire rate — ${result.samples} samples`">
        <div class="wp-hist">
          <div v-for="rule in result.rules" :key="rule.id" class="wp-hist__row">
            <div class="wp-hist__template">
              <code class="wp-mono">{{ rule.id }}</code>
              <div class="wp-dim wp-tr-rule-fire-meta">
                branch {{ result.fireCounts[rule.id]?.branch ?? 0 }} ·
                else {{ result.fireCounts[rule.id]?.else ?? 0 }} ·
                skip {{ result.fireCounts[rule.id]?.skip ?? 0 }}
              </div>
            </div>
            <div class="wp-bar">
              <div
                class="wp-bar__fill"
                :style="{
                  width: ((((result.fireCounts[rule.id]?.branch ?? 0) + (result.fireCounts[rule.id]?.else ?? 0)) / Math.max(1, result.samples)) * 100) + '%',
                  background: 'var(--wp-kind-derivation)',
                }"
              />
            </div>
            <div class="wp-mono wp-hist__count">
              {{ Math.round(((((result.fireCounts[rule.id]?.branch ?? 0) + (result.fireCounts[rule.id]?.else ?? 0)) / Math.max(1, result.samples)) * 100)) }}%
            </div>
          </div>
        </div>
      </Card>
    </template>

    <!-- Pipeline panel -->
    <template v-else-if="result?.type === 'pipeline'">
      <Card data-test="result-pipeline"
        :title="`Pipeline trace — sample ${traceIndex + 1} of ${result.runs.length}`">
        <template #actions>
          <Button variant="ghost" size="sm" icon="pi-chevron-left" :disabled="traceIndex <= 0" @click="prevSample" />
          <Button variant="ghost" size="sm" icon="pi-chevron-right" :disabled="traceIndex >= result.runs.length - 1" @click="nextSample" />
          <Button variant="ghost" size="sm" icon="pi-refresh" @click="run">Re-run</Button>
        </template>
        <div class="wp-tr-step-trace">
          <div
            v-for="(s, i) in result.runs[traceIndex].steps"
            :key="i"
            class="wp-tr-step-row"
            :data-kind="s.kind"
          >
            <span class="wp-mono wp-tr-step-idx">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="wp-mono wp-tr-step-kind">{{ s.kind }}</span>
            <span class="wp-tr-step-name">{{ s.name }}</span>
            <span class="wp-mono wp-tr-step-note">{{ s.note }}</span>
          </div>
        </div>
      </Card>
      <Card title="Resolved context (final)">
        <div class="wp-tr-fixed-grid">
          <template v-for="(v, k) in result.runs[traceIndex].ctx" :key="k">
            <code class="wp-tr-var wp-mono">${{ k }}</code>
            <span class="wp-mono wp-truncate">{{ v }}</span>
          </template>
        </div>
      </Card>
      <Card :title="`Output distribution — ${result.samples} run(s) · ${result.finalCounts.length} unique`">
        <div class="wp-hist">
          <div v-for="entry in result.finalCounts" :key="entry.value" class="wp-hist__row">
            <div class="wp-hist__template wp-mono wp-truncate">{{ entry.value || '(empty)' }}</div>
            <div class="wp-bar">
              <div
                class="wp-bar__fill"
                :style="{ width: entry.pct + '%', background: 'var(--wp-kind-pipeline)' }"
              />
            </div>
            <div class="wp-mono wp-hist__count">{{ entry.count }}</div>
          </div>
        </div>
      </Card>
    </template>
  </div>
</template>

<style scoped>
.wp-tr-page {
  padding: 18px 22px 40px;
  max-width: 1100px;
  margin: 0 auto;
}

.wp-tr-config { display: flex; flex-direction: column; gap: 12px; }

.wp-seg {
  display: flex; gap: 6px; flex-wrap: wrap;
}
.wp-seg__btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 10px;
  border-radius: 6px; font-size: 12.5px; cursor: pointer;
  border: 1px solid var(--wp-border);
  background: var(--wp-bg-2);
  color: var(--wp-text);
}
.wp-seg__btn:hover { border-color: var(--wp-border-strong); }

.wp-tr-row {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) 140px auto;
  gap: 12px;
  align-items: end;
}
.wp-tr-row[data-with-samples="false"] {
  grid-template-columns: minmax(220px, 1fr) auto;
}
.wp-tr-row__run { align-self: end; }

.wp-tr-hint {
  font-size: 11.5px; color: var(--wp-text-muted);
  display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin-top: 4px;
}
.wp-tr-hint__var code { color: var(--wp-accent-text); }

.wp-tr-flags {
  font-size: 11.5px;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-bottom: 10px;
}
.wp-tr-flag-chip {
  padding: 1px 6px; border-radius: 4px;
  background: var(--wp-bg-3);
  font-family: var(--wp-font-mono);
  font-size: 11px;
}

.wp-tr-help {
  font-size: 11.5px;
  margin: 0 0 10px;
}

.wp-hist { display: flex; flex-direction: column; gap: 7px; }
.wp-hist__row {
  display: grid;
  grid-template-columns: minmax(180px, 280px) 1fr 50px;
  gap: 10px;
  align-items: center;
}
.wp-hist__template { min-width: 0; font-size: 12px; }
.wp-hist__resolved { font-size: 11px; line-height: 1.45; margin-top: 2px; }
.wp-hist__resolved-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wp-hist__count {
  text-align: right;
  font-size: 12px;
  color: var(--wp-text-muted);
}

.wp-bar {
  height: 18px;
  background: var(--wp-bg-3);
  border-radius: 6px;
  overflow: hidden;
}
.wp-bar__fill {
  height: 100%;
  border-radius: 6px;
  transition: width .25s;
}

.wp-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.wp-tr-fixed-grid {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 6px 14px;
  font-size: 12.5px;
  align-items: center;
}
.wp-tr-var {
  color: var(--wp-accent-text);
  font-size: 12px;
}

.wp-tr-combine-list { display: flex; flex-direction: column; gap: 6px; }
.wp-tr-combine-row {
  padding: 8px 10px;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: 6px;
}

.wp-tr-cn-scroll { overflow-x: auto; }
.wp-tr-cn-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.wp-tr-cn-table th {
  padding: 6px 8px;
  color: var(--wp-text-muted);
  font-weight: 500;
  border-bottom: 1px solid var(--wp-border);
  white-space: nowrap;
}
.wp-tr-cn-table th.wp-tr-cn-table__lhs { text-align: left; }
.wp-tr-cn-table th.wp-tr-cn-table__w,
.wp-tr-cn-table th.wp-tr-cn-table__sv { text-align: right; }
.wp-tr-cn-table td { padding: 6px 8px; border-bottom: 1px solid var(--wp-border); }
.wp-tr-cn-table td.wp-tr-cn-table__w,
.wp-tr-cn-table td.wp-tr-cn-table__sv { text-align: right; }
.wp-tr-cn-legend {
  display: flex; gap: 14px; margin-top: 12px;
  font-size: 11px; color: var(--wp-text-muted);
}
.wp-tr-dot { color: var(--wp-text); }

.wp-tr-rule-trace { display: flex; flex-direction: column; gap: 6px; }
.wp-tr-rule-row {
  display: grid;
  grid-template-columns: 220px auto 1fr;
  gap: 10px;
  align-items: center;
  padding: 6px 10px;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: 6px;
  font-size: 12px;
}
.wp-tr-rule-id { color: var(--wp-text); }
.wp-tr-rule-status {
  font-size: 11px; padding: 2px 8px; border-radius: 4px;
  background: var(--wp-bg-3); color: var(--wp-text-muted);
}
.wp-tr-rule-status[data-status="branch"] {
  background: color-mix(in oklab, var(--wp-kind-derivation) 18%, transparent);
  color: var(--wp-kind-derivation);
}
.wp-tr-rule-status[data-status="else"] {
  background: color-mix(in oklab, var(--wp-info) 18%, transparent);
  color: var(--wp-info);
}
.wp-tr-rule-delta {
  display: flex; flex-wrap: wrap; gap: 6px;
  font-size: 11.5px;
  min-width: 0;
}
.wp-tr-rule-delta code {
  background: var(--wp-bg-3);
  padding: 1px 6px; border-radius: 4px;
}
.wp-tr-rule-fire-meta { font-size: 11px; }

.wp-tr-step-trace { display: flex; flex-direction: column; gap: 4px; }
.wp-tr-step-row {
  display: grid;
  grid-template-columns: 32px 110px 180px 1fr;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 5px;
  background: var(--wp-bg-2);
  border-left: 3px solid var(--step-color, var(--wp-border));
  align-items: center;
}
.wp-tr-step-row[data-kind="wildcard"]     { --step-color: var(--wp-kind-wildcard); }
.wp-tr-step-row[data-kind="fixed_values"] { --step-color: var(--wp-kind-fixed); }
.wp-tr-step-row[data-kind="combine"]      { --step-color: var(--wp-kind-combine); }
.wp-tr-step-row[data-kind="derivation"]   { --step-color: var(--wp-kind-derivation); }
.wp-tr-step-row[data-kind="constraint"]   { --step-color: var(--wp-kind-constraint); }
.wp-tr-step-row[data-kind="pipeline"]     { --step-color: var(--wp-kind-pipeline); }
.wp-tr-step-idx { font-size: 11px; color: var(--wp-text-dim); }
.wp-tr-step-kind {
  font-size: 11px;
  color: var(--step-color, var(--wp-text-muted));
}
.wp-tr-step-name {
  font-size: 12.5px; color: var(--wp-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.wp-tr-step-note {
  font-size: 11.5px; color: var(--wp-text-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

@media (max-width: 720px) {
  .wp-tr-row { grid-template-columns: 1fr; }
  .wp-tr-rule-row { grid-template-columns: 1fr; }
  .wp-tr-step-row { grid-template-columns: 28px 90px 1fr; }
  .wp-tr-step-row > .wp-tr-step-note { grid-column: 1 / -1; padding-left: 130px; }
}
</style>
