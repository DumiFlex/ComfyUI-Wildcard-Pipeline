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
import { RouterLink } from "vue-router";
import WildcardIdentitySection from "../../components/context/editors/wildcard/sections/IdentitySection.vue";
import WildcardPoolSection from "../../components/context/editors/wildcard/sections/PoolSection.vue";
import WildcardRuntimeSection from "../../components/context/editors/wildcard/sections/RuntimeSection.vue";
import CombineIdentitySection from "../../components/context/editors/combine/sections/IdentitySection.vue";
import CombineTemplateSection from "../../components/context/editors/combine/sections/TemplateSection.vue";
import CombineRuntimeSection from "../../components/context/editors/combine/sections/RuntimeSection.vue";
import FixedIdentitySection from "../../components/context/editors/fixed-values/sections/IdentitySection.vue";
import FixedValuesSection from "../../components/context/editors/fixed-values/sections/ValuesSection.vue";
import FixedRuntimeSection from "../../components/context/editors/fixed-values/sections/RuntimeSection.vue";
import DerivationIdentitySection from "../../components/context/editors/derivation/sections/IdentitySection.vue";
import DerivationRulesSection from "../../components/context/editors/derivation/sections/RulesSection.vue";
import DerivationRuntimeSection from "../../components/context/editors/derivation/sections/RuntimeSection.vue";
import ConstraintIdentitySection from "../../components/context/editors/constraint/sections/IdentitySection.vue";
import ConstraintMatrixSection from "../../components/context/editors/constraint/sections/MatrixSection.vue";
import ConstraintExceptionsSection from "../../components/context/editors/constraint/sections/ExceptionsSection.vue";
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
  bundle:       "var(--wp-bundle-default, #6366f1)",
};

const kind = computed<string>(() => String(props.child?.type ?? ""));
const moduleEntry = computed<ModuleEntry | null>(() => {
  if (!props.child) return null;
  return props.child as unknown as ModuleEntry;
});
/** True when the bundle reference points at a deleted library entry.
 *  Server stamps `_missing_ref: true` on the GET-expanded child when
 *  the ref id is no longer in the library. Drives the danger banner +
 *  disables the "Open in bundle editor" CTA (target route would 404). */
const isMissingRef = computed<boolean>(
  () => kind.value === "bundle" && props.child?._missing_ref === true,
);
const displayName = computed<string>(() => {
  // Bundle refs carry the cached name on the row itself (no `meta`
  // wrapper); module snapshots use the canonical meta.name.
  if (kind.value === "bundle") {
    return String(props.child?.name ?? "(unnamed bundle)");
  }
  const m = props.child?.meta as { name?: string } | undefined;
  return m?.name ?? String(props.child?.name ?? "(unnamed)");
});
/** Number of inner children resolved on the GET-expanded bundle ref.
 *  Falls back to 0 when the reference is missing or arrived stripped.
 *  Display-only — used in the pane's reference summary block. */
const refInnerCount = computed<number>(() => {
  if (kind.value !== "bundle") return 0;
  const inner = (props.child as { children?: unknown }).children;
  return Array.isArray(inner) ? inner.length : 0;
});
const headerIcon = computed<string>(() => (kind.value === "bundle" ? "pi pi-box" : kindIcon(kind.value)));
const headerColor = computed<string>(() => KIND_COLOR[kind.value] ?? "var(--wp-accent-500)");

function onUpdate(patch: Partial<ModuleEntry>) {
  emit("update", patch);
}

/**
 * Constraint matrix axes + exception value suggestions derived from the
 * snapshot's payload alone — no sibling-modules lookup here since the
 * bundle pane doesn't have a Context-graph to scan. Mirrors the fallback
 * path ConstraintInstanceModal already uses for cross-Context constraints.
 */
interface ConstraintPayload {
  source_wildcard_id?: string;
  target_wildcard_id?: string;
  matrix?: Record<string, Record<string, unknown>>;
  exceptions?: Array<{ source_value?: string; target_value?: string; source?: string; target?: string }>;
}

const constraintPayload = computed<ConstraintPayload>(
  () => ((moduleEntry.value?.payload ?? {}) as ConstraintPayload),
);

const constraintSourceSubs = computed<string[]>(
  () => Object.keys(constraintPayload.value.matrix ?? {}),
);
const constraintTargetSubs = computed<string[]>(() => {
  const set = new Set<string>();
  for (const row of Object.values(constraintPayload.value.matrix ?? {})) {
    for (const k of Object.keys(row ?? {})) set.add(k);
  }
  return Array.from(set);
});
const constraintSourceValues = computed<string[]>(() => {
  const set = new Set<string>();
  for (const e of constraintPayload.value.exceptions ?? []) {
    const v = e.source_value ?? e.source ?? "";
    if (v) set.add(v);
  }
  return Array.from(set);
});
const constraintTargetValues = computed<string[]>(() => {
  const set = new Set<string>();
  for (const e of constraintPayload.value.exceptions ?? []) {
    const v = e.target_value ?? e.target ?? "";
    if (v) set.add(v);
  }
  return Array.from(set);
});
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

      <div
        v-if="kind === 'bundle' && isMissingRef"
        class="wp-bpane__banner wp-bpane__banner--missing"
        data-test="bundle-pane-banner-missing"
      >
        <i class="pi pi-exclamation-triangle" aria-hidden="true" />
        <b>{{ displayName }}</b> no longer exists in the library. This
        reference is broken — remove it, or add a new child that points
        at a live bundle.
      </div>
      <div
        v-else-if="kind === 'bundle'"
        class="wp-bpane__banner wp-bpane__banner--ref"
        data-test="bundle-pane-banner"
      >
        <i class="pi pi-box" aria-hidden="true" />
        <b>{{ displayName }}</b> is a live reference. Its contents update
        wherever it's used — edit the bundle itself to change them.
      </div>
      <div
        v-else
        class="wp-bpane__banner"
        data-test="bundle-pane-banner"
      >
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
        v-else-if="kind === 'derivation' && moduleEntry"
        data-test="bundle-pane-sections-derivation"
        class="wp-bpane__sections"
      >
        <DerivationIdentitySection :module="moduleEntry" @update="onUpdate" />
        <DerivationRulesSection :module="moduleEntry" @update="onUpdate" />
        <DerivationRuntimeSection :module="moduleEntry" @update="onUpdate" />
      </div>

      <div
        v-else-if="kind === 'constraint' && moduleEntry"
        data-test="bundle-pane-sections-constraint"
        class="wp-bpane__sections"
      >
        <ConstraintIdentitySection :module="moduleEntry" @update="onUpdate" />
        <ConstraintMatrixSection
          :module="moduleEntry"
          :source-subs="constraintSourceSubs"
          :target-subs="constraintTargetSubs"
          @update="onUpdate"
        />
        <ConstraintExceptionsSection
          :module="moduleEntry"
          :source-values="constraintSourceValues"
          :target-values="constraintTargetValues"
          @update="onUpdate"
        />
      </div>

      <div
        v-else-if="kind === 'bundle'"
        class="wp-bpane__ref-summary"
        data-test="bundle-pane-sections-bundle"
      >
        <p class="wp-bpane__ref-label">Referenced bundle</p>
        <div class="wp-bpane__ref-fields">
          <div class="wp-bpane__ref-field">
            <span class="wp-bpane__ref-key">id</span>
            <code class="wp-bpane__ref-val">{{ child?.id ?? "" }}</code>
          </div>
          <div class="wp-bpane__ref-field">
            <span class="wp-bpane__ref-key">inner children</span>
            <span class="wp-bpane__ref-val">
              {{ refInnerCount }}
              <span class="wp-bpane__ref-hint">
                ({{ isMissingRef ? "unresolved — entry missing" : "resolved live" }})
              </span>
            </span>
          </div>
        </div>
        <RouterLink
          v-if="child?.id && !isMissingRef"
          :to="`/bundles/${child.id}/edit`"
          class="wp-bpane__ref-cta"
          data-test="bundle-pane-ref-open"
        >
          <i class="pi pi-external-link" aria-hidden="true" />
          Open in bundle editor
        </RouterLink>
        <button
          v-else-if="child?.id"
          type="button"
          class="wp-bpane__ref-cta wp-bpane__ref-cta--disabled"
          disabled
          data-test="bundle-pane-ref-open-disabled"
          title="Referenced bundle no longer exists"
        >
          <i class="pi pi-ban" aria-hidden="true" />
          Open in bundle editor
        </button>
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
  padding: var(--wp-space-5) var(--wp-space-6);
  align-self: start;
  min-width: 0;
}
.wp-bpane__empty {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: var(--wp-space-3);
  padding: 48px var(--wp-space-6); /* audit-exempt: 48px = generous empty-state breathing room */
  color: var(--wp-text-dim);
  text-align: center;
}
.wp-bpane__empty-icon { font-size: var(--wp-text-2xl); color: var(--wp-border-strong, var(--wp-border)); }
.wp-bpane__empty-title { font-size: var(--wp-text-sm); margin: 0; }
.wp-bpane__empty-hint { font-size: var(--wp-text-xs); margin: 0; color: var(--wp-text-dim); }

.wp-bpane__head {
  display: flex; align-items: center; gap: var(--wp-space-4);
  padding-bottom: var(--wp-space-5);
  margin-bottom: var(--wp-space-5);
  border-bottom: 1px solid var(--wp-border);
}
.wp-bpane__kindicon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px;
  border-radius: var(--wp-radius-sm);
  background: color-mix(in oklab, var(--pane-kind, var(--wp-accent-500)) 18%, var(--wp-bg-3));
  color: var(--pane-kind, var(--wp-accent-500));
  font-size: var(--wp-text-sm);
  flex-shrink: 0;
}
.wp-bpane__name { font: 600 13px/1.2 var(--wp-font-sans); /* audit-exempt: font-shorthand — out of audit scope; awaiting font-shorthand parser */ color: var(--wp-text); }
.wp-bpane__kind {
  font-size: 9px; /* audit-exempt: micro uppercase kind label — below scale floor */
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--pane-kind, var(--wp-accent-500));
  padding: 2px var(--wp-space-3);
  border-radius: var(--wp-radius-sm);
  background: color-mix(in oklab, var(--pane-kind, var(--wp-accent-500)) 14%, transparent);
}
.wp-bpane__close {
  margin-left: auto;
  width: 24px; height: 24px;
  background: transparent; border: 1px solid transparent;
  border-radius: var(--wp-radius-sm); color: var(--wp-text-dim); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.wp-bpane__close:hover { background: var(--wp-bg-3); color: var(--wp-text); }

.wp-bpane__banner {
  display: flex; align-items: flex-start; gap: var(--wp-space-3);
  background: color-mix(in oklab, var(--wp-amber, #fbbf24) 12%, transparent);
  border-left: 2px solid var(--wp-amber, #fbbf24);
  color: var(--wp-text);
  padding: 7px var(--wp-space-5); /* audit-exempt: 7px vertical hairline, 10px horiz rounded to 12px */
  border-radius: var(--wp-radius-sm);
  margin-bottom: var(--wp-space-5);
  font-size: var(--wp-text-xs);
  line-height: 1.45;
}
.wp-bpane__banner .pi { color: var(--wp-amber, #fbbf24); margin-top: 2px; flex-shrink: 0; }
/* Bundle-reference banner uses accent (purple) instead of amber to read
 * as "live link, all good" rather than "warning — frozen snapshot". */
.wp-bpane__banner--ref {
  background: color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 12%, transparent);
  border-left-color: var(--wp-accent-500, #8b5cf6);
}
.wp-bpane__banner--ref .pi { color: var(--wp-accent-500, #8b5cf6); }
/* Missing-reference variant — referenced bundle deleted upstream.
 * Stronger tint than the amber default since this is an actual broken
 * link, not just an informational warning. Border-left + icon flip to
 * the danger token so the row reads as "you need to fix this". */
.wp-bpane__banner--missing {
  background: color-mix(in oklab, var(--wp-danger, #ef4444) 12%, transparent);
  border-left-color: var(--wp-danger, #ef4444);
}
.wp-bpane__banner--missing .pi { color: var(--wp-danger, #ef4444); }

.wp-bpane__ref-summary {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-4);
}
.wp-bpane__ref-label {
  font-size: 9px; /* audit-exempt: micro uppercase section label — below scale floor */
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--wp-text-dim);
  margin: 0;
}
.wp-bpane__ref-fields {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-3);
  padding: var(--wp-space-4) var(--wp-space-5);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
}
.wp-bpane__ref-field {
  display: flex;
  align-items: baseline;
  gap: var(--wp-space-4);
  font-size: var(--wp-text-xs);
}
.wp-bpane__ref-key {
  font: 600 9px var(--wp-font-sans); /* audit-exempt: micro key label */
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--wp-text-dim);
  min-width: 90px;
}
.wp-bpane__ref-val {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  color: var(--wp-text);
}
.wp-bpane__ref-hint {
  margin-left: var(--wp-space-3);
  font-family: var(--wp-font-sans);
  color: var(--wp-text-dim);
  font-size: 10px; /* audit-exempt: micro inline hint */
}
.wp-bpane__ref-cta {
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-3);
  align-self: flex-start;
  padding: var(--wp-space-3) var(--wp-space-5);
  background: var(--wp-accent-500, #8b5cf6);
  color: white;
  border-radius: var(--wp-radius-sm);
  font-size: var(--wp-text-xs);
  text-decoration: none;
  transition: filter 120ms ease;
}
.wp-bpane__ref-cta:hover { filter: brightness(1.1); }
.wp-bpane__ref-cta--disabled {
  background: var(--wp-bg-3);
  color: var(--wp-text-dim);
  cursor: not-allowed;
  border: 1px solid var(--wp-border);
}
.wp-bpane__ref-cta--disabled:hover { filter: none; }

.wp-bpane__sections {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-5);
}

.wp-bpane__unsupported {
  display: flex; align-items: center; gap: var(--wp-space-4);
  padding: var(--wp-space-6);
  font-size: var(--wp-text-sm);
  color: var(--wp-text-dim);
  background: var(--wp-bg-2);
  border-radius: var(--wp-radius-sm);
}
</style>
