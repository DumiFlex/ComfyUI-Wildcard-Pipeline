<script setup lang="ts">
/**
 * One entity row for a picker section (export picker, import picker).
 *
 * Pure presentational: receives the checked state + badge/dep data from
 * the parent, emits `update:checked` when the user toggles. No knowledge
 * of section/bucket logic — that's PickerSection's job.
 *
 * Phase-1 contract (canonical SPA primitives):
 *   - `kind` slug picks the canonical PrimeIcons glyph (from
 *     `shared/kind-icons`) + the matching `.wp-row-type-icon--{slug}`
 *     tint variant in `shared/row-primitives.css`.
 *   - `showId` opt-in renders the short 8-hex id via the global `.wp-id`
 *     primitive (`manager/styles/tokens.css`).
 *   - `categoryName` + `categoryColor` use the shared `.wp-cat-chip`
 *     primitive (tokens.css) styled via `catChipStyle` from
 *     `../utils/catChip`.
 *   - `statusBadges` render through the shared `.wp-mod-badge` family
 *     (row-primitives.css) — every consumer surface uses the same
 *     letterform and palette, no Polish-A custom chip styling left.
 *   - `unselectedDeps` / `missingDeps` collapse behind expandable
 *     `.wp-dep-chip` (amber / red) — caller-specific layout still lives
 *     in this file's scoped styles since the dep-list shape is unique
 *     to the picker surface.
 *
 * `indent` lets a parent express nesting (e.g. a wildcard inside a
 * bundle row gets `indent=1`); each level adds 16px of left padding.
 */
import { computed, ref, useId } from "vue";
import Checkbox from "../components/ui/Checkbox.vue";
import { kindIcon } from "../../components/shared/kind-icons";
import { catChipStyle } from "../utils/catChip";

/**
 * Status-badge taxonomy — five variants paired 1:1 with
 * `.wp-mod-badge--{variant}` in `row-primitives.css`. NEW / MIGRATED
 * are the Phase-1 additions; MOD / DRIFT / MISSING were already shared.
 */
export interface StatusBadge {
  variant: "new" | "mod" | "drift" | "missing" | "migrated";
  /** Display label (e.g. "NEW", "MODIFIED", "MIGRATED v0→1"). Rendered
   *  verbatim — caller controls casing. */
  label: string;
}

/**
 * One outgoing-dependency reference. Used by both
 * `unselectedDeps` (export-side: ref present in payload but unselected)
 * and `missingDeps` (import-side: ref absent from payload AND library).
 */
export interface DepRef {
  /** Target entity id (8-hex short uuid in normal flows). */
  id: string;
  /** Display name. Falls back to `id` at the call site if unknown. */
  name: string;
  /** Optional entity kind for the dep-list type icon (e.g. "wildcard"). */
  type?: string;
}

/**
 * `kind` slug → `.wp-row-type-icon--{class}` modifier. Mirrors the
 * prototype mapping (import-export-redesign.html:157–162). Module subtype
 * `fixed_values` collapses to `fixed`; `category` reuses the `bundle`
 * neutral tint since categories don't carry their own kind color.
 */
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
  /** Entity id; consumer passes `entity.id`. */
  uuid: string;
  name: string;
  checked: boolean;
  /** Entity kind for the type-icon column. */
  kind?: string;
  /** Optional category metadata for the `.wp-cat-chip` primitive. */
  categoryName?: string;
  categoryColor?: string;
  /** Show the short 8-hex id inline (mono, muted) via `.wp-id`. */
  showId?: boolean;
  /** Status badges — collision state / migration / etc. Multiple allowed.
   *  Rendered in order, all use the shared `.wp-mod-badge` primitive. */
  statusBadges?: StatusBadge[];
  /** Outgoing refs NOT in the current selection (Export side).
   *  Renders an amber "Requires N" chip that expands inline. */
  unselectedDeps?: DepRef[];
  /** Outgoing refs not in payload AND not in receiver library
   *  (Import side). Renders a red "Missing N" chip that expands inline
   *  with an "unresolvable" verdict. */
  missingDeps?: DepRef[];
  /** 0..n indent levels. Each level adds 16px of left padding. */
  indent?: number;
}

const props = withDefaults(defineProps<Props>(), {
  kind: undefined,
  categoryName: undefined,
  categoryColor: undefined,
  showId: false,
  statusBadges: () => [],
  unselectedDeps: () => [],
  missingDeps: () => [],
  indent: 0,
});
const emit = defineEmits<{ (e: "update:checked", v: boolean): void }>();

// ---------- Kind icon ----------

/** Glyph class — `pi pi-sparkles` for wildcard, etc. */
const iconClass = computed<string | null>(() =>
  props.kind ? kindIcon(props.kind) : null,
);

/** Modifier class slug for `.wp-row-type-icon--{slug}` tint. */
const kindClass = computed<string | null>(() => {
  if (!props.kind) return null;
  return KIND_CLASS[props.kind] ?? "bundle";
});

// ---------- Short id ----------

/**
 * Slice defensively in case a caller supplies a 36-char UUID instead of
 * the canonical 8-hex short id.
 */
const shortId = computed<string>(() => props.uuid.slice(0, 8));

// ---------- Category chip style ----------

const catChipInlineStyle = computed<Record<string, string>>(() =>
  catChipStyle(props.categoryColor),
);

// ---------- Dep chip disclosure ----------

const unselectedExpanded = ref<boolean>(false);
const missingExpanded = ref<boolean>(false);

/** Stable ids for the disclosure list elements (aria-controls). */
const unselectedListId = useId();
const missingListId = useId();

function toggleUnselected(): void {
  unselectedExpanded.value = !unselectedExpanded.value;
}
function toggleMissing(): void {
  missingExpanded.value = !missingExpanded.value;
}

/** Resolve a dep's kind→tint class for the dep-list type icon. */
function depKindClass(d: DepRef): string {
  if (!d.type) return "bundle";
  return KIND_CLASS[d.type] ?? "bundle";
}
function depIconClass(d: DepRef): string {
  if (!d.type) return "pi pi-circle";
  return kindIcon(d.type);
}
</script>

<template>
  <div
    class="wp-picker-row"
    :data-uuid="props.uuid"
    :data-checked="props.checked ? 'true' : 'false'"
    :style="{ paddingLeft: `${props.indent * 16}px` }"
  >
    <!-- chevron-spacer column (kept empty; reserves grid space matching
         the prototype's 14px leading column). -->
    <span class="wp-picker-row__chev-spacer" aria-hidden="true" />

    <Checkbox
      class="wp-picker-row__check"
      :model-value="checked"
      :aria-label="name"
      @update:model-value="(v: boolean) => emit('update:checked', v)"
    />

    <span
      v-if="iconClass && kindClass"
      class="wp-row-type-icon"
      :class="`wp-row-type-icon--${kindClass}`"
      aria-hidden="true"
    >
      <i :class="iconClass" />
    </span>

    <div class="wp-row-name">
      <span class="wp-picker-row__name">{{ name }}</span>
      <span
        v-if="props.showId"
        class="wp-id"
        data-test="picker-row-id"
      >{{ shortId }}</span>
    </div>

    <span
      v-if="props.categoryName"
      class="wp-cat-chip"
      :style="catChipInlineStyle"
      data-test="picker-row-cat-chip"
    >{{ props.categoryName }}</span>
    <span v-else class="wp-picker-row__col-spacer" aria-hidden="true" />

    <span v-if="props.statusBadges.length > 0" class="wp-picker-row__badges">
      <span
        v-for="b in props.statusBadges"
        :key="b.label"
        class="wp-mod-badge"
        :class="`wp-mod-badge--${b.variant}`"
      >{{ b.label }}</span>
    </span>
    <span v-else class="wp-picker-row__col-spacer" aria-hidden="true" />

    <span
      v-if="props.unselectedDeps.length === 0 && props.missingDeps.length === 0"
      class="wp-picker-row__col-spacer"
      aria-hidden="true"
    />
    <span v-else class="wp-picker-row__dep-chips">
      <button
        v-if="props.unselectedDeps.length > 0"
        type="button"
        class="wp-dep-chip"
        :aria-expanded="unselectedExpanded ? 'true' : 'false'"
        :aria-controls="unselectedListId"
        data-test="dep-warn-chip"
        @click="toggleUnselected"
      >
        <i class="pi pi-arrow-right" aria-hidden="true" />
        <span>Requires {{ props.unselectedDeps.length }}</span>
      </button>
      <button
        v-if="props.missingDeps.length > 0"
        type="button"
        class="wp-dep-chip wp-dep-chip--missing"
        :aria-expanded="missingExpanded ? 'true' : 'false'"
        :aria-controls="missingListId"
        data-test="dep-missing-chip"
        @click="toggleMissing"
      >
        <i class="pi pi-exclamation-triangle" aria-hidden="true" />
        <span>Missing {{ props.missingDeps.length }}</span>
      </button>
    </span>

    <div
      v-if="props.unselectedDeps.length > 0 && unselectedExpanded"
      :id="unselectedListId"
      class="wp-row-dep-list"
      data-test="dep-warn-list"
    >
      <div class="wp-row-dep-list__title">Requires · not selected</div>
      <div
        v-for="d in props.unselectedDeps"
        :key="`u:${d.id}`"
        class="wp-row-dep-list__item"
      >
        <i :class="depIconClass(d)" aria-hidden="true" />
        <span class="wp-row-dep-list__name">{{ d.name }}</span>
        <span class="wp-row-dep-list__id">{{ d.id.slice(0, 8) }}</span>
        <span
          class="wp-row-dep-list__type"
          :class="`wp-row-dep-list__type--${depKindClass(d)}`"
        />
      </div>
    </div>

    <div
      v-if="props.missingDeps.length > 0 && missingExpanded"
      :id="missingListId"
      class="wp-row-dep-list wp-row-dep-list--missing"
      data-test="dep-missing-list"
    >
      <div
        class="wp-row-dep-list__title wp-row-dep-list__title--missing"
      >Missing · not in payload or library</div>
      <div
        v-for="d in props.missingDeps"
        :key="`m:${d.id}`"
        class="wp-row-dep-list__item"
      >
        <i :class="depIconClass(d)" aria-hidden="true" />
        <span class="wp-row-dep-list__name">{{ d.name }}</span>
        <span class="wp-row-dep-list__id">@{{ '{' }}{{ d.id.slice(0, 8) }}{{ '}' }}</span>
        <span class="wp-row-dep-list__verdict">unresolvable</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Pull in shared row primitives: .wp-row-type-icon + .wp-mod-badge live
 * here. Vue's scoper safely runs PostCSS over the @import.
 * Note: row-primitives.css is NOT wrapped in @layer wp-extension since
 * Vue's scoped CSS parser can't handle the atrule — namespace prefixes
 * carry isolation duty (see CLAUDE.md). */
@import "../../components/shared/row-primitives.css";

/* PickerRow — verbatim port from
 * docs/superpowers/ui-prototypes/import-export-redesign.html
 * lines 143-224. */

/* Picker-surface icon scale override — shared base is 16x16; prototype
 * paints picker rows at 20x20 with an 11px glyph (lines 156-157). */
.wp-picker-row .wp-row-type-icon {
  width: 20px;
  height: 20px;
  border-radius: var(--wp-radius-sm);
}
.wp-picker-row .wp-row-type-icon .pi {
  font-size: 11px;
}

.wp-picker-row {
  display: grid;
  /* chev-spacer, checkbox, type-icon, name+id, cat-chip, status-badges, dep-chips */
  grid-template-columns: 14px 18px minmax(0, auto) minmax(0, 1fr) auto auto auto;
  column-gap: 9px;
  align-items: center;
  padding: 5px 14px 5px 32px;
  border-bottom: 1px solid color-mix(in oklab, var(--wp-border) 50%, transparent);
  font-size: var(--wp-text-sm);
}
.wp-picker-row:last-child { border-bottom: none; }
.wp-picker-row:hover {
  background: color-mix(in oklab, var(--wp-bg-3) 35%, transparent);
}
.wp-picker-row[data-state="will-skip"] .wp-picker-row__name {
  color: var(--wp-text-dim);
  text-decoration: line-through;
  text-decoration-color: color-mix(in oklab, var(--wp-text-dim) 40%, transparent);
}
.wp-picker-row[data-state="will-skip"] { opacity: .7; }

.wp-picker-row__chev-spacer {
  width: 14px;
  height: 1px;
  display: inline-block;
}
.wp-picker-row__col-spacer {
  display: inline-block;
}

.wp-row-name {
  /* Explicit flex-direction: row to override the global
   * `.wp-row-name { flex-direction: column }` from
   * manager/styles/tokens.css:1002. The picker row's name + id pair
   * sits horizontally on a shared baseline. */
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 9px;
  min-width: 0;
}
.wp-picker-row__name {
  font-weight: 500;
  color: var(--wp-text);
  letter-spacing: -0.005em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Short id — mirrors prototype lines 171-173 (mono font, dim text, copy
 * cursor). */
.wp-id {
  font-family: var(--wp-font-mono);
  font-size: 10px;
  color: var(--wp-text-dim);
  letter-spacing: 0;
  font-weight: 500;
  cursor: copy;
  flex-shrink: 0;
}
.wp-id:hover { color: var(--wp-text-muted); }

/* Category chip — mirrors prototype lines 176-177. */
.wp-cat-chip {
  font-size: var(--wp-text-xs);
  font-weight: 500;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid;
  letter-spacing: .01em;
  flex-shrink: 0;
  white-space: nowrap;
}

/* Status badges — mirrors prototype lines 180-187. Picker-row local
 * override (slightly tighter than shared row-primitives baseline). */
.wp-picker-row .wp-mod-badge {
  font-family: var(--wp-font);
  font-weight: 700;
  font-size: 9.5px;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 3px 6px;
  border-radius: 2px;
  flex-shrink: 0;
  white-space: nowrap;
}

.wp-picker-row__badges {
  display: inline-flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px;
}

.wp-picker-row__dep-chips {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* Dep chip — amber (unselected deps) / red (truly missing).
 * Verbatim from prototype lines 190-199. */
.wp-dep-chip {
  background: color-mix(in oklab, var(--wp-warn) 14%, transparent);
  color: var(--wp-warn);
  font-family: var(--wp-font);
  font-size: var(--wp-text-xs);
  font-weight: 500;
  padding: 2px 8px 2px 6px;
  border-radius: var(--wp-radius-sm);
  border: 1px solid color-mix(in oklab, var(--wp-warn) 32%, transparent);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.wp-dep-chip--missing {
  background: color-mix(in oklab, var(--wp-danger) 14%, transparent);
  color: var(--wp-danger);
  border-color: color-mix(in oklab, var(--wp-danger) 32%, transparent);
}
.wp-dep-chip .pi { font-size: 9px; }
.wp-dep-chip:hover {
  background: color-mix(in oklab, var(--wp-warn) 24%, transparent);
}
.wp-dep-chip--missing:hover {
  background: color-mix(in oklab, var(--wp-danger) 22%, transparent);
}

/* Expanded dep list — spans full row width below the chip(s).
 * Verbatim from prototype lines 201-223. */
.wp-row-dep-list {
  grid-column: 1 / -1;
  background: color-mix(in oklab, var(--wp-warn) 6%, transparent);
  border-top: 1px dashed color-mix(in oklab, var(--wp-warn) 28%, transparent);
  border-bottom: 1px dashed color-mix(in oklab, var(--wp-warn) 28%, transparent);
  margin: 5px -14px -5px -32px;
  padding: 9px 14px 9px 54px;
  font-size: var(--wp-text-xs);
  color: var(--wp-text-muted);
}
.wp-row-dep-list--missing {
  background: color-mix(in oklab, var(--wp-danger) 6%, transparent);
  border-color: color-mix(in oklab, var(--wp-danger) 28%, transparent);
}
.wp-row-dep-list__title {
  font-weight: 700;
  color: var(--wp-warn);
  margin-bottom: 5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 9.5px;
}
.wp-row-dep-list__title--missing { color: var(--wp-danger); }
.wp-row-dep-list__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2.5px 0;
}
.wp-row-dep-list__item .pi {
  font-size: 10px;
  color: var(--wp-text-dim);
}
.wp-row-dep-list__name {
  color: var(--wp-text);
  font-weight: 500;
}
.wp-row-dep-list__id {
  color: var(--wp-text-dim);
  font-family: var(--wp-font-mono);
  font-size: 10px;
}
.wp-row-dep-list__action {
  margin-left: auto;
  background: transparent;
  border: 1px solid color-mix(in oklab, var(--wp-warn) 32%, transparent);
  color: var(--wp-warn);
  font-size: 9.5px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: var(--wp-radius-sm);
  cursor: pointer;
  font-family: var(--wp-font);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.wp-row-dep-list__action:hover {
  background: color-mix(in oklab, var(--wp-warn) 18%, transparent);
}
.wp-row-dep-list__verdict {
  margin-left: auto;
  color: var(--wp-danger);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
</style>
