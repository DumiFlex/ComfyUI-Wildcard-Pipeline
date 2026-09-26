<script setup lang="ts">
/**
 * The scenario's stack: library modules and bundles that run top to bottom
 * (left to right here) like a Context node, plus pinned `$var` values that
 * stand in for whatever an upstream node would pass in.
 *
 * Each card can be switched off, removed, or dragged to a new place
 * (Alt + arrow keys move a focused card).
 */
import { computed, ref } from "vue";
import Button from "../ui/Button.vue";
import Icon, { ICON_SM } from "../ui/Icon.vue";
import Toggle from "../ui/Toggle.vue";
import ModulePicker from "./ModulePicker.vue";
import { KIND_META } from "./kinds";
import type { BundleRow, ModuleRow, ScenarioStackItem } from "../../api/types";
import type { StackItemView } from "../../utils/scenario";

const props = defineProps<{
  stack: ScenarioStackItem[];
  views: StackItemView[];
  pins: Record<string, string>;
  modules: ModuleRow[];
  bundles: BundleRow[];
}>();

const emit = defineEmits<{
  (e: "update:stack", v: ScenarioStackItem[]): void;
  (e: "update:pins", v: Record<string, string>): void;
}>();

const pickerOpen = ref(false);

function add(item: ScenarioStackItem): void {
  emit("update:stack", [...props.stack, item]);
  pickerOpen.value = false;
}

function moveTo(from: number, to: number): void {
  if (from === to || to < 0 || to >= props.stack.length) return;
  const next = [...props.stack];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  emit("update:stack", next);
}

function onCardKey(e: KeyboardEvent, i: number): void {
  if (!e.altKey) return;
  if (e.key === "ArrowLeft") { e.preventDefault(); moveTo(i, i - 1); }
  else if (e.key === "ArrowRight") { e.preventDefault(); moveTo(i, i + 1); }
}

/* Drag to reorder: the card being dragged and the slot it would land in. */
const dragFrom = ref<number | null>(null);
const dragOver = ref<number | null>(null);

function onDragStart(e: DragEvent, i: number): void {
  dragFrom.value = i;
  e.dataTransfer?.setData("text/plain", String(i));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}
function onDrop(i: number): void {
  if (dragFrom.value !== null) moveTo(dragFrom.value, i);
  dragFrom.value = null;
  dragOver.value = null;
}
function onDragEnd(): void {
  dragFrom.value = null;
  dragOver.value = null;
}

function setEnabled(i: number, on: boolean): void {
  // "On" is the default, so drop the key rather than store `enabled: true`:
  // switching a card off and on again leaves the scenario unchanged.
  const next = props.stack.map((it, k) => {
    if (k !== i) return it;
    const { enabled: _was, ...rest } = it;
    return on ? rest : { ...rest, enabled: false };
  });
  emit("update:stack", next);
}

function removeAt(i: number): void {
  emit("update:stack", props.stack.filter((_, k) => k !== i));
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
      <span class="wp-trs__sub">runs left to right, like the modules on a Context node · drag to reorder</span>
    </header>

    <ol class="wp-trs__cards">
      <li
        v-for="(v, i) in views"
        :key="`${i}:${v.id}`"
        class="wp-trs__card"
        :style="{ '--kc': KIND_META[v.kind].color }"
        :data-off="v.enabled ? 'false' : 'true'"
        :data-missing="v.missing ? 'true' : 'false'"
        :data-dragging="dragFrom === i ? 'true' : 'false'"
        :data-drop="dragOver === i && dragFrom !== i ? 'true' : 'false'"
        :aria-label="`${i + 1}. ${KIND_META[v.kind].label} ${v.name}`"
        title="Drag to reorder, or Alt + arrow keys"
        tabindex="0"
        draggable="true"
        data-test="stack-card"
        @dragstart="onDragStart($event, i)"
        @dragover.prevent="dragOver = i"
        @dragleave="dragOver = dragOver === i ? null : dragOver"
        @drop.prevent="onDrop(i)"
        @dragend="onDragEnd"
        @keydown="onCardKey($event, i)"
      >
        <div class="wp-trs__top">
          <span class="wp-trs__step">{{ i + 1 }}</span>
          <span class="wp-trs__kind">{{ KIND_META[v.kind].label }}</span>
          <Toggle
            class="wp-trs__switch"
            :model-value="v.enabled"
            :aria-label="v.enabled ? `Switch off ${v.name}` : `Switch on ${v.name}`"
            data-test="stack-toggle"
            @update:model-value="(on: boolean) => setEnabled(i, on)"
          />
        </div>
        <span class="wp-trs__name">{{ v.name }}</span>
        <span class="wp-trs__detail">{{ v.missing ? "deleted from the library" : v.enabled ? v.detail : "switched off" }}</span>
        <button
          type="button"
          class="wp-trs__remove"
          :aria-label="`Remove ${v.name}`"
          title="Remove"
          data-test="stack-remove"
          @click="removeAt(i)"
        ><Icon name="pi-times" :size="ICON_SM" /></button>
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
        Stand in for a value an upstream node would pass in, e.g. <code>$subject</code>.
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
  display: flex; flex-wrap: wrap; gap: var(--wp-space-5); align-items: stretch;
}
.wp-trs__card {
  position: relative; width: 196px;
  background: var(--wp-bg-3); border: 1px solid var(--wp-border); border-radius: var(--wp-radius);
  box-shadow: inset 3px 0 0 var(--kc);
  padding: var(--wp-space-4) var(--wp-space-5) var(--wp-space-5) var(--wp-space-6);
  display: flex; flex-direction: column; gap: var(--wp-space-2);
  cursor: grab; transition: border-color .12s, opacity .12s;
}
.wp-trs__card:hover { border-color: var(--wp-border-strong); }
.wp-trs__card:focus-visible { outline: 2px solid var(--wp-border-focus); outline-offset: 1px; }
.wp-trs__card[data-dragging="true"] { opacity: .4; cursor: grabbing; }
.wp-trs__card[data-drop="true"] { border-color: var(--wp-accent-500); }
.wp-trs__card[data-off="true"] { box-shadow: inset 3px 0 0 var(--wp-border-strong); }
.wp-trs__card[data-off="true"] .wp-trs__name,
.wp-trs__card[data-off="true"] .wp-trs__kind { opacity: .5; }
.wp-trs__card[data-missing="true"] { border-style: dashed; box-shadow: inset 3px 0 0 var(--wp-danger); }
.wp-trs__top { display: flex; align-items: center; gap: var(--wp-space-3); min-height: 20px; }
.wp-trs__step {
  font: var(--wp-weight-semibold) var(--wp-text-xs) var(--wp-font-mono);
  color: var(--wp-text-dim); font-variant-numeric: tabular-nums;
}
.wp-trs__kind {
  flex: 1; font: var(--wp-weight-medium) var(--wp-text-xs) var(--wp-font-mono);
  color: var(--kc); text-transform: uppercase; letter-spacing: .05em;
}
.wp-trs__switch { flex: none; min-height: 0; }
/* A quieter, smaller switch than the form one: seven of them sit in a row. */
.wp-trs__switch :deep(.wp-toggle) { width: 26px; height: 14px; }
.wp-trs__switch :deep(.wp-toggle)::after { width: 10px; height: 10px; }
.wp-trs__switch :deep(.wp-toggle[data-on="true"]) {
  background: color-mix(in oklab, var(--wp-accent-600) 55%, var(--wp-bg-3));
  border-color: color-mix(in oklab, var(--wp-accent-500) 60%, var(--wp-border));
}
.wp-trs__switch :deep(.wp-toggle[data-on="true"])::after { transform: translateX(12px); }
.wp-trs__name {
  font-weight: var(--wp-weight-medium); line-height: var(--wp-line-base);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.wp-trs__detail { font: var(--wp-text-xs) var(--wp-font-mono); color: var(--wp-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-trs__card[data-missing="true"] .wp-trs__detail { color: var(--wp-danger-text); }
.wp-trs__remove {
  position: absolute; top: calc(-1 * var(--wp-space-4)); right: calc(-1 * var(--wp-space-4));
  width: 22px; height: 22px; border-radius: 50%; /* audit-exempt: round close badge */
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
  background: var(--wp-bg-4); color: var(--wp-text-muted); border: 1px solid var(--wp-border-strong);
  opacity: 0; transition: opacity .12s;
}
.wp-trs__card:hover .wp-trs__remove, .wp-trs__card:focus-within .wp-trs__remove { opacity: 1; }
.wp-trs__remove:hover { color: var(--wp-danger-text); border-color: var(--wp-danger); }
.wp-trs__remove:focus-visible { opacity: 1; outline: 2px solid var(--wp-border-focus); }
@media (hover: none) { .wp-trs__remove { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .wp-trs__card, .wp-trs__remove { transition: none; } }
.wp-trs__add-wrap { position: relative; display: flex; }
.wp-trs__add {
  min-width: 160px; border: 1px dashed var(--wp-border-strong); background: none;
  border-radius: var(--wp-radius); color: var(--wp-text-muted); cursor: pointer;
  padding: var(--wp-space-5); display: inline-flex; align-items: center; gap: var(--wp-space-3);
  font-size: var(--wp-text-sm);
}
.wp-trs__add:hover { border-color: var(--wp-accent-500); color: var(--wp-accent-text); }
.wp-trs__add:focus-visible { outline: 2px solid var(--wp-border-focus); }
.wp-trs__pins {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--wp-space-4);
  padding: var(--wp-space-4) var(--wp-space-6); font-size: var(--wp-text-sm);
  border-top: 1px solid var(--wp-border); background: var(--wp-bg-1);
  border-radius: 0 0 var(--wp-radius) var(--wp-radius);
}
.wp-trs__pins-label {
  font-size: var(--wp-text-xs); font-weight: var(--wp-weight-semibold);
  letter-spacing: .08em; text-transform: uppercase; color: var(--wp-text-muted);
}
.wp-trs__pins-hint code { color: var(--wp-text-muted); }
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
