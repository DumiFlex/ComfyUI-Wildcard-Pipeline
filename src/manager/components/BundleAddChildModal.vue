<script setup lang="ts">
/**
 * BundleAddChildModal — library picker for adding a frozen snapshot of
 * a module to the bundle's children. Modeled on PipelineStepPicker:
 * teleport-based overlay, kind-filter tabs + search, click a row to
 * pick. Pipelines are excluded — bundles flatten module instances, not
 * pipeline references.
 *
 * Parent (BundleEditor) takes the emitted ModuleRow, builds a snapshot,
 * and appends to `children[]`.
 */
import { computed, ref, watch } from "vue";
import Input from "./ui/Input.vue";
import { kindIcon } from "../../components/shared/kind-icons";
import type { ModuleRow, ModuleType } from "../api/types";

interface Props {
  visible: boolean;
  modules: ModuleRow[];
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "pick", row: ModuleRow): void;
}>();

interface KindTab {
  type: ModuleType | "all";
  label: string;
  icon: string;
}

const KIND_TABS: KindTab[] = [
  { type: "all",          label: "All",           icon: "pi pi-objects-column" },
  { type: "wildcard",     label: "Wildcards",     icon: "pi pi-sparkles" },
  { type: "fixed_values", label: "Fixed Values",  icon: "pi pi-tag" },
  { type: "combine",      label: "Combines",      icon: "pi pi-link" },
  { type: "derivation",   label: "Derivations",   icon: "pi pi-arrow-right-arrow-left" },
  { type: "constraint",   label: "Constraints",   icon: "pi pi-filter" },
];

const KIND_LABEL: Record<ModuleType, string> = {
  wildcard:     "Wildcard",
  fixed_values: "Fixed values",
  combine:      "Combine",
  derivation:   "Derivation",
  constraint:   "Constraint",
  pipeline:     "Pipeline",
};

const activeTab = ref<ModuleType | "all">("all");
const search = ref("");

watch(() => props.visible, (v) => {
  if (v) {
    activeTab.value = "all";
    search.value = "";
  }
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

const counts = computed<Record<string, number>>(() => {
  const c: Record<string, number> = { all: 0 };
  for (const t of KIND_TABS) c[t.type] = 0;
  for (const m of props.modules) {
    if (m.type === "pipeline") continue;
    c.all += 1;
    c[m.type] = (c[m.type] ?? 0) + 1;
  }
  return c;
});

function close() { emit("close"); }
function pick(row: ModuleRow) {
  emit("pick", row);
  emit("close");
}
</script>

<template>
  <Teleport v-if="visible" to="body">
    <div
      class="wp-bundle-add__backdrop"
      data-test="bundle-add-backdrop"
      @mousedown.self="close"
    >
      <div class="wp-bundle-add" @mousedown.stop>
        <div class="wp-bundle-add__head">
          <i class="pi pi-plus" aria-hidden="true" />
          <span class="wp-bundle-add__title">Add child to bundle</span>
          <button
            type="button"
            class="wp-bundle-add__close"
            aria-label="Close picker"
            title="Close"
            data-test="bundle-add-close"
            @click="close"
          ><i class="pi pi-times" /></button>
        </div>

        <div class="wp-bundle-add__body">
          <div class="wp-bundle-add__tabs" role="tablist" aria-label="Module kind">
            <button
              v-for="tab in KIND_TABS"
              :key="tab.type"
              type="button"
              role="tab"
              class="wp-bundle-add__tab"
              :data-kind="tab.type"
              :data-active="activeTab === tab.type ? '' : null"
              :aria-selected="activeTab === tab.type"
              :data-test="`bundle-add-tab-${tab.type}`"
              @click="activeTab = tab.type"
            >
              <i :class="tab.icon" />
              <span class="wp-bundle-add__tab-label">{{ tab.label }}</span>
              <span class="wp-bundle-add__tab-count">{{ counts[tab.type] ?? 0 }}</span>
            </button>
          </div>

          <div class="wp-bundle-add__search">
            <span class="wp-bundle-add__searchicon"><i class="pi pi-search" /></span>
            <Input
              v-model="search"
              placeholder="Search modules…"
              class="wp-bundle-add__searchinput"
              aria-label="Search modules"
              data-test="bundle-add-search"
            />
          </div>

          <div class="wp-bundle-add__list" data-test="bundle-add-list">
            <div v-if="!filtered.length" class="wp-bundle-add__empty">
              No modules match.
            </div>
            <button
              v-for="m in filtered"
              :key="m.id"
              type="button"
              class="wp-bundle-add__row"
              :data-kind="m.type"
              :data-test="`bundle-add-row-${m.id}`"
              @click="pick(m)"
            >
              <span class="wp-bundle-add__rowicon" aria-hidden="true">
                <i :class="kindIcon(m.type)" />
              </span>
              <div class="wp-bundle-add__rowmain">
                <div class="wp-bundle-add__rowname">{{ m.name }}</div>
                <div class="wp-bundle-add__rowsub">{{ KIND_LABEL[m.type] ?? m.type }} · {{ m.id }}</div>
              </div>
              <span class="wp-bundle-add__rowadd" aria-hidden="true">
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
.wp-bundle-add__backdrop {
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: var(--wp-overlay-bg, rgba(0, 0, 0, 0.6));
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.wp-bundle-add {
  display: flex;
  flex-direction: column;
  width: 640px;
  max-width: 100%;
  max-height: 80vh;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border-strong);
  border-radius: var(--wp-radius);
  box-shadow: var(--wp-shadow-lg);
  overflow: hidden;
}
.wp-bundle-add__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--wp-border);
  background: var(--wp-bg-3);
  color: var(--wp-text);
}
.wp-bundle-add__title {
  font-weight: 600;
  font-size: 13px;
}
.wp-bundle-add__close {
  margin-left: auto;
  width: 26px; height: 26px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--wp-text-dim);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.wp-bundle-add__close:hover { background: var(--wp-bg); color: var(--wp-text); }

.wp-bundle-add__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  min-height: 0;
  flex: 1;
}

.wp-bundle-add__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.wp-bundle-add__tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border: 1px solid var(--wp-border);
  border-radius: 999px;
  background: var(--wp-bg);
  color: var(--wp-text-dim);
  font-size: 11px;
  cursor: pointer;
}
.wp-bundle-add__tab[data-active] {
  background: color-mix(in oklab, var(--wp-accent-500) 18%, transparent);
  border-color: color-mix(in oklab, var(--wp-accent-500) 42%, transparent);
  color: var(--wp-accent-500);
}
.wp-bundle-add__tab-count {
  font-size: 9.5px;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in oklab, currentColor 16%, transparent);
}

.wp-bundle-add__search {
  position: relative;
  display: flex;
  align-items: center;
}
.wp-bundle-add__searchicon {
  position: absolute;
  left: 8px;
  color: var(--wp-text-dim);
  pointer-events: none;
  font-size: 12px;
}
.wp-bundle-add__searchinput :deep(.wp-input) { padding-left: 26px; }
.wp-bundle-add__searchinput { flex: 1; }

.wp-bundle-add__list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow-y: auto;
  min-height: 0;
}
.wp-bundle-add__empty {
  padding: 18px;
  text-align: center;
  color: var(--wp-text-dim);
  font-size: 12px;
}
.wp-bundle-add__row {
  display: grid;
  grid-template-columns: 28px 1fr 22px;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  color: var(--wp-text);
  cursor: pointer;
  text-align: left;
  transition: background 120ms ease, border-color 120ms ease;
}
.wp-bundle-add__row:hover {
  background: var(--wp-bg-3);
  border-color: var(--wp-border-strong, var(--wp-border));
}
.wp-bundle-add__rowicon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 22px;
  border-radius: 4px;
  background: var(--wp-bg-3);
  color: var(--wp-text-dim);
  font-size: 12px;
}
.wp-bundle-add__row[data-kind="wildcard"]     .wp-bundle-add__rowicon { color: var(--wp-kind-wildcard); }
.wp-bundle-add__row[data-kind="fixed_values"] .wp-bundle-add__rowicon { color: var(--wp-kind-fixed); }
.wp-bundle-add__row[data-kind="combine"]      .wp-bundle-add__rowicon { color: var(--wp-kind-combine); }
.wp-bundle-add__row[data-kind="derivation"]   .wp-bundle-add__rowicon { color: var(--wp-kind-derivation); }
.wp-bundle-add__row[data-kind="constraint"]   .wp-bundle-add__rowicon { color: var(--wp-kind-constraint); }
.wp-bundle-add__rowmain { min-width: 0; }
.wp-bundle-add__rowname {
  font: 500 12.5px/1.2 var(--wp-font-sans);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-bundle-add__rowsub {
  font-size: 10.5px;
  color: var(--wp-text-dim);
  font-family: var(--wp-font-mono, ui-monospace, monospace);
}
.wp-bundle-add__rowadd {
  color: var(--wp-text-dim);
  font-size: 11px;
}
.wp-bundle-add__row:hover .wp-bundle-add__rowadd { color: var(--wp-accent-500); }
</style>
