<script setup lang="ts">
/**
 * The scenario's stack: library modules and bundles that run top to bottom
 * (left to right here) like a Context node, plus pinned `$var` values that
 * stand in for whatever an upstream node would pass in.
 *
 * Each card can be moved, switched off, removed, or chosen as the output
 * the Outputs tab renders.
 */
import { computed, ref } from "vue";
import Button from "../ui/Button.vue";
import Icon, { ICON_SM } from "../ui/Icon.vue";
import ModulePicker from "./ModulePicker.vue";
import { KIND_META } from "./kinds";
import type { BundleRow, ModuleRow, ScenarioStackItem } from "../../api/types";
import type { StackItemView } from "../../utils/scenario";

const props = defineProps<{
  stack: ScenarioStackItem[];
  views: StackItemView[];
  pins: Record<string, string>;
  outputVar: string | null;
  /** True when the output follows the stack rather than a user choice. */
  outputIsDefault: boolean;
  modules: ModuleRow[];
  bundles: BundleRow[];
}>();

const emit = defineEmits<{
  (e: "update:stack", v: ScenarioStackItem[]): void;
  (e: "update:pins", v: Record<string, string>): void;
  (e: "update:outputVar", v: string | null): void;
}>();

const pickerOpen = ref(false);

function add(item: ScenarioStackItem): void {
  emit("update:stack", [...props.stack, item]);
  pickerOpen.value = false;
}

function move(i: number, delta: number): void {
  const j = i + delta;
  if (j < 0 || j >= props.stack.length) return;
  const next = [...props.stack];
  [next[i], next[j]] = [next[j], next[i]];
  emit("update:stack", next);
}

function toggle(i: number): void {
  const next = props.stack.map((it, k) => (k === i ? { ...it, enabled: it.enabled === false } : it));
  emit("update:stack", next);
}

function removeAt(i: number): void {
  emit("update:stack", props.stack.filter((_, k) => k !== i));
}

function chooseOutput(v: StackItemView): void {
  if (!v.binding) return;
  emit("update:outputVar", props.outputVar === v.binding && !props.outputIsDefault ? null : v.binding);
}

/* ---------------------------- pins ---------------------------- */

const pinName = ref("");
const pinValue = ref("");
const pinFormOpen = ref(false);
const pinEntries = computed(() => Object.entries(props.pins));
const pinNameValid = computed(() => /^\$?[A-Za-z_][A-Za-z0-9_]*$/.test(pinName.value.trim()));

function addPin(): void {
  if (!pinNameValid.value) return;
  const name = pinName.value.trim().replace(/^\$/, "");
  emit("update:pins", { ...props.pins, [name]: pinValue.value });
  pinName.value = "";
  pinValue.value = "";
  pinFormOpen.value = false;
}

function removePin(name: string): void {
  const next = { ...props.pins };
  delete next[name];
  emit("update:pins", next);
}
</script>

<template>
  <section class="wp-trs" aria-label="Stack" data-test="stack-builder">
    <header class="wp-trs__head">
      <h3>Stack</h3>
      <span class="wp-trs__sub">runs left to right, like a Context node</span>
    </header>

    <ol class="wp-trs__cards">
      <li
        v-for="(v, i) in views"
        :key="`${i}:${v.id}`"
        class="wp-trs__card"
        :style="{ '--kc': KIND_META[v.kind].color }"
        :data-off="v.enabled ? 'false' : 'true'"
        :data-missing="v.missing ? 'true' : 'false'"
        :data-output="v.binding && v.binding === outputVar ? 'true' : 'false'"
        data-test="stack-card"
      >
        <span class="wp-trs__kind">{{ KIND_META[v.kind].label }}</span>
        <span class="wp-trs__name" :title="v.name">{{ v.name }}</span>
        <span class="wp-trs__detail">{{ v.missing ? "deleted from the library" : v.detail }}</span>
        <span v-if="v.binding && v.binding === outputVar" class="wp-trs__out">output</span>
        <span class="wp-trs__acts">
          <button type="button" :aria-label="`Move ${v.name} earlier`" :disabled="i === 0" @click="move(i, -1)"><Icon name="pi-arrow-left" :size="ICON_SM" /></button>
          <button type="button" :aria-label="`Move ${v.name} later`" :disabled="i === views.length - 1" @click="move(i, 1)"><Icon name="pi-arrow-right" :size="ICON_SM" /></button>
          <button
            v-if="v.binding"
            type="button"
            :aria-label="`Use $${v.binding} as the output`"
            :data-on="v.binding === outputVar ? 'true' : 'false'"
            data-test="stack-output"
            @click="chooseOutput(v)"
          ><Icon name="pi-flag" :size="ICON_SM" /></button>
          <button
            type="button"
            :aria-label="v.enabled ? `Switch off ${v.name}` : `Switch on ${v.name}`"
            data-test="stack-toggle"
            @click="toggle(i)"
          ><Icon :name="v.enabled ? 'pi-eye' : 'pi-eye-slash'" :size="ICON_SM" /></button>
          <button type="button" :aria-label="`Remove ${v.name}`" data-test="stack-remove" @click="removeAt(i)"><Icon name="pi-times" :size="ICON_SM" /></button>
        </span>
      </li>
      <li class="wp-trs__add-wrap">
        <button
          type="button"
          class="wp-trs__add"
          :aria-expanded="pickerOpen"
          data-test="stack-add"
          @click="pickerOpen = !pickerOpen"
        ><Icon name="pi-plus" :size="ICON_SM" /> Add module or bundle</button>
        <ModulePicker
          v-if="pickerOpen"
          :modules="modules"
          :bundles="bundles"
          @pick="add"
          @close="pickerOpen = false"
        />
      </li>
    </ol>

    <div class="wp-trs__pins" data-test="pins">
      <span class="wp-trs__pins-label">Pinned values</span>
      <span v-for="[name, value] in pinEntries" :key="name" class="wp-trs__pin" data-test="pin">
        <code>${{ name }}</code> = <span class="wp-trs__pin-val">"{{ value }}"</span>
        <button type="button" :aria-label="`Remove pin $${name}`" @click="removePin(name)"><Icon name="pi-times" :size="ICON_SM" /></button>
      </span>
      <span v-if="!pinEntries.length && !pinFormOpen" class="wp-trs__pins-hint">
        none: pin a $var to stand in for a value an upstream node would pass in
      </span>
      <form v-if="pinFormOpen" class="wp-trs__pin-form" @submit.prevent="addPin">
        <input id="wp-tr-pin-name" v-model="pinName" placeholder="$name" aria-label="Variable name" data-test="pin-name">
        <span>=</span>
        <input id="wp-tr-pin-value" v-model="pinValue" placeholder="value" aria-label="Pinned value" data-test="pin-value">
        <Button size="sm" type="submit" :disabled="!pinNameValid" data-test="pin-add">Pin</Button>
        <Button size="sm" variant="ghost" @click="pinFormOpen = false">Cancel</Button>
      </form>
      <Button v-else variant="ghost" size="sm" icon="pi-plus" data-test="pin-open" @click="pinFormOpen = true">Pin a value</Button>
    </div>
  </section>
</template>

<style scoped>
.wp-trs {
  background: var(--wp-bg-2); border: 1px solid var(--wp-border); border-radius: var(--wp-radius);
  display: flex; flex-direction: column;
}
.wp-trs__head {
  display: flex; align-items: baseline; gap: var(--wp-space-5);
  padding: var(--wp-space-5) var(--wp-space-6); border-bottom: 1px solid var(--wp-border);
}
.wp-trs__head h3 {
  margin: 0; font-size: var(--wp-text-xs); font-weight: var(--wp-weight-semibold);
  letter-spacing: .08em; text-transform: uppercase; color: var(--wp-text-muted);
}
.wp-trs__sub { font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-trs__cards {
  list-style: none; margin: 0; padding: var(--wp-space-6);
  display: flex; flex-wrap: wrap; gap: var(--wp-space-4); align-items: stretch;
}
.wp-trs__card {
  position: relative; min-width: 128px; max-width: 220px;
  background: var(--wp-bg-3); border: 1px solid var(--wp-border);
  border-top: 3px solid var(--kc); border-radius: var(--wp-radius);
  padding: var(--wp-space-4) var(--wp-space-5) var(--wp-space-3);
  display: flex; flex-direction: column; gap: var(--wp-space-1);
}
.wp-trs__card[data-off="true"] { opacity: .45; }
.wp-trs__card[data-missing="true"] { border-style: dashed; border-top-style: solid; border-top-color: var(--wp-danger); }
.wp-trs__card[data-output="true"] { box-shadow: 0 0 0 1px var(--wp-accent-500); }
.wp-trs__kind {
  font: var(--wp-weight-medium) var(--wp-text-xs) var(--wp-font-mono);
  color: var(--kc); text-transform: uppercase; letter-spacing: .05em;
}
.wp-trs__name { font-weight: var(--wp-weight-medium); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-trs__detail { font: var(--wp-text-xs) var(--wp-font-mono); color: var(--wp-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-trs__card[data-missing="true"] .wp-trs__detail { color: var(--wp-danger-text); }
.wp-trs__out {
  position: absolute; top: -9px; right: var(--wp-space-4); /* audit-exempt: badge straddles the top border */
  background: var(--wp-accent-600); color: #fff;
  font: var(--wp-weight-semibold) 9px/14px var(--wp-font-mono); /* audit-exempt: badge text */
  padding: 0 var(--wp-space-3); border-radius: 999px; text-transform: uppercase; /* audit-exempt: pill */
}
.wp-trs__acts { display: flex; gap: var(--wp-space-1); margin-top: var(--wp-space-2); opacity: .55; transition: opacity .12s; }
.wp-trs__card:hover .wp-trs__acts, .wp-trs__card:focus-within .wp-trs__acts { opacity: 1; }
.wp-trs__acts button {
  background: none; border: 0; color: var(--wp-text-muted); cursor: pointer;
  padding: var(--wp-space-1); border-radius: var(--wp-radius-sm); display: inline-flex;
}
.wp-trs__acts button:hover:not(:disabled) { color: var(--wp-text); background: var(--wp-bg-4); }
.wp-trs__acts button:disabled { opacity: .35; cursor: default; }
.wp-trs__acts button[data-on="true"] { color: var(--wp-accent-text); }
.wp-trs__acts button:focus-visible { outline: 2px solid var(--wp-border-focus); }
.wp-trs__add-wrap { position: relative; display: flex; }
.wp-trs__add {
  min-width: 128px; border: 1px dashed var(--wp-border-strong); background: none;
  border-radius: var(--wp-radius); color: var(--wp-text-muted); cursor: pointer;
  padding: var(--wp-space-5); display: inline-flex; align-items: center; gap: var(--wp-space-3);
  font-size: var(--wp-text-sm);
}
.wp-trs__add:hover { border-color: var(--wp-accent-500); color: var(--wp-accent-text); }
.wp-trs__add:focus-visible { outline: 2px solid var(--wp-border-focus); }
.wp-trs__pins {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--wp-space-4);
  padding: 0 var(--wp-space-6) var(--wp-space-6); font-size: var(--wp-text-sm);
}
.wp-trs__pins-label { color: var(--wp-text-muted); }
.wp-trs__pins-hint { color: var(--wp-text-dim); font-size: var(--wp-text-xs); }
.wp-trs__pin {
  display: inline-flex; align-items: center; gap: var(--wp-space-2);
  font: var(--wp-text-sm) var(--wp-font-mono);
  background: var(--wp-bg-3); border: 1px solid var(--wp-border); border-radius: var(--wp-radius-sm);
  padding: var(--wp-space-1) var(--wp-space-3) var(--wp-space-1) var(--wp-space-4);
}
.wp-trs__pin code { color: var(--wp-accent-text); }
.wp-trs__pin-val { color: var(--wp-success); }
.wp-trs__pin button { background: none; border: 0; color: var(--wp-text-dim); cursor: pointer; display: inline-flex; padding: var(--wp-space-1); }
.wp-trs__pin button:hover { color: var(--wp-text); }
.wp-trs__pin-form { display: inline-flex; align-items: center; gap: var(--wp-space-3); }
.wp-trs__pin-form input {
  background: var(--wp-bg-1); color: var(--wp-text); border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm); padding: var(--wp-space-2) var(--wp-space-4);
  font: var(--wp-text-sm) var(--wp-font-mono); width: 150px;
}
.wp-trs__pin-form input:focus-visible { outline: none; border-color: var(--wp-border-focus); }
</style>
