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
 * The header is the shared Disclosure: its button (chevron, icon, title,
 * count, pill) folds the section, and the checkbox sits in front of it,
 * outside the button. The title is plain text (no parens), with the total count
 * surfaced as a muted "{n} items" sibling and the selection state as
 * a tinted "n / m" pill that switches to a muted background when no
 * rows are selected.
 */
import { ref, computed } from "vue";
import Checkbox from "../components/ui/Checkbox.vue";
import Disclosure from "../../components/shared/Disclosure.vue";
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
  /** Force the body open regardless of the user's collapse state — set while a
   *  search is active and this section HAS matches. Without it a filtered
   *  section stayed collapsed and the user couldn't tell whether the query had
   *  found anything: every header just read "0 items" or a count they had to
   *  expand to see. */
  forceOpen?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  defaultOpen: true,
  kind: undefined,
  forceOpen: false,
});
const emit = defineEmits<{ (e: "toggle-all", v: boolean): void }>();

const userOpen = ref<boolean>(props.defaultOpen);
/** `forceOpen` wins while it's set; collapsing state is remembered underneath
 *  so clearing the search restores whatever the user had. */
const open = computed<boolean>(() => props.forceOpen || userOpen.value);
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

/** Writes the remembered state. While `forceOpen` holds the section open, a
 *  click still records the user's intent so it applies once the search clears. */
function toggleOpen(): void {
  userOpen.value = !open.value;
}
</script>

<template>
  <section class="wp-picker-section" :data-open="open ? 'true' : 'false'">
    <Disclosure
      class="wp-picker-section__disc"
      :open="open"
      lazy
      :trigger-attrs="{ 'data-test': 'picker-section-toggle' }"
      @update:open="toggleOpen"
    >
      <template #lead>
        <Checkbox
          class="wp-picker-section__check"
          data-test="picker-section-checkbox"
          :model-value="allSelected"
          :indeterminate="indeterminate"
          :aria-label="`Select all ${title}`"
          @update:model-value="(v: boolean) => emit('toggle-all', v)"
        />
      </template>
      <template #summary>
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
      </template>
      <div class="wp-picker-section__body">
        <slot />
      </div>
    </Disclosure>
  </section>
</template>

<style scoped>
@import "../../components/shared/row-primitives.css";

/* PickerSection — verbatim port from
 * docs/superpowers/ui-prototypes/import-export-redesign.html
 * lines 113-127. */

.wp-picker-section {
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  margin-bottom: 6px;
  overflow: hidden;
}
/* The heading is the shared Disclosure: the "select all" checkbox sits in
 * front of its button (so ticking it never folds the section), and the
 * button holds the icon, title, count and selection pill. */
.wp-disclosure.wp-picker-section__disc :deep(.wp-disclosure__head) {
  gap: 10px;
  padding: 0 14px;
}
.wp-disclosure.wp-picker-section__disc :deep(.wp-disclosure__trigger) {
  gap: 10px;
  min-height: 44px;
  padding: 0;
  border-radius: 0;
  font-weight: inherit;
}
.wp-disclosure.wp-picker-section__disc :deep(.wp-disclosure__trigger:hover) { background: none; }
.wp-disclosure.wp-picker-section__disc :deep(.wp-disclosure__head:hover) {
  background: color-mix(in oklab, var(--wp-bg-3) 60%, transparent);
}
.wp-disclosure.wp-picker-section__disc :deep(.wp-disclosure__content) { padding: 0; }
.wp-picker-section__count { flex: 1; }
.wp-picker-section__title {
  font-weight: 600;
  font-size: var(--wp-text-md);
  letter-spacing: -0.005em;
}
.wp-picker-section__count {
  color: var(--wp-text-muted);
  font-size: var(--wp-text-sm);
  font-feature-settings: "tnum";
}
.wp-picker-section__sel-pill {
  font-size: var(--wp-text-xs);
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--wp-radius-cap, 999px);
  background: color-mix(in oklab, var(--wp-accent-500) 18%, transparent);
  color: var(--wp-accent-text);
  font-feature-settings: "tnum";
}
.wp-picker-section__sel-pill[data-empty="true"] {
  background: var(--wp-bg-3);
  color: var(--wp-text-dim);
}

/* Section-header type-icon scale override — shared base is 16x16 and the
 * picker-row variant is 20x20. The section header bar is ~38px tall,
 * so the icon needs to read as a more substantial anchor against the
 * title text — bump to 26x26 with a 15px inner glyph. Phase 8 QA fix:
 * the previous 22px / 12px read weak. */
.wp-picker-section .wp-row-type-icon {
  width: 26px;
  height: 26px;
}
.wp-picker-section .wp-row-type-icon .pi {
  font-size: 15px;
}
.wp-picker-section__body {
  border-top: 1px solid var(--wp-border);
  background: var(--wp-bg-1);
  max-height: 420px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
/* Scrollbar styling — match the global pattern in
 * `manager/styles/tokens.css` (10px wide, transparent track, muted
 * thumb that brightens on hover). Scoped to the section body so
 * other surfaces keep using the global rule. */
.wp-picker-section__body::-webkit-scrollbar { width: 10px; height: 10px; }
.wp-picker-section__body::-webkit-scrollbar-track { background: transparent; }
.wp-picker-section__body::-webkit-scrollbar-thumb {
  background: var(--wp-scrollbar-thumb, rgba(255, 255, 255, 0.08));
  border-radius: var(--wp-radius-cap, 999px);
}
.wp-picker-section__body::-webkit-scrollbar-thumb:hover {
  background: var(--wp-scrollbar-thumb-hover, rgba(255, 255, 255, 0.16));
}
</style>
