<script setup lang="ts">
/**
 * PackGraphItem — the graph behind one plan item of a graph plan, edited
 * by hand: a slot's axes and use (show, pick, hold, sometimes none), the
 * relations a constraint or derivation compiles from, a fixed values'
 * text, or the template's lead, order and negative. Every change goes to
 * the graph; the server compiles the item from it again.
 */
import { computed } from "vue";
import Checkbox from "../ui/Checkbox.vue";
import Input from "../ui/Input.vue";
import Select from "../ui/Select.vue";
import type { SelectOption } from "../ui/select-types";
import type { AiPackItem, AiPackRelation, AiPackRelationKind, AiPackSlot } from "../../api/types";
import { usePackBuilder } from "../../composables/usePackBuilder";

const props = defineProps<{ item: AiPackItem }>();
const pb = usePackBuilder();

const graph = computed(() => pb.draft.value?.graph ?? null);
const busy = computed(() => pb.convo.loading.value || !!pb.changing.value);
const slot = computed(() => pb.slotOf(props.item.key));
const relations = computed(() => pb.relationsOf(props.item.key).map((n) => ({ n, r: graph.value!.relations[n] })));
const fixed = computed(() => graph.value?.fixed.find((f) => f.var === props.item.var) ?? null);
const slotOptions = computed<SelectOption[]>(() => (graph.value?.slots ?? []).map((s) => ({ value: s.name, label: s.name })));

const KINDS: Array<SelectOption & { value: AiPackRelationKind }> = [
  { value: "exclude", label: "never gets" },
  { value: "only", label: "only gets" },
  { value: "boost", label: "favours" },
  { value: "reduce", label: "rarely gets" },
  { value: "agree", label: "agrees with, on an axis" },
  { value: "accepts", label: "accepts (offers values of an axis)" },
  { value: "derive", label: "sets a variable" },
  { value: "append", label: "adds to a variable" },
  { value: "draw", label: "draws from (a pick in front of each option)" },
];
const SHOW: SelectOption[] = [
  { value: "prompt", label: "In the prompt" },
  { value: "internal", label: "Internal (rules only)" },
];

function text(ev: Event): string {
  return (ev.target as HTMLInputElement | HTMLTextAreaElement).value;
}

function words(raw: string): string[] {
  return [...new Set(raw.split(/[,\s]+/).map((t) => t.replace(/^#/, "").trim().toLowerCase()).filter(Boolean))];
}

function setSlot(set: Partial<AiPackSlot>): void {
  if (slot.value) pb.editSlot(slot.value.var, set);
}

function setAxisName(n: number, name: string): void {
  if (!slot.value) return;
  const axes = slot.value.axes.map((a, i) => (i === n ? { ...a, name: name.trim().toLowerCase().replace(/\s+/g, "_") } : a));
  setSlot({ axes });
}

function setAxisValues(n: number, raw: string): void {
  if (!slot.value) return;
  const axes = slot.value.axes.map((a, i) => (i === n ? { ...a, values: words(raw) } : a));
  setSlot({ axes: axes.filter((a) => a.values.length) });
}

function addAxis(): void {
  if (!slot.value) return;
  setSlot({ axes: [...slot.value.axes, { name: `axis_${slot.value.axes.length + 1}`, values: ["a", "b"] }] });
}

function axesOf(name: string): SelectOption[] {
  const s = graph.value?.slots.find((x) => x.name === name);
  return (s?.axes ?? []).map((a) => ({ value: a.name, label: a.name }));
}

function valuesOf(name: string, axis: string): SelectOption[] {
  const s = graph.value?.slots.find((x) => x.name === name);
  return (s?.axes.find((a) => a.name === axis)?.values ?? []).map((v) => ({ value: v, label: v }));
}

function keyed(r: AiPackRelation): boolean {
  return !["agree", "accepts"].includes(r.kind);
}

/** Whether the target side names an axis value (draw names the slot only). */
function toKeyed(r: AiPackRelation): boolean {
  return keyed(r) && r.kind !== "draw";
}

function writes(r: AiPackRelation): boolean {
  return r.kind === "derive" || r.kind === "append";
}

function setSide(n: number, r: AiPackRelation, side: "from" | "to", set: Partial<AiPackRelation["from"]>): void {
  const cur = r[side] ?? { slot: "", axis: "", value: "" };
  pb.editRelation(n, { [side]: { ...cur, ...set } });
}

function setKind(n: number, r: AiPackRelation, kind: AiPackRelationKind): void {
  const next: Partial<AiPackRelation> = { kind };
  if (kind === "derive" || kind === "append") next.to = undefined;
  else if (!r.to) next.to = { slot: "", axis: "", value: "" };
  pb.editRelation(n, next);
}

function addRelation(): void {
  const g = graph.value;
  if (!g) return;
  const i = props.item;
  const byVar = new Map(g.slots.map((s) => [s.var, s.name]));
  if (i.kind === "derivation") {
    pb.addRelation({ kind: "derive", from: { slot: g.slots[0]?.name ?? "", axis: "", value: "" }, var: i.var, text: "", otherwise: "" });
  } else {
    pb.addRelation({ kind: "exclude", from: { slot: byVar.get(i.source) ?? "", axis: "", value: "" }, to: { slot: byVar.get(i.target) ?? "", axis: "", value: "" } });
  }
}

function setFixed(set: { text?: string; negative?: string }): void {
  pb.editGraph((g) => ({ ...g, fixed: g.fixed.map((f) => (f.var === props.item.var ? { ...f, ...set } : f)) }));
}

function setTemplate(set: Partial<NonNullable<typeof graph.value>["template"]>): void {
  pb.editTemplate(set);
}

function move(v: string, by: number): void {
  const order = [...(graph.value?.template.order ?? [])];
  const at = order.indexOf(v);
  const to = at + by;
  if (at < 0 || to < 0 || to >= order.length) return;
  order.splice(at, 1);
  order.splice(to, 0, v);
  setTemplate({ order });
}
</script>

<template>
  <div v-if="graph" class="wp-pack-graph" data-test="pack-graph-item">
    <template v-if="slot">
      <div class="wp-pack-graph__grid">
        <label class="wp-pack-graph__field">
          <span>Shown</span>
          <Select size="sm" :model-value="slot.show" :options="SHOW" :filterable="false" :disabled="busy" aria-label="Shown" data-test="pack-slot-show" @update:model-value="(v) => setSlot({ show: v as AiPackSlot['show'] })" />
        </label>
        <label class="wp-pack-graph__field">
          <span>Picks per run</span>
          <input class="wp-input wp-input--sm" :value="slot.pick" placeholder="1" :disabled="busy" data-test="pack-slot-pick" @change="setSlot({ pick: text($event).trim() })">
        </label>
        <label class="wp-pack-graph__field">
          <span>Sometimes none (%)</span>
          <Input type="number" size="sm" :model-value="slot.sometimes_none" :min="0" :max="90" :disabled="busy" aria-label="Sometimes none" @update:model-value="(v) => setSlot({ sometimes_none: Math.max(0, Math.min(90, Math.round(Number(v)) || 0)) })" />
        </label>
        <label class="wp-pack-graph__check">
          <Checkbox class="wp-checkbox--inline" :model-value="slot.hold === true" :disabled="busy" data-test="pack-slot-hold" @update:model-value="(v) => setSlot({ hold: v })" />
          <span>Hold the pick across a batch</span>
        </label>
        <label v-if="pb.draft.value?.run?.mode === 'sweep'" class="wp-pack-graph__check">
          <Checkbox class="wp-checkbox--inline" :model-value="slot.sweep === true" :disabled="busy" data-test="pack-slot-sweep" @update:model-value="(v) => setSlot({ sweep: v })" />
          <span>Sweep axis (the Loop sweeps its options)</span>
        </label>
      </div>
      <div class="wp-pack-graph__axes" data-test="pack-slot-axes">
        <span class="wp-pack-graph__label">Axes (what rules key on; every option gets a value of each)</span>
        <div v-for="(a, n) in slot.axes" :key="n" class="wp-pack-graph__axis">
          <input class="wp-input wp-input--sm wp-pack-graph__axis-name" :value="a.name" :disabled="busy" aria-label="Axis name" data-test="pack-axis-name" @change="setAxisName(n, text($event))">
          <input class="wp-input wp-input--sm" :value="a.values.join(', ')" :disabled="busy" aria-label="Axis values" data-test="pack-axis-values" @change="setAxisValues(n, text($event))">
        </div>
        <button type="button" class="wp-pack-graph__link" :disabled="busy" data-test="pack-axis-add" @click="addAxis">Add an axis</button>
      </div>
    </template>

    <template v-if="item.kind === 'constraint' || item.kind === 'derivation' || (slot && relations.length)">
      <span class="wp-pack-graph__label">{{ item.kind === 'constraint' ? 'Rules between these two picks' : item.kind === 'derivation' ? 'What writes this variable' : 'Lists its options draw from (a fresh pick in front of each)' }}</span>
      <div v-for="{ n, r } in relations" :key="n" class="wp-pack-graph__rel" data-test="pack-relation">
        <Select size="sm" class="wp-pack-graph__rel-slot" :model-value="r.from.slot" :options="slotOptions" :filterable="false" :disabled="busy" aria-label="Source slot" @update:model-value="(v) => setSide(n, r, 'from', { slot: String(v), axis: '', value: '' })" />
        <Select size="sm" :model-value="r.from.axis" :options="axesOf(r.from.slot)" :filterable="false" :disabled="busy" aria-label="Source axis" data-test="pack-relation-axis" @update:model-value="(v) => setSide(n, r, 'from', { axis: String(v), value: '' })" />
        <Select v-if="keyed(r)" size="sm" :model-value="r.from.value" :options="valuesOf(r.from.slot, r.from.axis)" :filterable="false" :disabled="busy" aria-label="Source value" @update:model-value="(v) => setSide(n, r, 'from', { value: String(v) })" />
        <Select size="sm" class="wp-pack-graph__rel-kind" :model-value="r.kind" :options="KINDS" :filterable="false" :disabled="busy" aria-label="Relation" data-test="pack-relation-kind" @update:model-value="(v) => setKind(n, r, v as AiPackRelationKind)" />
        <template v-if="writes(r)">
          <input class="wp-input wp-input--sm wp-pack-graph__rel-var" :value="r.var ?? ''" placeholder="variable" :disabled="busy" aria-label="Variable written" @change="pb.editRelation(n, { var: text($event).replace(/^\$/, '').trim() })">
          <input class="wp-input wp-input--sm" :value="r.text ?? ''" placeholder="text" :disabled="busy" aria-label="Text" data-test="pack-relation-text" @change="pb.editRelation(n, { text: text($event) })">
          <input v-if="r.kind === 'derive'" class="wp-input wp-input--sm" :value="r.otherwise ?? ''" placeholder="otherwise (optional)" :disabled="busy" aria-label="Otherwise" @change="pb.editRelation(n, { otherwise: text($event) })">
        </template>
        <template v-else>
          <Select size="sm" class="wp-pack-graph__rel-slot" :model-value="r.to?.slot ?? ''" :options="slotOptions" :filterable="false" :disabled="busy" aria-label="Target slot" @update:model-value="(v) => setSide(n, r, 'to', { slot: String(v), axis: '', value: '' })" />
          <Select v-if="toKeyed(r)" size="sm" :model-value="r.to?.axis ?? ''" :options="axesOf(r.to?.slot ?? '')" :filterable="false" :disabled="busy" aria-label="Target axis" @update:model-value="(v) => setSide(n, r, 'to', { axis: String(v), value: '' })" />
          <Select v-if="toKeyed(r)" size="sm" :model-value="r.to?.value ?? ''" :options="valuesOf(r.to?.slot ?? '', r.to?.axis ?? '')" :filterable="false" :disabled="busy" aria-label="Target value" @update:model-value="(v) => setSide(n, r, 'to', { value: String(v) })" />
          <input v-if="r.kind === 'exclude' || r.kind === 'only' || r.kind === 'boost' || r.kind === 'reduce'" class="wp-input wp-input--sm" :value="(r.words ?? []).join(', ')" placeholder="about (sandals, shorts)" :disabled="busy" aria-label="What the rule is about" data-test="pack-relation-words" @change="pb.editRelation(n, { words: words(text($event)) })">
          <Input v-if="r.kind === 'boost' || r.kind === 'reduce'" type="number" size="sm" class="wp-pack-graph__rel-factor" :model-value="r.factor ?? (r.kind === 'boost' ? 3 : 0.3)" :min="0" :max="100" :step="0.1" :disabled="busy" aria-label="Factor" @update:model-value="(v) => pb.editRelation(n, { factor: Number(v) })" />
        </template>
        <button type="button" class="wp-pack-graph__icon" :disabled="busy" aria-label="Remove this rule" title="Remove this rule" data-test="pack-relation-remove" @click="pb.removeRelation(n)"><i class="pi pi-times" aria-hidden="true" /></button>
      </div>
      <button v-if="!slot" type="button" class="wp-pack-graph__link" :disabled="busy" data-test="pack-relation-add" @click="addRelation">Add a rule</button>
    </template>

    <template v-if="fixed">
      <label class="wp-pack-graph__field">
        <span>Text, every run</span>
        <input class="wp-input wp-input--sm" :value="fixed.text" :disabled="busy" data-test="pack-fixed-text" @change="setFixed({ text: text($event) })">
      </label>
      <label class="wp-pack-graph__field">
        <span>Negative</span>
        <input class="wp-input wp-input--sm" :value="fixed.negative" :disabled="busy" @change="setFixed({ negative: text($event) })">
      </label>
    </template>

    <template v-else-if="item.kind === 'template'">
      <label class="wp-pack-graph__field">
        <span>Always first</span>
        <input class="wp-input wp-input--sm" :value="graph.template.lead" placeholder="1girl, solo" :disabled="busy" data-test="pack-template-lead" @change="setTemplate({ lead: text($event) })">
      </label>
      <div class="wp-pack-graph__order" data-test="pack-template-order">
        <span class="wp-pack-graph__label">Reading order</span>
        <ol>
          <li v-for="(v, n) in graph.template.order" :key="v">
            <code>${{ v }}</code>
            <button type="button" class="wp-pack-graph__icon" :disabled="busy || n === 0" aria-label="Move up" @click="move(v, -1)"><i class="pi pi-chevron-up" aria-hidden="true" /></button>
            <button type="button" class="wp-pack-graph__icon" :disabled="busy || n === graph.template.order.length - 1" aria-label="Move down" data-test="pack-order-down" @click="move(v, 1)"><i class="pi pi-chevron-down" aria-hidden="true" /></button>
          </li>
        </ol>
      </div>
      <label class="wp-pack-graph__field">
        <span>Always last</span>
        <input class="wp-input wp-input--sm" :value="graph.template.tail" :disabled="busy" @change="setTemplate({ tail: text($event) })">
      </label>
      <label class="wp-pack-graph__field">
        <span>Standing negative</span>
        <input class="wp-input wp-input--sm" :value="graph.template.negative" :disabled="busy" data-test="pack-template-negative" @change="setTemplate({ negative: text($event) })">
      </label>
    </template>
  </div>
</template>

<style scoped>
.wp-pack-graph { display: flex; flex-direction: column; gap: 8px; }
.wp-pack-graph__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; align-items: end; }
.wp-pack-graph__field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.wp-pack-graph__field > span, .wp-pack-graph__label { font-size: 11px; color: var(--wp-text-dim); }
.wp-pack-graph__field input { width: 100%; }
.wp-pack-graph__check { display: flex; gap: 6px; align-items: center; font-size: 12.5px; padding-bottom: 4px; }
.wp-pack-graph__axes { display: flex; flex-direction: column; gap: 4px; }
.wp-pack-graph__axis { display: flex; gap: 6px; }
.wp-pack-graph__axis-name { flex: 0 0 120px; }
.wp-pack-graph__axis input:last-child { flex: 1; min-width: 0; }
.wp-pack-graph__rel { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding: 4px 0; border-top: 1px solid var(--wp-border); }
.wp-pack-graph__rel > * { min-width: 90px; }
.wp-pack-graph__rel-kind { min-width: 130px; }
.wp-pack-graph__rel-factor { max-width: 70px; min-width: 60px; }
.wp-pack-graph__rel-var { max-width: 110px; }
.wp-pack-graph__icon { flex: none; width: 24px; height: 24px; min-width: 24px; border: 0; border-radius: 6px; background: none; color: var(--wp-text-dim); cursor: pointer; }
.wp-pack-graph__icon:hover:not(:disabled) { color: var(--wp-text); background: var(--wp-bg-2); }
.wp-pack-graph__icon:disabled { opacity: 0.4; cursor: default; }
.wp-pack-graph__link { align-self: flex-start; border: 0; background: none; padding: 0; color: var(--wp-accent-text); cursor: pointer; font: inherit; font-size: 12px; text-decoration: underline; }
.wp-pack-graph__order ol { margin: 2px 0 0; padding-left: 22px; display: flex; flex-direction: column; gap: 2px; font-size: 12.5px; }
.wp-pack-graph__order li { display: flex; gap: 2px; align-items: center; }
.wp-pack-graph__order code { color: var(--wp-kind-wildcard); font-size: 12px; margin-right: 4px; }
</style>
