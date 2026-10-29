<script setup lang="ts">
/**
 * BundleAddChildModal — library picker for adding a frozen snapshot of
 * a module to the bundle's children. Teleport-based overlay, kind-filter
 * tabs + search, click a row to pick.
 *
 * Parent (BundleEditor) takes the emitted ModuleRow, builds a snapshot,
 * and appends to `children[]`.
 */
import SearchInput from "@/kit/SearchInput.vue";
import CloseButton from "@/kit/CloseButton.vue";
import { computed, ref, watch } from "vue";
import WpTabs, { type TabItem } from "@/kit/WpTabs.vue";
import { kindIcon } from "../../components/shared/kind-icons";
import type { BundleRow, ModuleRow, ModuleType } from "../api/types";

type PickerTab = ModuleType | "bundle" | "all";

interface Props {
  visible: boolean;
  modules: ModuleRow[];
  /** Tier-1 bundles eligible to be referenced as children. Caller is
   *  responsible for filtering out the bundle being edited and any
   *  bundle that already contains a bundle child (the API would 400
   *  the write anyway, but hiding them keeps the picker honest). */
  bundles?: BundleRow[];
}
const props = withDefaults(defineProps<Props>(), {
  bundles: () => [],
});

const emit = defineEmits<{
  (e: "close"): void;
  (e: "pick", row: ModuleRow): void;
  (e: "pick-bundle", row: BundleRow): void;
}>();

interface KindTab {
  type: PickerTab;
  label: string;
  icon: string;
}

const KIND_TABS: KindTab[] = [
  { type: "all",          label: "All",           icon: "pi-objects-column" },
  { type: "wildcard",     label: "Wildcards",     icon: "pi-sparkles" },
  { type: "fixed_values", label: "Fixed Values",  icon: "pi-tag" },
  { type: "combine",      label: "Combines",      icon: "pi-link" },
  { type: "derivation",   label: "Derivations",   icon: "pi-arrow-right-arrow-left" },
  { type: "constraint",   label: "Constraints",   icon: "pi-filter" },
  { type: "bundle",       label: "Bundles",       icon: "pi-box" },
];

const KIND_LABEL: Record<ModuleType, string> = {
  wildcard:     "Wildcard",
  fixed_values: "Fixed values",
  combine:      "Combine",
  derivation:   "Derivation",
  constraint:   "Constraint",
};

const activeTab = ref<PickerTab>("all");
const search = ref("");

watch(() => props.visible, (v) => {
  if (v) {
    activeTab.value = "all";
    search.value = "";
  }
});

function matchesQuery(name: string, id: string, tags: readonly string[] | undefined, q: string): boolean {
  if (!q) return true;
  if (name.toLowerCase().includes(q)) return true;
  if (id.toLowerCase().includes(q)) return true;
  if ((tags ?? []).some((t) => t.toLowerCase().includes(q))) return true;
  return false;
}

const filteredModules = computed<ModuleRow[]>(() => {
  if (activeTab.value === "bundle") return [];
  const q = search.value.trim().toLowerCase();
  return props.modules.filter((m) => {
    if (activeTab.value !== "all" && m.type !== activeTab.value) return false;
    return matchesQuery(m.name, m.id, m.tags, q);
  });
});

const filteredBundles = computed<BundleRow[]>(() => {
  if (activeTab.value !== "all" && activeTab.value !== "bundle") return [];
  const q = search.value.trim().toLowerCase();
  return props.bundles.filter((b) => matchesQuery(b.name, b.id, b.tags, q));
});

const counts = computed<Record<string, number>>(() => {
  const c: Record<string, number> = { all: 0 };
  for (const t of KIND_TABS) c[t.type] = 0;
  for (const m of props.modules) {
    c.all += 1;
    c[m.type] = (c[m.type] ?? 0) + 1;
  }
  c.all += props.bundles.length;
  c.bundle = props.bundles.length;
  return c;
});

const kindTabs = computed<TabItem<PickerTab>[]>(() =>
  KIND_TABS.map((t) => ({ id: t.type, label: t.label, icon: t.icon, count: counts.value[t.type] ?? 0 })));

function close() { emit("close"); }
function pickModule(row: ModuleRow) {
  emit("pick", row);
  emit("close");
}
function pickBundle(row: BundleRow) {
  emit("pick-bundle", row);
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
          <CloseButton
            class="wp-bundle-add__close"
            label="Close picker"
            kbd="Esc"
            data-test="bundle-add-close"
            @click="close"
          />
        </div>

        <div class="wp-bundle-add__body">
          <WpTabs
            v-model="activeTab"
            :tabs="kindTabs"
            size="sm"
            aria-label="Module kind"
            test-prefix="bundle-add-tab"
          />

          <SearchInput
            v-model="search"
            placeholder="Search modules…"
            aria-label="Search modules"
            data-test="bundle-add-search"
          />

          <div class="wp-bundle-add__list" data-test="bundle-add-list">
            <div
              v-if="!filteredModules.length && !filteredBundles.length"
              class="wp-bundle-add__empty"
            >
              No entries match.
            </div>
            <button
              v-for="m in filteredModules"
              :key="`mod-${m.id}`"
              type="button"
              class="wp-bundle-add__row"
              :data-kind="m.type"
              :data-test="`bundle-add-row-${m.id}`"
              @click="pickModule(m)"
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
            <button
              v-for="b in filteredBundles"
              :key="`bun-${b.id}`"
              type="button"
              class="wp-bundle-add__row"
              data-kind="bundle"
              :data-test="`bundle-add-bundle-${b.id}`"
              @click="pickBundle(b)"
            >
              <span class="wp-bundle-add__rowicon" aria-hidden="true">
                <i class="pi pi-box" />
              </span>
              <div class="wp-bundle-add__rowmain">
                <div class="wp-bundle-add__rowname">{{ b.name }}</div>
                <div class="wp-bundle-add__rowsub">Bundle · {{ b.id }}</div>
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
  padding: var(--wp-space-7);
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
  gap: var(--wp-space-5);
  padding: var(--wp-space-5) var(--wp-space-6);
  border-bottom: 1px solid var(--wp-border);
  background: var(--wp-bg-3);
  color: var(--wp-text);
}
.wp-bundle-add__title {
  font-weight: 600;
  font-size: var(--wp-text-base);
}
.wp-bundle-add__close { margin-left: auto; }

.wp-bundle-add__body {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-5);
  padding: var(--wp-space-5) var(--wp-space-6);
  min-height: 0;
  flex: 1;
}


.wp-bundle-add__list {
  display: flex;
  flex-direction: column;
  gap: 3px; /* audit-exempt: 3px tight list gap keeps items dense */
  overflow-y: auto;
  min-height: 0;
}
.wp-bundle-add__empty {
  padding: var(--wp-space-6);
  text-align: center;
  color: var(--wp-text-dim);
  font-size: var(--wp-text-sm);
}
.wp-bundle-add__row {
  display: grid;
  grid-template-columns: 28px 1fr 22px;
  align-items: center;
  gap: var(--wp-space-5);
  padding: 7px var(--wp-space-5); /* audit-exempt: 7px vertical hairline keeps row compact */
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
  border-radius: var(--wp-radius-sm);
  background: var(--wp-bg-3);
  color: var(--wp-text-dim);
  font-size: var(--wp-text-sm);
}
.wp-bundle-add__row[data-kind="wildcard"]     .wp-bundle-add__rowicon { color: var(--wp-kind-wildcard); }
.wp-bundle-add__row[data-kind="fixed_values"] .wp-bundle-add__rowicon { color: var(--wp-kind-fixed); }
.wp-bundle-add__row[data-kind="combine"]      .wp-bundle-add__rowicon { color: var(--wp-kind-combine); }
.wp-bundle-add__row[data-kind="derivation"]   .wp-bundle-add__rowicon { color: var(--wp-kind-derivation); }
.wp-bundle-add__row[data-kind="constraint"]   .wp-bundle-add__rowicon { color: var(--wp-kind-constraint); }
.wp-bundle-add__row[data-kind="bundle"]       .wp-bundle-add__rowicon { color: var(--wp-accent-500); }
.wp-bundle-add__rowmain { min-width: 0; }
.wp-bundle-add__rowname {
  font: 500 12.5px/1.2 var(--wp-font-sans); /* audit-exempt: font-shorthand — out of audit scope; awaiting font-shorthand parser */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-bundle-add__rowsub {
  font-size: var(--wp-text-xs);
  color: var(--wp-text-dim);
  font-family: var(--wp-font-mono, ui-monospace, monospace);
}
.wp-bundle-add__rowadd {
  color: var(--wp-text-dim);
  font-size: var(--wp-text-xs);
}
.wp-bundle-add__row:hover .wp-bundle-add__rowadd { color: var(--wp-accent-500); }
</style>
