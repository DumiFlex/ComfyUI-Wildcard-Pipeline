<script setup lang="ts">
/**
 * Test Runner — kind-aware module dry-run.
 *
 * Faithful port of `TestRunnerScreen` from
 * `docs/design-handoff/wildcardpipeline/project/screens/utilities.jsx`.
 * Uses ui/* primitives only — no PrimeVue.
 */
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import Button from "../components/ui/Button.vue";
import Card from "../components/ui/Card.vue";
import Field from "../components/ui/Field.vue";
import Icon, { ICON_SM } from "../components/ui/Icon.vue";
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
  runBundleChild,
  wildcardVar,
  type BundleChildLike,
} from "../utils/resolver";
import { toIdentifier } from "../utils/slug";
import { buildUuidToName } from "../utils/wildcardSyntax";
import type {
  BundleRow,
  CombinePayload,
  ConstraintPayload,
  DerivationPayload,
  DerivationRule,
  ModuleRow,
  ModuleType,
  WildcardOption,
  WildcardPayload,
} from "../api/types";

/** Selector kind — module kinds + a "bundle" pseudo-kind that runs
 *  every child sequentially against a shared ctx. */
type SelectorKind = ModuleType | "bundle";

const toast = useToast();
const router = useRouter();

/* -------------------------- kind metadata -------------------------- */

interface KindOption { value: SelectorKind; label: string; icon: string; color: string }
const KINDS: KindOption[] = [
  { value: "wildcard",     label: "Wildcard",   icon: "pi-sparkles",                color: "var(--wp-kind-wildcard)" },
  { value: "combine",      label: "Combine",    icon: "pi-link",                    color: "var(--wp-kind-combine)" },
  { value: "constraint",   label: "Constraint", icon: "pi-filter",                  color: "var(--wp-kind-constraint)" },
  { value: "derivation",   label: "Derivation", icon: "pi-arrow-right-arrow-left",  color: "var(--wp-kind-derivation)" },
  { value: "fixed_values", label: "Fixed",      icon: "pi-tag",                     color: "var(--wp-kind-fixed)" },
  { value: "bundle",       label: "Bundle",     icon: "pi-box",                     color: "var(--wp-bundle-default, #6366f1)" },
];

const KIND_HINT: Record<SelectorKind, string> = {
  wildcard:     "Resolves the wildcard N times, expanding {a|b|c} choices and @refs.",
  combine:      "Fills the template against upstream wildcards for N samples.",
  constraint:   "Computes the adjusted weight matrix per source value (deterministic).",
  derivation:   "Runs each rule for N samples and reports per-rule fire rate.",
  fixed_values: "Resolves 1 sample showing all $var = value bindings.",
  bundle:       "Runs every bundle child top-to-bottom for N samples and traces each step. Same flow as embedding the bundle into a Context.",
};

const KIND_DEFAULT_SAMPLES: Record<SelectorKind, number> = {
  wildcard: 100, combine: 100,
  constraint: 1, derivation: 100, fixed_values: 1,
  bundle: 25,
};

/* ------------------------------ state ------------------------------ */

const kind = ref<SelectorKind>("wildcard");
const moduleId = ref<string | null>(null);
const samples = ref<number>(KIND_DEFAULT_SAMPLES.wildcard);
const running = ref(false);
const allModules = ref<ModuleRow[]>([]);
const allBundles = ref<BundleRow[]>([]);

// 8-hex UUID → human var-name. Drives `@{uuid}` chip labels in every
// RichTextPreview below (histogram templates, combine renderings).
const uuidToName = computed(() => buildUuidToName(allModules.value));

// Set of known wildcard ids — used to gate ref-pill clicks. Post DB
// migration 004 `mod.id` IS the 8-hex uuid the tokenizer's `@{8hex}`
// ref captures, so no reverse mapping is needed anymore.
const knownWildcardIds = computed(() => {
  const set = new Set<string>();
  for (const m of allModules.value) {
    if (m.type === "wildcard") set.add(m.id);
  }
  return set;
});

function onRefClick(uuid: string): void {
  if (!knownWildcardIds.value.has(uuid)) {
    toast.push({
      severity: "warn",
      summary: "Wildcard not found",
      detail: `No wildcard with UUID ${uuid} in the catalog.`,
      life: 2500,
    });
    return;
  }
  router.push({ name: "wildcards-edit", params: { id: uuid } });
}

interface WildcardEntry { template: string; count: number; pct: number; resolved: string[] }
interface WildcardResult { type: "wildcard"; samples: number; entries: WildcardEntry[]; hasInline: boolean; hasRefs: boolean }
interface FixedResult { type: "fixed_values"; bindings: { name: string; value: string }[] }
interface CombineResult { type: "combine"; samples: number; rendered: string[]; distribution: { value: string; count: number; pct: number }[] }
interface DerivationSampleTrace { ruleId: string; fired: "branch" | "else" | "skip"; branchIndex: number | null; delta: Record<string, string> }
interface DerivationResult { type: "derivation"; samples: number; rules: DerivationRule[]; perSample: { trace: DerivationSampleTrace[]; before: Record<string, string>; after: Record<string, string> }[]; fireCounts: Record<string, { branch: number; else: number; skip: number }> }
interface ConstraintRow { value: string; before: number; after: { source: string; weight: number; mode: "allow"|"exclude"|"boost"|"reduce" }[] }
interface ConstraintResult { type: "constraint"; targetName: string; sourceName: string; sourceValues: string[]; rows: ConstraintRow[] }
interface BundleRunTrace { steps: { kind: string; name: string; note: string }[]; ctx: Record<string, string>; primary: string }
interface BundleResult { type: "bundle"; samples: number; runs: BundleRunTrace[]; finalCounts: { value: string; count: number; pct: number }[] }
type RunResult = WildcardResult | FixedResult | CombineResult | DerivationResult | ConstraintResult | BundleResult;

const result = ref<RunResult | null>(null);
const traceIndex = ref(0);

/* ------------------------- derived helpers ------------------------- */

/** Items available in the picker — modules filtered by kind, or all
 *  bundles when the bundle pseudo-kind is selected. */
const filteredItems = computed<{ id: string; name: string }[]>(() => {
  if (kind.value === "bundle") {
    return allBundles.value.map((b) => ({ id: b.id, name: b.name }));
  }
  return allModules.value
    .filter((m) => m.type === kind.value)
    .map((m) => ({ id: m.id, name: m.name }));
});

const moduleOptions = computed(() =>
  filteredItems.value.map((m) => ({ value: m.id, label: m.name })),
);

const selectedModule = computed(() =>
  kind.value === "bundle"
    ? null
    : allModules.value.find((m) => m.id === moduleId.value) ?? null,
);

const selectedBundle = computed(() =>
  kind.value === "bundle"
    ? allBundles.value.find((b) => b.id === moduleId.value) ?? null
    : null,
);

const wildcards = computed(() => allModules.value.filter((m) => m.type === "wildcard"));

watch(kind, (k) => {
  result.value = null;
  traceIndex.value = 0;
  if (k === "bundle") {
    moduleId.value = allBundles.value[0]?.id ?? null;
  } else {
    const first = allModules.value.find((m) => m.type === k);
    moduleId.value = first?.id ?? null;
  }
  samples.value = KIND_DEFAULT_SAMPLES[k];
});

watch(moduleId, () => {
  result.value = null;
  traceIndex.value = 0;
});

const refreshing = ref(false);
async function refresh() {
  refreshing.value = true;
  try {
    const [modRes, bundleRes] = await Promise.all([
      api.modules.list({}),
      api.bundles.list({}),
    ]);
    allModules.value = modRes.items;
    allBundles.value = bundleRes.items;
    // Re-seed selection if the current id no longer exists in the
    // active kind's pool (e.g. after a refresh that removed it).
    const pool = kind.value === "bundle"
      ? allBundles.value.map((b) => b.id)
      : allModules.value.filter((m) => m.type === kind.value).map((m) => m.id);
    if (!moduleId.value || !pool.includes(moduleId.value)) {
      moduleId.value = pool[0] ?? null;
    }
  } catch (e) {
    toast.push({ severity: "error", summary: "Failed to load library", detail: String(e), life: 3000 });
  } finally {
    refreshing.value = false;
  }
}
onMounted(refresh);

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

function runBundle(b: BundleRow, n: number): BundleResult {
  const wcs = wildcards.value;
  const runs: BundleRunTrace[] = [];
  const finalCounts = new Map<string, number>();
  const children = (b.children ?? []) as unknown as BundleChildLike[];
  for (let i = 0; i < n; i++) {
    const ctx: Record<string, string> = {};
    const stepTrace: BundleRunTrace["steps"] = [];
    for (const child of children) {
      const t = runBundleChild(child, wcs, ctx);
      stepTrace.push({ kind: t.kind, name: t.name, note: t.note });
    }
    // Primary output preference: last combine's `output_var` (matches
    // how a real Context's PROMPT slot pulls from the trailing combine);
    // fall back to the longest ctx value as a heuristic.
    let primary = "";
    for (let s = children.length - 1; s >= 0; s--) {
      const ch = children[s];
      if (ch?.type === "combine") {
        const out = ((ch.payload as Partial<CombinePayload> | undefined)?.output_var ?? "").replace(/^\$/, "");
        if (out && ctx[out] !== undefined) { primary = ctx[out]; break; }
      }
    }
    if (!primary) {
      primary = Object.values(ctx).reduce(
        (a, c) => (String(c).length > String(a).length ? c : a),
        "",
      );
    }
    finalCounts.set(primary || "(empty)", (finalCounts.get(primary || "(empty)") ?? 0) + 1);
    runs.push({ steps: stepTrace, ctx: { ...ctx }, primary });
  }
  const total = Array.from(finalCounts.values()).reduce((a, c) => a + c, 0) || 1;
  const sorted = Array.from(finalCounts.entries())
    .sort((a, c) => c[1] - a[1])
    .slice(0, 10)
    .map(([value, count]) => ({ value, count, pct: count / total * 100 }));
  return { type: "bundle", samples: n, runs, finalCounts: sorted };
}

async function run() {
  running.value = true;
  result.value = null;
  traceIndex.value = 0;
  // Yield once so the loading state paints before heavy work.
  await Promise.resolve();
  try {
    const n = Math.max(1, samples.value || 1);
    if (kind.value === "bundle") {
      const b = selectedBundle.value;
      if (!b) return;
      result.value = runBundle(b, n);
    } else {
      const mod = selectedModule.value;
      if (!mod) return;
      if (mod.type === "wildcard")          result.value = runWildcardHistogram(mod, n);
      else if (mod.type === "fixed_values") result.value = runFixed(mod);
      else if (mod.type === "combine")      result.value = runCombine(mod, n);
      else if (mod.type === "constraint")   result.value = runConstraintMatrix(mod);
      else if (mod.type === "derivation")   result.value = runDerivation(mod, n);
    }
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
  if (r.type === "bundle")     return { count: r.runs.length };
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

function pickKind(k: SelectorKind) {
  kind.value = k;
}
</script>

<template>
  <div class="wp-page wp-tr-page">
    <div class="wp-page__header">
      <div class="wp-page__title-wrap">
        <h1 class="wp-page__title">Test runner</h1>
        <p class="wp-page__subtitle">
          Resolve any module against the engine and inspect the output.
        </p>
      </div>
      <div class="wp-page__actions">
        <Button
          variant="ghost"
          icon="pi pi-refresh"
          aria-label="Refresh module list"
          :disabled="refreshing"
          :class="{ 'wp-refresh-btn--spin': refreshing }"
          @click="refresh"
        >Refresh</Button>
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
              <Icon :name="k.icon" :size="ICON_SM" /> {{ k.label }}
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
          <Icon :name="selectedKindMeta.icon" :size="ICON_SM" />
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
            <RichTextPreview
              :value="entry.template"
              :uuid-to-name="uuidToName"
              clickable-refs
              @ref-click="onRefClick"
            />
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
            <RichTextPreview
              :value="s"
              :uuid-to-name="uuidToName"
              clickable-refs
              @ref-click="onRefClick"
            />
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
        <span><span class="wp-tr-dot wp-icon--success">●</span> boost</span>
        <span><span class="wp-tr-dot">●</span> allow</span>
        <span><span class="wp-tr-dot wp-icon--warn">●</span> reduce</span>
        <span><span class="wp-tr-dot wp-icon--danger">●</span> exclude</span>
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

    <!-- Bundle panel -->
    <template v-else-if="result?.type === 'bundle'">
      <Card data-test="result-bundle"
        :title="`Bundle trace — sample ${traceIndex + 1} of ${result.runs.length}`">
        <template #actions>
          <Button variant="ghost" size="sm" icon="pi-chevron-left" :disabled="traceIndex <= 0" @click="prevSample" />
          <Button variant="ghost" size="sm" icon="pi-chevron-right" :disabled="traceIndex >= result.runs.length - 1" @click="nextSample" />
          <Button variant="ghost" size="sm" icon="pi-refresh" @click="run">Re-run</Button>
        </template>
        <div class="wp-tr-step-trace wp-tr-step-trace--bundle">
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
        <div class="wp-tr-fixed-grid wp-tr-fixed-grid--bundle">
          <template v-for="(v, k) in result.runs[traceIndex].ctx" :key="k">
            <code class="wp-tr-var wp-mono">${{ k }}</code>
            <span class="wp-mono wp-tr-ctx-val">{{ v }}</span>
          </template>
        </div>
      </Card>
      <Card :title="`Output distribution — ${result.samples} run(s) · ${result.finalCounts.length} unique`">
        <div class="wp-hist wp-hist--bundle">
          <div v-for="entry in result.finalCounts" :key="entry.value" class="wp-hist__row">
            <div class="wp-hist__template wp-mono">{{ entry.value || '(empty)' }}</div>
            <div class="wp-bar">
              <div
                class="wp-bar__fill"
                :style="{ width: entry.pct + '%', background: 'var(--wp-bundle-default, #6366f1)' }"
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
  padding: 18px 22px 40px; /* audit-exempt: 18/22/40 page-frame insets match ImportExport layout */
  max-width: 1100px;
  margin: 0 auto;
}

.wp-tr-config { display: flex; flex-direction: column; gap: var(--wp-space-5); }

.wp-seg {
  display: flex; gap: var(--wp-space-3); flex-wrap: wrap;
}
.wp-seg__btn {
  display: inline-flex; align-items: center; gap: var(--wp-space-3);
  padding: var(--wp-space-3) var(--wp-space-5);
  border-radius: 6px; font-size: var(--wp-text-sm); cursor: pointer;
  border: 1px solid var(--wp-border);
  background: var(--wp-bg-2);
  color: var(--wp-text);
}
.wp-seg__btn:hover { border-color: var(--wp-border-strong); }

.wp-tr-row {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) 140px auto;
  gap: var(--wp-space-5);
  align-items: end;
}
.wp-tr-row[data-with-samples="false"] {
  grid-template-columns: minmax(220px, 1fr) auto;
}
.wp-tr-row__run { align-self: end; }

.wp-tr-hint {
  font-size: var(--wp-text-xs); color: var(--wp-text-muted);
  display: inline-flex; align-items: center; gap: var(--wp-space-3); flex-wrap: wrap;
  margin-top: var(--wp-space-2);
}
.wp-tr-hint__var code { color: var(--wp-accent-text); }

.wp-tr-flags {
  font-size: var(--wp-text-xs);
  display: flex; align-items: center; gap: var(--wp-space-4); flex-wrap: wrap;
  margin-bottom: var(--wp-space-5);
}
.wp-tr-flag-chip {
  padding: 1px var(--wp-space-3); border-radius: 4px;
  background: var(--wp-bg-3);
  font-family: var(--wp-font-mono);
  font-size: var(--wp-text-xs);
}

.wp-tr-help {
  font-size: var(--wp-text-xs);
  margin: 0 0 var(--wp-space-5);
}

.wp-hist { display: flex; flex-direction: column; gap: var(--wp-space-4); }
.wp-hist__row {
  display: grid;
  grid-template-columns: minmax(180px, 280px) 1fr 50px;
  gap: var(--wp-space-5);
  align-items: center;
}
.wp-hist__template { min-width: 0; font-size: var(--wp-text-sm); }
.wp-hist__resolved { font-size: var(--wp-text-xs); line-height: 1.45; margin-top: 2px; }
.wp-hist__resolved-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wp-hist__count {
  text-align: right;
  font-size: var(--wp-text-sm);
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
  gap: var(--wp-space-3) var(--wp-space-6);
  font-size: var(--wp-text-sm);
  align-items: center;
}
.wp-tr-var {
  color: var(--wp-accent-text);
  font-size: var(--wp-text-sm);
}

.wp-tr-combine-list { display: flex; flex-direction: column; gap: var(--wp-space-3); }
.wp-tr-combine-row {
  padding: var(--wp-space-4) var(--wp-space-5);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: 6px;
}

.wp-tr-cn-scroll { overflow-x: auto; }
.wp-tr-cn-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--wp-text-sm);
}
.wp-tr-cn-table th {
  padding: var(--wp-space-3) var(--wp-space-4);
  color: var(--wp-text-muted);
  font-weight: 500;
  border-bottom: 1px solid var(--wp-border);
  white-space: nowrap;
}
.wp-tr-cn-table th.wp-tr-cn-table__lhs { text-align: left; }
.wp-tr-cn-table th.wp-tr-cn-table__w,
.wp-tr-cn-table th.wp-tr-cn-table__sv { text-align: right; }
.wp-tr-cn-table td { padding: var(--wp-space-3) var(--wp-space-4); border-bottom: 1px solid var(--wp-border); }
.wp-tr-cn-table td.wp-tr-cn-table__w,
.wp-tr-cn-table td.wp-tr-cn-table__sv { text-align: right; }
.wp-tr-cn-legend {
  display: flex; gap: var(--wp-space-6); margin-top: var(--wp-space-5);
  font-size: var(--wp-text-xs); color: var(--wp-text-muted);
}
.wp-tr-dot { color: var(--wp-text); }

.wp-tr-rule-trace { display: flex; flex-direction: column; gap: var(--wp-space-3); }
.wp-tr-rule-row {
  display: grid;
  grid-template-columns: 220px auto 1fr;
  gap: var(--wp-space-5);
  align-items: center;
  padding: var(--wp-space-3) var(--wp-space-5);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: 6px;
  font-size: var(--wp-text-sm);
}
.wp-tr-rule-id { color: var(--wp-text); }
.wp-tr-rule-status {
  font-size: var(--wp-text-xs); padding: 2px var(--wp-space-4); border-radius: 4px;
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
  display: flex; flex-wrap: wrap; gap: var(--wp-space-3);
  font-size: var(--wp-text-xs);
  min-width: 0;
}
.wp-tr-rule-delta code {
  background: var(--wp-bg-3);
  padding: 1px var(--wp-space-3); border-radius: 4px;
}
.wp-tr-rule-fire-meta { font-size: var(--wp-text-xs); }

.wp-tr-step-trace { display: flex; flex-direction: column; gap: var(--wp-space-2); }
.wp-tr-step-row {
  display: grid;
  grid-template-columns: 32px 110px 180px 1fr;
  gap: var(--wp-space-5);
  padding: var(--wp-space-3) var(--wp-space-4);
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
.wp-tr-step-idx { font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-tr-step-kind {
  font-size: var(--wp-text-xs);
  color: var(--step-color, var(--wp-text-muted));
}
.wp-tr-step-name {
  font-size: var(--wp-text-sm); color: var(--wp-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.wp-tr-step-note {
  font-size: var(--wp-text-xs); color: var(--wp-text-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

@media (max-width: 720px) {
  .wp-tr-row { grid-template-columns: 1fr; }
  .wp-tr-rule-row { grid-template-columns: 1fr; }
  .wp-tr-step-row { grid-template-columns: 28px 90px 1fr; }
  .wp-tr-step-row > .wp-tr-step-note { grid-column: 1 / -1; padding-left: 130px; } /* audit-exempt: 130px = sum of first two grid columns (28+90+gap) */
}

/* Bundle panel — drop truncation everywhere so users can read full
 * resolved values, brace-expanded combine outputs, and long ctx
 * contents without ellipsis. The bar+count columns in the output
 * distribution stay aligned because the grid template fixes their
 * widths; only the template column flexes to fit wrapped text.
 *
 * Step rows align to the top once content can wrap — otherwise a
 * three-line note next to a one-line kind chip vertically-centers
 * everything and the kind label drifts off the first line of the
 * value, which makes the trace harder to scan top-to-bottom. */
.wp-tr-step-trace--bundle .wp-tr-step-row { align-items: start; }
.wp-tr-step-trace--bundle .wp-tr-step-name,
.wp-tr-step-trace--bundle .wp-tr-step-note {
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
  word-break: break-word;
}
.wp-tr-fixed-grid--bundle .wp-tr-ctx-val {
  white-space: normal;
  word-break: break-word;
  overflow: visible;
}
.wp-hist--bundle .wp-hist__template {
  white-space: normal;
  word-break: break-word;
  overflow: visible;
  text-overflow: clip;
}
</style>
