<script setup lang="ts">
/**
 * Stack card inspector, slid in from the right like the seed trace: how one
 * module is set up next to what the last run did with it. Each kind gets its
 * own view (wildcard options vs. how often each came up, a constraint's
 * reach and hits, a combine's template and outputs, …).
 */
import { computed, onBeforeUnmount, onMounted } from "vue";
import Button from "../ui/Button.vue";
import { KIND_META } from "./kinds";
import type { Distribution, Inspect } from "../../utils/inspect";
import type { StackItemView, StackKind } from "../../utils/scenario";

const props = defineProps<{
  view: StackItemView | null;
  /** Stack position, shown as the step number. */
  index: number | null;
  data: Inspect | null;
  /** A run exists for the current stack. */
  hasRun: boolean;
}>();
const emit = defineEmits<{ (e: "close"): void; (e: "edit"): void }>();

const meta = computed(() => KIND_META[(props.view?.kind ?? "wildcard") as StackKind]);

function kindLabel(kind: string): string {
  return kind in KIND_META ? KIND_META[kind as StackKind].label : kind;
}

function kindColor(kind: string): string {
  return kind in KIND_META ? KIND_META[kind as StackKind].color : "var(--wp-text-dim)";
}

/** Picked share this far from the weight share gets a marker. */
const DRIFT_POINTS = 10;

function drift(weightPct: number, pickPct: number | null): "up" | "down" | null {
  if (pickPct === null) return null;
  if (pickPct - weightPct >= DRIFT_POINTS) return "up";
  if (weightPct - pickPct >= DRIFT_POINTS) return "down";
  return null;
}

const dists = computed<Distribution[]>(() => {
  const d = props.data;
  if (!d) return [];
  if (d.kind === "combine") return d.distribution ? [d.distribution] : [];
  if (d.kind === "derivation" || d.kind === "bundle") return d.distributions;
  return [];
});

function distTitle(d: Distribution): string {
  return `${d.distinct} distinct value${d.distinct === 1 ? "" : "s"}`;
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape" && props.view) emit("close");
}
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <aside
    class="wp-tri"
    :data-open="view ? 'true' : 'false'"
    :style="{ '--kc': meta.color }"
    aria-label="Module inspector"
    data-test="inspector"
  >
    <template v-if="view">
      <header class="wp-tri__head">
        <div class="wp-tri__title">
          <span class="wp-tri__kind">{{ index !== null ? `${index + 1} · ` : "" }}{{ meta.label }}</span>
          <h3>{{ view.name }}</h3>
        </div>
        <Button v-if="!view.missing" variant="ghost" size="sm" icon="pi-pencil" data-test="inspector-edit" @click="emit('edit')">Edit</Button>
        <Button variant="ghost" size="sm" icon="pi-times" aria-label="Close inspector" data-test="inspector-close" @click="emit('close')" />
      </header>

      <p v-if="view.missing" class="wp-tri__note">This item was deleted from the library, so the run skips it.</p>
      <p v-else-if="!view.enabled" class="wp-tri__note">Switched off: the run skips it, so there's nothing from the run to show.</p>
      <p v-else-if="!hasRun && data && data.kind !== 'fixed_values'" class="wp-tri__note" data-test="inspector-no-run">Run the scenario to see what it does on each seed.</p>

      <!-- Wildcard: each option's weight share next to how often it came up. -->
      <section v-if="data?.kind === 'wildcard'" class="wp-tri__sec" data-test="inspect-wildcard">
        <h4>
          Options <span v-if="data.binding" class="wp-tri__var">${{ data.binding }}</span>
          <span v-if="data.totalPicks !== null" class="wp-tri__meta">{{ data.totalPicks }} pick{{ data.totalPicks === 1 ? "" : "s" }}</span>
        </h4>
        <p v-if="data.neverPicked" class="wp-tri__warn" data-test="inspect-never">
          {{ data.neverPicked }} option{{ data.neverPicked === 1 ? " was" : "s were" }} never picked. Try more seeds, or check a constraint isn't excluding {{ data.neverPicked === 1 ? "it" : "them" }}.
        </p>
        <table class="wp-tri__table">
          <thead>
            <tr><th>Option</th><th aria-hidden="true" /><th class="wp-tri__num" title="Share of the total weight">Weight</th><th v-if="data.totalPicks !== null" class="wp-tri__num" title="Share of the picks this run made">Picked</th></tr>
          </thead>
          <tbody>
            <tr
              v-for="o in data.options"
              :key="o.id"
              :data-never="o.picks === 0 && o.weight > 0 ? 'true' : 'false'"
              data-test="inspect-option"
            >
              <td class="wp-tri__val">
                <span v-if="o.isNull" class="wp-tri__dim">(nothing)</span>
                <template v-else>{{ o.value || "(empty)" }}</template>
              </td>
              <td class="wp-tri__bars" aria-hidden="true">
                <span class="wp-tri__track"><span class="wp-tri__fill" :style="{ width: `${o.weightPct}%` }" /></span>
                <span v-if="o.pickPct !== null" class="wp-tri__track"><span class="wp-tri__fill wp-tri__fill--pick" :style="{ width: `${o.pickPct}%` }" /></span>
              </td>
              <td class="wp-tri__num">{{ o.weightPct }}%</td>
              <td v-if="data.totalPicks !== null" class="wp-tri__num" :data-drift="drift(o.weightPct, o.pickPct) ?? undefined">{{ o.pickPct }}%</td>
            </tr>
          </tbody>
        </table>
        <p v-if="data.totalPicks !== null" class="wp-tri__foot">
          Picks include this wildcard's <code>@{}</code> uses anywhere in the stack. Constraints and seed count move the picked share away from the weights.
        </p>
      </section>

      <!-- Constraint: what it links, how far it reaches, how often it fired. -->
      <section v-else-if="data?.kind === 'constraint'" class="wp-tri__sec" data-test="inspect-constraint">
        <h4>Re-weights</h4>
        <dl class="wp-tri__facts">
          <dt>When</dt><dd><code>{{ data.source }}</code> picks</dd>
          <dt>Changes</dt><dd><code>{{ data.target }}</code>, {{ data.reach }}</dd>
          <dt>Rules</dt><dd>{{ data.rules }}</dd>
          <template v-if="data.hits !== null">
            <dt>Applied</dt>
            <dd data-test="inspect-hits">
              {{ data.hits }} time{{ data.hits === 1 ? "" : "s" }} over {{ data.runs }} run{{ data.runs === 1 ? "" : "s" }}
            </dd>
          </template>
        </dl>
        <p v-if="data.hits === 0" class="wp-tri__warn">
          It never applied. Check that {{ data.target }} is picked after {{ data.source }} in this stack.
        </p>
      </section>

      <!-- Combine: the template, what it reads, the outputs it produced. -->
      <section v-else-if="data?.kind === 'combine'" class="wp-tri__sec" data-test="inspect-combine">
        <h4>Template <span v-if="data.output" class="wp-tri__var">→ ${{ data.output }}</span></h4>
        <pre class="wp-tri__tpl">{{ data.template || "(empty)" }}</pre>
        <p v-if="data.fixed" class="wp-tri__warn">Plain text with no <code>$variables</code>, <code>@{}</code> references or choices, so it's the same on every run.</p>
        <p v-else-if="data.reads.length" class="wp-tri__reads">
          Reads <code v-for="r in data.reads" :key="r">${{ r }}</code>
        </p>
      </section>

      <!-- Derivation: its rules, then what the target ended up as. -->
      <section v-else-if="data?.kind === 'derivation'" class="wp-tri__sec" data-test="inspect-derivation">
        <h4>Rules</h4>
        <ol class="wp-tri__rules">
          <li v-for="(r, i) in data.rules" :key="i" data-test="inspect-rule">
            <span class="wp-tri__when">{{ r.when }}</span>
            <code>{{ r.then }}</code>
          </li>
        </ol>
        <p v-if="!data.rules.length" class="wp-tri__dim">No rules yet.</p>
      </section>

      <!-- Fixed values: every value it sets. -->
      <section v-else-if="data?.kind === 'fixed_values'" class="wp-tri__sec" data-test="inspect-fixed">
        <h4>Sets on every run</h4>
        <dl class="wp-tri__facts">
          <template v-for="v in data.values" :key="v.name">
            <dt><code>${{ v.name }}</code></dt><dd>{{ v.value || "(empty)" }}</dd>
          </template>
        </dl>
      </section>

      <!-- Bundle: its modules in run order. -->
      <section v-else-if="data?.kind === 'bundle'" class="wp-tri__sec" data-test="inspect-bundle">
        <h4>Runs, in order</h4>
        <ol class="wp-tri__children">
          <li
            v-for="(c, i) in data.children"
            :key="i"
            :style="{ '--depth': c.depth, '--cc': kindColor(c.kind) }"
            data-test="inspect-child"
          >
            <span class="wp-tri__ckind">{{ kindLabel(c.kind) }}</span>
            <span class="wp-tri__cname">{{ c.name }}</span>
            <code v-if="c.binding">${{ c.binding }}</code>
          </li>
        </ol>
      </section>

      <!-- Output distributions (combine, derivation targets, bundle vars). -->
      <section
        v-for="d in dists"
        :key="d.name"
        class="wp-tri__sec"
        data-test="inspect-dist"
      >
        <h4>Values of <span class="wp-tri__var">${{ d.name }}</span> <span class="wp-tri__meta" :title="distTitle(d)">{{ d.distinct }} distinct</span></h4>
        <ul class="wp-tri__dist">
          <li v-for="r in d.rows" :key="r.value">
            <span class="wp-tri__val">{{ r.value || "(empty)" }}</span>
            <span class="wp-tri__track" aria-hidden="true"><span class="wp-tri__fill wp-tri__fill--pick" :style="{ width: `${r.pct}%` }" /></span>
            <span class="wp-tri__num">{{ r.pct }}%</span>
          </li>
        </ul>
        <p v-if="d.other" class="wp-tri__foot">and {{ d.other }} more run{{ d.other === 1 ? "" : "s" }} with other values</p>
      </section>
    </template>
  </aside>
</template>

<style scoped>
.wp-tri {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 40;
  width: min(480px, 100vw); background: var(--wp-bg-1);
  border-left: 1px solid var(--wp-border-strong);
  /* Off-canvas while closed, with no shadow bleeding back on screen. */
  transform: translateX(100%); visibility: hidden;
  transition: transform .2s ease, visibility 0s linear .2s;
  display: flex; flex-direction: column; overflow: auto;
}
.wp-tri[data-open="true"] { transform: none; visibility: visible; box-shadow: var(--wp-shadow-xl); transition: transform .2s ease; }
.wp-tri__head {
  position: sticky; top: 0; z-index: 1; background: var(--wp-bg-1);
  display: flex; align-items: center; gap: var(--wp-space-3);
  padding: var(--wp-space-6); border-bottom: 1px solid var(--wp-border);
  box-shadow: inset 0 3px 0 var(--kc);
}
.wp-tri__title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--wp-space-1); }
.wp-tri__title h3 { margin: 0; font-size: var(--wp-text-md); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-tri__kind { font: var(--wp-weight-medium) var(--wp-text-xs) var(--wp-font-mono); color: var(--kc); text-transform: uppercase; letter-spacing: .05em; }
.wp-tri__note { margin: 0; padding: var(--wp-space-5) var(--wp-space-6) 0; font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-tri__sec { padding: var(--wp-space-5) var(--wp-space-6); display: flex; flex-direction: column; gap: var(--wp-space-4); font-size: var(--wp-text-sm); }
.wp-tri__sec + .wp-tri__sec { border-top: 1px solid var(--wp-border); }
.wp-tri__sec h4 {
  margin: 0; display: flex; align-items: baseline; gap: var(--wp-space-3);
  font-size: var(--wp-text-xs); font-weight: var(--wp-weight-semibold);
  letter-spacing: .08em; text-transform: uppercase; color: var(--wp-text-muted);
}
.wp-tri__var { font-family: var(--wp-font-mono); text-transform: none; letter-spacing: 0; color: var(--wp-accent-text); }
.wp-tri__meta { margin-left: auto; font-weight: var(--wp-weight-regular, 400); text-transform: none; letter-spacing: 0; color: var(--wp-text-dim); }
.wp-tri__warn { margin: 0; font-size: var(--wp-text-xs); color: var(--wp-warn); line-height: var(--wp-line-xs); }
.wp-tri__foot { margin: 0; font-size: var(--wp-text-xs); color: var(--wp-text-dim); line-height: var(--wp-line-xs); }
.wp-tri__dim { color: var(--wp-text-dim); }
.wp-tri code { font-family: var(--wp-font-mono); color: var(--wp-accent-text); }
.wp-tri__table { width: 100%; border-collapse: collapse; }
.wp-tri__table th {
  text-align: left; font-size: var(--wp-text-xs); font-weight: var(--wp-weight-medium); color: var(--wp-text-dim);
  padding: 0 var(--wp-space-3) var(--wp-space-2); border-bottom: 1px solid var(--wp-border);
}
.wp-tri__table td { padding: var(--wp-space-2) var(--wp-space-3); border-bottom: 1px solid var(--wp-border); vertical-align: top; }
.wp-tri__table tr[data-never="true"] .wp-tri__val { color: var(--wp-warn); }
.wp-tri__val { word-break: break-word; }
.wp-tri__num { width: 56px; text-align: right; font-variant-numeric: tabular-nums; font-family: var(--wp-font-mono); font-size: var(--wp-text-xs); white-space: nowrap; }
.wp-tri__table th.wp-tri__num { text-align: right; }
.wp-tri__num[data-drift="up"] { color: var(--wp-success); }
.wp-tri__num[data-drift="down"] { color: var(--wp-warn); }
/* Weight share (grey) over picked share (kind colour). */
.wp-tri__bars { width: 88px; vertical-align: middle; }
.wp-tri__bars .wp-tri__track + .wp-tri__track { margin-top: 2px; }
.wp-tri__track { display: block; width: 88px; height: 4px; border-radius: 2px; background: var(--wp-bg-3); overflow: hidden; flex: none; }
.wp-tri__fill { display: block; height: 100%; background: var(--wp-text-dim); }
.wp-tri__fill--pick { background: var(--kc); }
.wp-tri__facts { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: var(--wp-space-2) var(--wp-space-5); }
.wp-tri__facts dt { color: var(--wp-text-dim); font-size: var(--wp-text-xs); padding-top: 1px; }
.wp-tri__facts dd { margin: 0; word-break: break-word; }
.wp-tri__tpl {
  margin: 0; padding: var(--wp-space-4) var(--wp-space-5); white-space: pre-wrap; word-break: break-word;
  background: var(--wp-bg-2); border: 1px solid var(--wp-border); border-radius: var(--wp-radius-sm);
  font: var(--wp-text-sm)/1.5 var(--wp-font-mono); color: var(--wp-text);
}
.wp-tri__reads { margin: 0; display: flex; flex-wrap: wrap; gap: var(--wp-space-3); align-items: baseline; font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-tri__rules, .wp-tri__children { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--wp-space-2); }
.wp-tri__rules li { display: flex; flex-direction: column; gap: var(--wp-space-1); padding: var(--wp-space-3) var(--wp-space-4); background: var(--wp-bg-2); border-radius: var(--wp-radius-sm); }
.wp-tri__when { font-size: var(--wp-text-xs); color: var(--wp-text-muted); }
.wp-tri__children li {
  display: flex; align-items: baseline; gap: var(--wp-space-4);
  margin-left: calc(var(--depth) * var(--wp-space-6));
  padding: var(--wp-space-2) var(--wp-space-4); border-left: 3px solid var(--cc);
  background: var(--wp-bg-2); border-radius: var(--wp-radius-sm);
}
.wp-tri__ckind { font: var(--wp-text-xs) var(--wp-font-mono); color: var(--cc); text-transform: uppercase; }
.wp-tri__cname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-tri__dist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.wp-tri__dist li { display: flex; align-items: center; gap: var(--wp-space-4); padding: var(--wp-space-2) 0; border-bottom: 1px solid var(--wp-border); }
.wp-tri__dist .wp-tri__val { flex: 1; }
.wp-tri__dist .wp-tri__num { width: auto; }
@media (prefers-reduced-motion: reduce) { .wp-tri { transition: none; } }
</style>
