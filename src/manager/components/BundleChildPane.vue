<script setup lang="ts">
/**
 * BundleChildPane — sticky right pane mounting kind-specific section
 * components for the currently selected bundle child. Reuses the
 * Context-side `*InstanceModal` section internals (IdentitySection,
 * PoolSection, etc.) without their modal chrome.
 *
 * Frozen-snapshot semantic: emits `update [patch: Partial<ModuleEntry>]`
 * which the parent applies to `children[selectedIdx]`. Library actions
 * ("Save to library", "Open SPA") that exist in the modal version are
 * not surfaced here — bundle children are frozen snapshots, never
 * pushed back to the source library entry.
 *
 * Task 3 ships wildcard support. Combine / fixed_values / derivation /
 * constraint land in Task 4a–d.
 */
import { computed } from "vue";
import WildcardIdentitySection from "../../components/context/editors/wildcard/sections/IdentitySection.vue";
import WildcardPoolSection from "../../components/context/editors/wildcard/sections/PoolSection.vue";
import WildcardRuntimeSection from "../../components/context/editors/wildcard/sections/RuntimeSection.vue";
import CombineIdentitySection from "../../components/context/editors/combine/sections/IdentitySection.vue";
import CombineTemplateSection from "../../components/context/editors/combine/sections/TemplateSection.vue";
import CombineRuntimeSection from "../../components/context/editors/combine/sections/RuntimeSection.vue";
import FixedIdentitySection from "../../components/context/editors/fixed-values/sections/IdentitySection.vue";
import FixedValuesSection from "../../components/context/editors/fixed-values/sections/ValuesSection.vue";
import FixedRuntimeSection from "../../components/context/editors/fixed-values/sections/RuntimeSection.vue";
import { kindIcon } from "../../components/shared/kind-icons";
import type { ModuleEntry } from "../../widgets/_shared";

interface Props {
  child: Record<string, unknown> | null;
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "update", patch: Partial<ModuleEntry>): void;
  (e: "close"): void;
}>();

const KIND_LABEL: Record<string, string> = {
  wildcard: "Wildcard",
  fixed_values: "Fixed values",
  combine: "Combine",
  derivation: "Derivation",
  constraint: "Constraint",
  bundle: "Bundle",
};

const KIND_COLOR: Record<string, string> = {
  wildcard:     "var(--wp-kind-wildcard, #34d399)",
  fixed_values: "var(--wp-kind-fixed, #22d3ee)",
  combine:      "var(--wp-kind-combine, #fbbf24)",
  derivation:   "var(--wp-kind-derivation, #a78bfa)",
  constraint:   "var(--wp-kind-constraint, #f87171)",
  bundle:       "var(--wp-bundle-default, #46566B)",
};

const kind = computed<string>(() => String(props.child?.type ?? ""));
const moduleEntry = computed<ModuleEntry | null>(() => {
  if (!props.child) return null;
  return props.child as unknown as ModuleEntry;
});
const displayName = computed<string>(() => {
  const m = props.child?.meta as { name?: string } | undefined;
  return m?.name ?? String(props.child?.name ?? "(unnamed)");
});
const headerIcon = computed<string>(() => (kind.value === "bundle" ? "pi pi-box" : kindIcon(kind.value)));
const headerColor = computed<string>(() => KIND_COLOR[kind.value] ?? "var(--wp-accent-500)");

function onUpdate(patch: Partial<ModuleEntry>) {
  emit("update", patch);
}
</script>

<template>
  <aside class="wp-bpane" :style="{ '--pane-kind': headerColor }">
    <div v-if="!child" class="wp-bpane__empty" data-test="bundle-pane-empty">
      <i class="pi pi-file-edit wp-bpane__empty-icon" aria-hidden="true" />
      <p class="wp-bpane__empty-title">Pick a child on the left to edit its snapshot.</p>
      <p class="wp-bpane__empty-hint">
        Reorder, enable/disable, duplicate, and remove also work directly from the list.
      </p>
    </div>

    <template v-else>
      <header class="wp-bpane__head" data-test="bundle-pane-header">
        <span class="wp-bpane__kindicon" aria-hidden="true">
          <i :class="headerIcon" />
        </span>
        <span class="wp-bpane__name">{{ displayName }}</span>
        <span class="wp-bpane__kind">{{ KIND_LABEL[kind] ?? kind }}</span>
        <button
          type="button"
          class="wp-bpane__close"
          aria-label="Close child editor"
          title="Close"
          data-test="bundle-pane-close"
          @click="emit('close')"
        >
          <i class="pi pi-times" aria-hidden="true" />
        </button>
      </header>

      <div class="wp-bpane__banner" data-test="bundle-pane-banner">
        <i class="pi pi-info-circle" aria-hidden="true" />
        Editing this bundle's snapshot of <b>{{ displayName }}</b>.
        Source library entry is unchanged.
      </div>

      <div
        v-if="kind === 'wildcard' && moduleEntry"
        data-test="bundle-pane-sections-wildcard"
        class="wp-bpane__sections"
      >
        <WildcardIdentitySection
          :module="moduleEntry"
          :upstream-vars="[]"
          :sibling-vars="[]"
          @update="onUpdate"
        />
        <WildcardPoolSection :module="moduleEntry" @update="onUpdate" />
        <WildcardRuntimeSection :module="moduleEntry" @update="onUpdate" />
      </div>

      <div
        v-else-if="kind === 'combine' && moduleEntry"
        data-test="bundle-pane-sections-combine"
        class="wp-bpane__sections"
      >
        <CombineIdentitySection :module="moduleEntry" @update="onUpdate" />
        <CombineTemplateSection :module="moduleEntry" @update="onUpdate" />
        <CombineRuntimeSection :module="moduleEntry" @update="onUpdate" />
      </div>

      <div
        v-else-if="kind === 'fixed_values' && moduleEntry"
        data-test="bundle-pane-sections-fixed-values"
        class="wp-bpane__sections"
      >
        <FixedIdentitySection :module="moduleEntry" @update="onUpdate" />
        <FixedValuesSection :module="moduleEntry" @update="onUpdate" />
        <FixedRuntimeSection :module="moduleEntry" @update="onUpdate" />
      </div>

      <div
        v-else
        class="wp-bpane__unsupported"
        data-test="bundle-pane-unsupported"
      >
        <i class="pi pi-info-circle" aria-hidden="true" />
        Inline editor for <b>{{ kind }}</b> children lands in a follow-up commit.
      </div>
    </template>
  </aside>
</template>

<style scoped>
.wp-bpane {
  position: sticky;
  top: 8px;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-left: 3px solid var(--pane-kind, var(--wp-accent-500));
  border-radius: var(--wp-radius, 4px);
  padding: 12px 14px;
  align-self: start;
  min-width: 0;
}
.wp-bpane__empty {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 6px;
  padding: 48px 16px;
  color: var(--wp-text-dim);
  text-align: center;
}
.wp-bpane__empty-icon { font-size: 26px; color: var(--wp-border-strong, var(--wp-border)); }
.wp-bpane__empty-title { font-size: 12px; margin: 0; }
.wp-bpane__empty-hint { font-size: 11px; margin: 0; color: var(--wp-text-dim); }

.wp-bpane__head {
  display: flex; align-items: center; gap: 8px;
  padding-bottom: 10px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--wp-border);
}
.wp-bpane__kindicon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px;
  border-radius: 4px;
  background: color-mix(in oklab, var(--pane-kind, var(--wp-accent-500)) 18%, var(--wp-bg-3));
  color: var(--pane-kind, var(--wp-accent-500));
  font-size: 12px;
  flex-shrink: 0;
}
.wp-bpane__name { font: 600 13px/1.2 var(--wp-font-sans); color: var(--wp-text); }
.wp-bpane__kind {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--pane-kind, var(--wp-accent-500));
  padding: 2px 6px;
  border-radius: 3px;
  background: color-mix(in oklab, var(--pane-kind, var(--wp-accent-500)) 14%, transparent);
}
.wp-bpane__close {
  margin-left: auto;
  width: 24px; height: 24px;
  background: transparent; border: 1px solid transparent;
  border-radius: 4px; color: var(--wp-text-dim); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.wp-bpane__close:hover { background: var(--wp-bg-3); color: var(--wp-text); }

.wp-bpane__banner {
  display: flex; align-items: flex-start; gap: 6px;
  background: color-mix(in oklab, var(--wp-amber, #fbbf24) 12%, transparent);
  border-left: 2px solid var(--wp-amber, #fbbf24);
  color: var(--wp-text);
  padding: 7px 10px;
  border-radius: 3px;
  margin-bottom: 12px;
  font-size: 11.5px;
  line-height: 1.45;
}
.wp-bpane__banner .pi { color: var(--wp-amber, #fbbf24); margin-top: 2px; flex-shrink: 0; }

.wp-bpane__sections {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.wp-bpane__unsupported {
  display: flex; align-items: center; gap: 8px;
  padding: 14px;
  font-size: 12px;
  color: var(--wp-text-dim);
  background: var(--wp-bg-2);
  border-radius: 4px;
}
</style>
