<script setup lang="ts">
/**
 * "Add module" popover for the Test Runner stack. Searches names, ids, tags
 * AND content (option values, templates, rule values), filters by kind and
 * sorts — the picker the old single-module dropdown never had.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { BundleRow, ModuleRow, ScenarioStackItem } from "../../api/types";
import { moduleBinding, searchText, type StackKind } from "../../utils/scenario";
import { KIND_META } from "./kinds";

const props = defineProps<{
  modules: ModuleRow[];
  bundles: BundleRow[];
}>();

const emit = defineEmits<{
  (e: "pick", item: ScenarioStackItem): void;
  (e: "close"): void;
}>();

type Sort = "updated" | "name" | "name-desc" | "created";
const SORTS: { value: Sort; label: string }[] = [
  { value: "updated", label: "Recently edited" },
  { value: "name", label: "Name A to Z" },
  { value: "name-desc", label: "Name Z to A" },
  { value: "created", label: "Newest" },
];
const KINDS: StackKind[] = ["wildcard", "combine", "derivation", "constraint", "fixed_values", "bundle"];

const query = ref("");
const kind = ref<StackKind | "all">("all");
const sort = ref<Sort>("updated");
const active = ref(0);
const root = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);

interface Entry {
  kind: StackKind; id: string; name: string; detail: string;
  updated: string; created: string; text: string; nameHit: boolean;
}

const entries = computed<Entry[]>(() => [
  ...props.modules.map((m) => ({
    kind: m.type as StackKind, id: m.id, name: m.name,
    detail: moduleBinding(m) ? `$${moduleBinding(m)}` : "",
    updated: m.updated_at, created: m.created_at, text: searchText(m), nameHit: false,
  })),
  ...props.bundles.map((b) => ({
    kind: "bundle" as const, id: b.id, name: b.name,
    detail: `${b.children.length} modules`,
    updated: b.updated_at, created: b.created_at, text: searchText(b), nameHit: false,
  })),
]);

const results = computed<Entry[]>(() => {
  const q = query.value.trim().toLowerCase();
  let list = entries.value.filter((e) => kind.value === "all" || e.kind === kind.value);
  if (q) {
    list = list
      .filter((e) => e.text.includes(q))
      .map((e) => ({ ...e, nameHit: e.name.toLowerCase().includes(q) || e.id.includes(q) }));
  }
  const byName = (a: Entry, b: Entry) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const sorted = [...list].sort((a, b) => {
    // Name matches first when searching; content-only matches after.
    if (q && a.nameHit !== b.nameHit) return a.nameHit ? -1 : 1;
    if (sort.value === "name") return byName(a, b);
    if (sort.value === "name-desc") return byName(b, a);
    if (sort.value === "created") return b.created.localeCompare(a.created);
    return b.updated.localeCompare(a.updated);
  });
  return sorted.slice(0, 200);
});

function pick(e: Entry): void {
  emit("pick", e.kind === "bundle" ? { bundle: e.id } : { module: e.id });
}

function onKey(ev: KeyboardEvent): void {
  if (ev.key === "Escape") { ev.preventDefault(); emit("close"); return; }
  if (ev.key === "ArrowDown") { ev.preventDefault(); active.value = Math.min(results.value.length - 1, active.value + 1); }
  if (ev.key === "ArrowUp") { ev.preventDefault(); active.value = Math.max(0, active.value - 1); }
  if (ev.key === "Enter") {
    ev.preventDefault();
    const e = results.value[active.value];
    if (e) pick(e);
  }
}

function onDocDown(ev: MouseEvent): void {
  if (root.value && !root.value.contains(ev.target as Node)) emit("close");
}

onMounted(() => {
  void nextTick(() => input.value?.focus());
  document.addEventListener("mousedown", onDocDown);
});
onBeforeUnmount(() => document.removeEventListener("mousedown", onDocDown));
</script>

<template>
  <div ref="root" class="wp-trp" role="dialog" aria-label="Add to stack" data-test="module-picker" @keydown="onKey">
    <input
      ref="input"
      v-model="query"
      class="wp-trp__search"
      type="search"
      placeholder="Search names and content…"
      aria-label="Search modules and bundles"
      data-test="picker-search"
      @input="active = 0"
    >
    <div class="wp-trp__kinds" role="group" aria-label="Kind">
      <button type="button" class="wp-trp__kind" :data-on="kind === 'all' ? 'true' : 'false'" @click="kind = 'all'; active = 0">All</button>
      <button
        v-for="k in KINDS"
        :key="k"
        type="button"
        class="wp-trp__kind"
        :data-on="kind === k ? 'true' : 'false'"
        :style="{ '--kc': KIND_META[k].color }"
        :data-test="`picker-kind-${k}`"
        @click="kind = k; active = 0"
      >{{ KIND_META[k].label }}</button>
    </div>
    <div class="wp-trp__bar">
      <span>{{ results.length }} {{ results.length === 1 ? "match" : "matches" }}</span>
      <label class="wp-trp__sort">Sort
        <select v-model="sort" aria-label="Sort" data-test="picker-sort">
          <option v-for="s in SORTS" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
      </label>
    </div>
    <ul class="wp-trp__list" role="listbox" aria-label="Results">
      <li
        v-for="(e, i) in results"
        :key="`${e.kind}:${e.id}`"
        role="option"
        :aria-selected="i === active"
        class="wp-trp__opt"
        :data-active="i === active ? 'true' : 'false'"
        :style="{ '--kc': KIND_META[e.kind].color }"
        data-test="picker-option"
        @mouseenter="active = i"
        @click="pick(e)"
      >
        <span class="wp-trp__dot" aria-hidden="true" />
        <span class="wp-trp__name">
          {{ e.name }}
          <span v-if="query && !e.nameHit" class="wp-trp__hint">matches content</span>
        </span>
        <span class="wp-trp__detail">{{ e.detail }}</span>
        <span class="wp-trp__k">{{ KIND_META[e.kind].label }}</span>
      </li>
      <li v-if="!results.length" class="wp-trp__none">Nothing matches.</li>
    </ul>
  </div>
</template>

<style scoped>
.wp-trp {
  position: absolute; z-index: 30; top: 100%; left: 0; margin-top: var(--wp-space-3);
  width: min(480px, 92vw);
  background: var(--wp-bg-1); border: 1px solid var(--wp-border-strong);
  border-radius: var(--wp-radius); box-shadow: 0 20px 40px rgba(0, 0, 0, .45);
  padding: var(--wp-space-5); display: flex; flex-direction: column; gap: var(--wp-space-4);
}
.wp-trp__search {
  width: 100%; background: var(--wp-bg-2); color: var(--wp-text);
  border: 1px solid var(--wp-border); border-radius: var(--wp-radius-sm);
  padding: var(--wp-space-4) var(--wp-space-5); font-size: var(--wp-text-base);
}
.wp-trp__search:focus-visible { outline: none; border-color: var(--wp-border-focus); }
.wp-trp__kinds { display: flex; flex-wrap: wrap; gap: var(--wp-space-2); }
.wp-trp__kind {
  border: 1px solid var(--wp-border); background: var(--wp-bg-2); color: var(--wp-text-muted);
  border-radius: 999px; padding: var(--wp-space-1) var(--wp-space-4); /* audit-exempt: pill */
  font-size: var(--wp-text-xs); cursor: pointer;
}
.wp-trp__kind[data-on="true"] { border-color: var(--kc, var(--wp-accent-500)); color: var(--kc, var(--wp-accent-text)); }
.wp-trp__kind:focus-visible { outline: 2px solid var(--wp-border-focus); }
.wp-trp__bar { display: flex; justify-content: space-between; align-items: center; font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-trp__sort { display: inline-flex; gap: var(--wp-space-3); align-items: center; }
.wp-trp__sort select {
  background: var(--wp-bg-2); color: var(--wp-text); border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm); font-size: var(--wp-text-xs); padding: var(--wp-space-1) var(--wp-space-3);
}
.wp-trp__list { list-style: none; margin: 0; padding: 0; max-height: 280px; overflow: auto; }
.wp-trp__opt {
  display: grid; grid-template-columns: 10px minmax(0, 1fr) auto auto; gap: var(--wp-space-4); align-items: center;
  padding: var(--wp-space-3) var(--wp-space-4); border-radius: var(--wp-radius-sm); cursor: pointer;
  font-size: var(--wp-text-sm);
}
.wp-trp__opt[data-active="true"] { background: var(--wp-bg-3); }
.wp-trp__dot { width: 8px; height: 8px; border-radius: 2px; background: var(--kc); } /* audit-exempt: swatch */
.wp-trp__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-trp__hint { margin-left: var(--wp-space-3); font-size: var(--wp-text-xs); color: var(--wp-text-dim); }
.wp-trp__detail { font-family: var(--wp-font-mono); font-size: var(--wp-text-xs); color: var(--wp-text-dim); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-trp__k { font-size: var(--wp-text-xs); color: var(--kc); }
.wp-trp__none { padding: var(--wp-space-5); color: var(--wp-text-muted); font-size: var(--wp-text-sm); }
</style>
