<script setup lang="ts">
/**
 * Collapsible picker section: header (chevron + section-checkbox +
 * type icon + title + count + selection pill) over a slot of PickerRow
 * children.
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
 *
 * Phase-4 redesign: the header itself is a clickable bar — anywhere
 * on the header (except the inner checkbox) collapses/expands the
 * section. The title is plain text (no parens), with the total count
 * surfaced as a muted "{n} items" sibling and the selection state as
 * a tinted "n / m" pill that switches to a muted background when no
 * rows are selected.
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
  category:     "category",
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

/**
 * Header click handler — toggles open/closed when the user clicks
 * anywhere on the header bar EXCEPT the section-checkbox inside it.
 * The checkbox's own click handler has its own intent ("toggle all in
 * bucket"), so we filter it out to keep behaviors orthogonal.
 */
function onHeaderClick(evt: MouseEvent): void {
  const target = evt.target as HTMLElement | null;
  if (target && target.closest('[data-test="picker-section-checkbox"]')) return;
  open.value = !open.value;
}
</script>

<template>
  <section class="wp-picker-section" :data-open="open ? 'true' : 'false'">
    <header
      class="wp-picker-section__header"
      :aria-expanded="open"
      role="button"
      tabindex="0"
      @click="onHeaderClick"
      @keydown.enter.prevent="open = !open"
      @keydown.space.prevent="open = !open"
    >
      <button
        type="button"
        class="wp-picker-section__toggle"
        :aria-label="open ? 'Collapse section' : 'Expand section'"
        tabindex="-1"
      >
        <i class="pi pi-angle-right wp-picker-section__chevron-icon" aria-hidden="true" />
      </button>
      <Checkbox
        class="wp-picker-section__check"
        data-test="picker-section-checkbox"
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
      <span class="wp-picker-section__title">{{ title }}</span>
      <span class="wp-picker-section__count">{{ totalCount }} items</span>
      <span
        class="wp-picker-section__sel-pill"
        :data-empty="selectedCount === 0 ? 'true' : 'false'"
      >{{ selectedCount }} / {{ totalCount }}</span>
    </header>
    <div v-if="open" class="wp-picker-section__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
@import "../../components/shared/row-primitives.css";

.wp-picker-section {
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  margin-bottom: 6px;
  overflow: hidden;
}
.wp-picker-section__header {
  display: grid;
  grid-template-columns: 14px 18px auto auto 1fr auto auto;
  gap: 10px;
  align-items: center;
  padding: 9px 14px;
  cursor: pointer;
  user-select: none;
}
.wp-picker-section__header:hover {
  background: color-mix(in oklab, var(--wp-bg-3) 60%, transparent);
}
.wp-picker-section__header:focus-visible {
  outline: 2px solid var(--wp-accent-500);
  outline-offset: -2px;
}
.wp-picker-section__toggle {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 4px;
  color: var(--wp-text-dim);
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.wp-picker-section__toggle:hover {
  color: var(--wp-text);
}
.wp-picker-section__chevron-icon {
  font-size: 10px;
  transition: transform 0.15s ease;
  color: var(--wp-text-dim);
}
.wp-picker-section[data-open="true"] .wp-picker-section__chevron-icon {
  transform: rotate(90deg);
}
.wp-picker-section__title {
  font-weight: 600;
  color: var(--wp-text);
  font-family: var(--wp-font);
  font-size: var(--wp-text-md);
  letter-spacing: -0.005em;
}
.wp-picker-section__count {
  color: var(--wp-text-muted);
  font-size: var(--wp-text-sm);
  font-family: var(--wp-font);
  font-feature-settings: "tnum";
}
.wp-picker-section__sel-pill {
  font-size: var(--wp-text-xs);
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--wp-accent-500) 18%, transparent);
  color: var(--wp-accent-text);
  font-family: var(--wp-font);
  font-feature-settings: "tnum";
}
.wp-picker-section__sel-pill[data-empty="true"] {
  background: var(--wp-bg-3);
  color: var(--wp-text-dim);
}
.wp-picker-section__body {
  border-top: 1px solid var(--wp-border);
  background: var(--wp-bg-1);
  padding-top: 4px;
}
</style>
