<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Input from "./ui/Input.vue";
import type { CategoryRow, ModuleRow, ModuleType } from "../api/types";

interface Props {
  visible: boolean;
  modules: ModuleRow[];
  categories?: CategoryRow[];
}

const props = withDefaults(defineProps<Props>(), { categories: () => [] });
const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "pick", module: ModuleRow): void;
}>();

interface KindMeta {
  type: ModuleType | "all";
  label: string;
  icon: string;
}

const KIND_TABS: KindMeta[] = [
  { type: "all",          label: "All",           icon: "pi pi-objects-column" },
  { type: "wildcard",     label: "Wildcards",     icon: "pi pi-th-large" },
  { type: "fixed_values", label: "Fixed Values",  icon: "pi pi-tag" },
  { type: "combine",      label: "Combines",      icon: "pi pi-share-alt" },
  { type: "derivation",   label: "Derivations",   icon: "pi pi-code" },
  { type: "constraint",   label: "Constraints",   icon: "pi pi-sitemap" },
];

const KIND_ICON: Record<ModuleType, string> = {
  wildcard: "pi pi-th-large",
  fixed_values: "pi pi-tag",
  combine: "pi pi-share-alt",
  derivation: "pi pi-code",
  constraint: "pi pi-sitemap",
  pipeline: "pi pi-list",
};

const activeTab = ref<ModuleType | "all">("all");
const search = ref("");

watch(() => props.visible, (v) => {
  if (v) {
    activeTab.value = "all";
    search.value = "";
  }
});

const counts = computed<Record<string, number>>(() => {
  const c: Record<string, number> = { all: 0 };
  for (const tab of KIND_TABS) c[tab.type] = 0;
  for (const m of props.modules) {
    if (m.type === "pipeline") continue;
    c.all += 1;
    c[m.type] = (c[m.type] ?? 0) + 1;
  }
  return c;
});

const filtered = computed<ModuleRow[]>(() => {
  const q = search.value.trim().toLowerCase();
  return props.modules.filter((m) => {
    if (m.type === "pipeline") return false;
    if (activeTab.value !== "all" && m.type !== activeTab.value) return false;
    if (!q) return true;
    if (m.name.toLowerCase().includes(q)) return true;
    if (m.id.toLowerCase().includes(q)) return true;
    if ((m.tags ?? []).some((t) => t.toLowerCase().includes(q))) return true;
    return false;
  });
});

const categoryById = computed<Map<string, CategoryRow>>(() => {
  const m = new Map<string, CategoryRow>();
  for (const c of props.categories) m.set(c.id, c);
  return m;
});

function pick(m: ModuleRow) {
  emit("pick", m);
}

function close() {
  emit("update:visible", false);
}

function kindLabel(t: ModuleType): string {
  const tab = KIND_TABS.find((x) => x.type === t);
  return tab?.label ?? t;
}

// Esc closes when visible.
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && props.visible) close();
}
watch(() => props.visible, (v) => {
  if (typeof window === "undefined") return;
  if (v) {
    window.addEventListener("keydown", onKeydown);
    document.body.style.overflow = "hidden";
  } else {
    window.removeEventListener("keydown", onKeydown);
    document.body.style.overflow = "";
  }
});
onBeforeUnmount(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("keydown", onKeydown);
    document.body.style.overflow = "";
  }
});
</script>

<template>
  <Teleport v-if="visible" to="body">
    <div class="wp-pl-picker__backdrop" data-test="pipeline-picker" @mousedown.self="close">
    <div class="wp-pl-picker" @mousedown.stop>
      <div class="wp-pl-picker__head">
        <i class="pi pi-plus" />
        <span class="wp-pl-picker__title">Add module to pipeline</span>
        <button
          type="button"
          class="wp-pl-picker__close"
          aria-label="Close picker"
          @click="close"
        >
          <i class="pi pi-times" />
        </button>
      </div>

      <div class="wp-pl-picker__body">
        <div class="wp-pl-picker__tabs" role="tablist" aria-label="Module kind">
          <button
            v-for="tab in KIND_TABS"
            :key="tab.type"
            type="button"
            role="tab"
            class="wp-pl-tab"
            :data-kind="tab.type"
            :data-active="activeTab === tab.type ? '' : null"
            :aria-selected="activeTab === tab.type"
            :data-test="`picker-tab-${tab.type}`"
            @click="activeTab = tab.type"
          >
            <i :class="tab.icon" />
            <span class="wp-pl-tab__label">{{ tab.label }}</span>
            <span class="wp-pl-tab__count">{{ counts[tab.type] ?? 0 }}</span>
          </button>
        </div>

        <div class="wp-pl-picker__search">
          <span class="wp-pl-picker__searchicon"><i class="pi pi-search" /></span>
          <Input
            v-model="search"
            placeholder="Search modules…"
            class="wp-pl-picker__searchinput"
            aria-label="Search modules"
            data-test="picker-search"
          />
        </div>

        <div class="wp-pl-picker__list" data-test="picker-list">
          <div v-if="!filtered.length" class="wp-pl-picker__empty">
            No modules match.
          </div>
          <button
            v-for="m in filtered"
            :key="m.id"
            type="button"
            class="wp-pl-pickrow"
            :data-kind="m.type"
            :data-test="`picker-row-${m.id}`"
            @click="pick(m)"
          >
            <span class="wp-pl-pickrow__icon" aria-hidden="true">
              <i :class="KIND_ICON[m.type] ?? 'pi pi-circle'" />
            </span>
            <div class="wp-pl-pickrow__main">
              <div class="wp-pl-pickrow__name">{{ m.name }}</div>
              <div class="wp-pl-pickrow__id">{{ kindLabel(m.type) }} · {{ m.id }}</div>
            </div>
            <span
              v-if="m.category_id && categoryById.get(m.category_id)"
              class="wp-pl-pickrow__cat"
              :style="{ background: categoryById.get(m.category_id)!.color || 'var(--wp-bg-3)' }"
            >{{ categoryById.get(m.category_id)!.name }}</span>
            <span class="wp-pl-pickrow__add" aria-hidden="true">
              <i class="pi pi-plus" />
            </span>
          </button>
        </div>
      </div>
    </div>
    </div>
  </Teleport>
</template>

<style scoped>
.wp-pl-picker__backdrop {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: var(--wp-overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.wp-pl-picker {
  display: flex;
  flex-direction: column;
  width: 640px;
  max-width: 100%;
  max-height: 80vh;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg, 12px);
  overflow: hidden;
}

.wp-pl-picker__head {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--wp-border);
  background: var(--wp-bg);
}
.wp-pl-picker__title {
  font-weight: 600;
  flex: 1;
}
.wp-pl-picker__close {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--wp-text-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}
.wp-pl-picker__close:hover {
  background: var(--wp-bg-3);
  color: var(--wp-text);
  border-color: var(--wp-border);
}

.wp-pl-picker__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  min-height: 0;
  overflow: hidden;
}

.wp-pl-picker__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex-shrink: 0;
}
.wp-pl-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-bottom: 2px solid transparent;
  border-radius: var(--wp-radius-sm, 6px);
  color: var(--wp-text-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  flex: 0 1 auto;
  min-width: 0;
}
.wp-pl-tab[data-kind="wildcard"][data-active]     { border-bottom-color: var(--wp-kind-wildcard); color: var(--wp-kind-wildcard); }
.wp-pl-tab[data-kind="fixed_values"][data-active] { border-bottom-color: var(--wp-kind-fixed); color: var(--wp-kind-fixed); }
.wp-pl-tab[data-kind="combine"][data-active]      { border-bottom-color: var(--wp-kind-combine); color: var(--wp-kind-combine); }
.wp-pl-tab[data-kind="derivation"][data-active]   { border-bottom-color: var(--wp-kind-derivation); color: var(--wp-kind-derivation); }
.wp-pl-tab[data-kind="constraint"][data-active]   { border-bottom-color: var(--wp-kind-constraint); color: var(--wp-kind-constraint); }
.wp-pl-tab[data-kind="all"][data-active]          { border-bottom-color: var(--wp-accent-500); color: var(--wp-text); }
.wp-pl-tab:hover {
  background: var(--wp-bg-3);
  color: var(--wp-text);
}
.wp-pl-tab__label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.wp-pl-tab__count {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 10.5px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  color: var(--wp-text-dim);
  min-width: 18px;
  text-align: center;
}

/* Avoid the prototype's input-group flex collapse bug. */
.wp-pl-picker__search {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm, 6px);
  background: var(--wp-bg);
  overflow: hidden;
  flex-shrink: 0;
  min-height: var(--wp-input-h, 38px);
  height: 38px;
}
.wp-pl-picker__searchicon {
  display: flex; align-items: center; justify-content: center;
  padding: 0 12px;
  color: var(--wp-text-muted);
  font-size: 14px;
}
.wp-pl-picker__searchinput {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--wp-text);
  font-size: 13px;
  padding: 0 8px;
  height: 100%;
}
:deep(.wp-pl-picker__searchinput.wp-input) {
  border: none;
  background: transparent;
  height: 100%;
  width: 100%;
  box-shadow: none;
  outline: none;
  padding: 0 8px;
  color: var(--wp-text);
  font-size: 13px;
}

.wp-pl-picker__list {
  overflow-y: auto;
  overflow-x: hidden;
  border: 1px solid var(--wp-border);
  border-radius: 8px;
  background: var(--wp-bg);
  flex: 1;
  min-height: 200px;
  display: flex;
  flex-direction: column;
}
.wp-pl-picker__empty {
  padding: 24px;
  text-align: center;
  font-size: 12px;
  color: var(--wp-text-dim);
}

.wp-pl-pickrow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  background: var(--wp-bg-2);
  border: none;
  border-bottom: 1px solid var(--wp-border);
  cursor: pointer;
  text-align: left;
  width: 100%;
  font-size: 13px;
  color: var(--wp-text);
  min-width: 0;
}
.wp-pl-pickrow:last-child { border-bottom: none; }
.wp-pl-pickrow:hover { background: var(--wp-bg-3); }
.wp-pl-pickrow__icon {
  width: 28px; height: 28px;
  border-radius: var(--wp-radius-sm, 6px);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  background: var(--wp-bg-3);
  color: var(--wp-text-muted);
  font-size: 14px;
}
.wp-pl-pickrow[data-kind="wildcard"]     .wp-pl-pickrow__icon { background: var(--wp-kind-wildcard-bg); color: var(--wp-kind-wildcard); }
.wp-pl-pickrow[data-kind="fixed_values"] .wp-pl-pickrow__icon { background: var(--wp-kind-fixed-bg); color: var(--wp-kind-fixed); }
.wp-pl-pickrow[data-kind="combine"]      .wp-pl-pickrow__icon { background: var(--wp-kind-combine-bg); color: var(--wp-kind-combine); }
.wp-pl-pickrow[data-kind="derivation"]   .wp-pl-pickrow__icon { background: var(--wp-kind-derivation-bg); color: var(--wp-kind-derivation); }
.wp-pl-pickrow[data-kind="constraint"]   .wp-pl-pickrow__icon { background: var(--wp-kind-constraint-bg); color: var(--wp-kind-constraint); }

.wp-pl-pickrow__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.wp-pl-pickrow__name {
  font-weight: 500;
  font-size: 13px;
  color: var(--wp-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wp-pl-pickrow__id {
  font-size: 11px;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  color: var(--wp-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wp-pl-pickrow__cat {
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 9px;
  color: #fff;
  font-weight: 500;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.4);
}
.wp-pl-pickrow__add {
  width: 22px; height: 22px;
  border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  background: var(--wp-bg-3);
  color: var(--wp-text-muted);
  font-size: 11px;
  flex-shrink: 0;
}
.wp-pl-pickrow:hover .wp-pl-pickrow__add {
  background: var(--wp-accent-500, var(--wp-bg-3));
  color: #fff;
}
</style>
