<script setup lang="ts">
/**
 * Collapsible picker section: header (title + count + section-checkbox +
 * "selected / total" caption) over a slot of PickerRow children.
 *
 * Pure presentational. Selection logic stays in the parent — section
 * emits `toggle-all` when the user clicks the section-checkbox; parent
 * decides what "select all of this bucket" actually means.
 *
 * Section-checkbox tri-state: checked when all rows are selected,
 * indeterminate when some are selected, unchecked when none.
 *
 * Phase-1 addition: optional `kind` prop renders a tinted type-icon in
 * the header next to the title — same `.wp-row-type-icon--{slug}`
 * primitive PickerRow uses. Bundles + categories override the kind
 * icon (`pi pi-folder` for category vs. `pi pi-box` for bundle).
 */
import { ref, computed } from "vue";
import Checkbox from "../components/ui/Checkbox.vue";
import { kindIcon } from "../../components/shared/kind-icons";

/** Mirror of PickerRow's KIND_CLASS — same slug rules. */
const KIND_CLASS: Record<string, string> = {
  wildcard:     "wildcard",
  fixed_values: "fixed",
  combine:      "combine",
  derivation:   "derivation",
  constraint:   "constraint",
  bundle:       "bundle",
  category:     "bundle",
};

interface Props {
  title: string;
  totalCount: number;
  selectedCount: number;
  /** Whether the body starts expanded. Defaults to true. */
  defaultOpen?: boolean;
  /** Module kind for the section header type-icon. Optional — when
   *  absent, no icon renders. Same kind strings as PickerRow. */
  kind?: string;
}

const props = withDefaults(defineProps<Props>(), {
  defaultOpen: true,
  kind: undefined,
});
const emit = defineEmits<{ (e: "toggle-all", v: boolean): void }>();

const open = ref<boolean>(props.defaultOpen);
const allSelected = computed<boolean>(
  () => props.totalCount > 0 && props.selectedCount === props.totalCount,
);
const indeterminate = computed<boolean>(
  () => props.selectedCount > 0 && props.selectedCount < props.totalCount,
);

/** PrimeIcons class for the header icon. `category` overrides the
 *  default `pi pi-circle` from `kindIcon` (which has no category entry)
 *  to `pi pi-folder` so the organizational meaning reads correctly. */
const iconClass = computed<string | null>(() => {
  if (!props.kind) return null;
  if (props.kind === "category") return "pi pi-folder";
  return kindIcon(props.kind);
});

const kindClass = computed<string | null>(() => {
  if (!props.kind) return null;
  return KIND_CLASS[props.kind] ?? "bundle";
});
</script>

<template>
  <section class="wp-picker-section">
    <header class="wp-picker-section__header">
      <button
        type="button"
        class="wp-picker-section__toggle"
        :aria-expanded="open"
        :aria-label="open ? 'Collapse section' : 'Expand section'"
        @click="open = !open"
      >
        {{ open ? "▼" : "▶" }}
      </button>
      <Checkbox
        class="wp-picker-section__check"
        :model-value="allSelected"
        :indeterminate="indeterminate"
        :aria-label="`Select all ${title}`"
        @update:model-value="(v: boolean) => emit('toggle-all', v)"
      />
      <span
        v-if="iconClass && kindClass"
        class="wp-row-type-icon"
        :class="`wp-row-type-icon--${kindClass}`"
        aria-hidden="true"
        data-test="picker-section-icon"
      >
        <i :class="iconClass" />
      </span>
      <span class="wp-picker-section__title">{{ title }} ({{ totalCount }})</span>
      <span class="wp-picker-section__count">
        {{ selectedCount }} / {{ totalCount }} selected
      </span>
    </header>
    <div v-if="open" class="wp-picker-section__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
@import "../../components/shared/row-primitives.css";

.wp-picker-section {
  margin-bottom: 16px;
}
.wp-picker-section__header {
  display: grid;
  grid-template-columns: 14px 18px auto 1fr auto;
  align-items: center;
  column-gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--wp-border);
}
.wp-picker-section__toggle {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 4px;
  color: var(--wp-text2);
  font-family: var(--wp-font-mono);
  font-size: 12px;
  line-height: 1;
}
.wp-picker-section__toggle:hover {
  color: var(--wp-text);
}
.wp-picker-section__title {
  font-weight: 600;
  color: var(--wp-text);
  font-family: var(--wp-font-sans);
}
.wp-picker-section__count {
  margin-left: auto;
  font-size: 12px;
  color: var(--wp-text2);
  font-family: var(--wp-font-sans);
}
.wp-picker-section__body {
  padding-top: 4px;
}
</style>
