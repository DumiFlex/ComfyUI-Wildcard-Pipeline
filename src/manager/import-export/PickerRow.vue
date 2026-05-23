<script setup lang="ts">
/**
 * One entity row for a picker section (export picker, import picker).
 *
 * Pure presentational: receives the checked state + badge/warning data
 * from the parent, emits `update:checked` when the user toggles. No
 * knowledge of section/bucket logic — that's PickerSection's job.
 *
 * `indent` lets a parent express nesting (e.g. a wildcard inside a
 * bundle row gets `indent=1`); each level adds 16px of left padding.
 *
 * Polish A enrichments (visual parity with legacy import/export UI):
 *   - `kind` prop renders a tinted PrimeIcons glyph between the
 *     checkbox and the name. `kindIcon()` + KIND_META tint map are
 *     shared with BundleChildRow.vue / BundleAddChildModal / the
 *     Context widget — one canonical map per project rule.
 *   - `showId` opt-in renders the short 8-hex id as a muted mono span
 *     next to the name (mirrors the legacy importer's UUID column).
 *   - `categoryName` + `categoryColor` render a subtle tinted pill so
 *     users see organizational metadata without expanding the row.
 *   - `depWarnings` collapse behind a single "⚠ N unresolved refs"
 *     chip with `aria-expanded` / `aria-controls` (WAI-ARIA disclosure
 *     pattern; same shape as Tier3ChainViz's "Why?" toggle). One row
 *     of warnings can balloon to a dozen on heavily-cross-referenced
 *     exports — keep the row compact until the user asks.
 *
 * All new props are optional with sensible defaults so existing
 * callers (ExportTab, ImportPicker, the seven Task-11 tests) keep
 * working without changes. Polish B/C dispatches will start passing
 * the enriched data through.
 */
import { computed, ref, useId } from "vue";
import Checkbox from "../components/ui/Checkbox.vue";
import { kindIcon } from "../../components/shared/kind-icons";

export interface Badge {
  label: string;
  /**
   * - `info`  — neutral chip (e.g. "migrated from v0")
   * - `warn`  — amber chip (e.g. "fingerprint differs from library")
   * - `error` — red chip (e.g. "uuid collision")
   */
  kind: "info" | "warn" | "error";
}

interface KindMeta {
  label: string;
  color: string;
}

/**
 * Mirrors `KIND_META` in `src/manager/components/BundleChildRow.vue`
 * (lines 45-52) exactly. Changing colors here means changing them
 * there — single source candidate but kept duplicated for now since
 * the two surfaces share no module yet. Bundle + category labels are
 * additions over BundleChildRow (which doesn't render categories) and
 * are needed for the legacy importer parity.
 */
const KIND_META: Record<string, KindMeta> = {
  wildcard:     { label: "Wildcard",   color: "var(--wp-kind-wildcard, #34d399)" },
  fixed_values: { label: "Fixed",      color: "var(--wp-kind-fixed, #22d3ee)" },
  combine:      { label: "Combine",    color: "var(--wp-kind-combine, #fbbf24)" },
  derivation:   { label: "Derivation", color: "var(--wp-kind-derivation, #a78bfa)" },
  constraint:   { label: "Constraint", color: "var(--wp-kind-constraint, #f87171)" },
  bundle:       { label: "Bundle",     color: "var(--wp-bundle-default, #46566B)" },
  category:     { label: "Category",   color: "var(--wp-text-dim, #8a8a9a)" },
};

interface Props {
  uuid: string;
  name: string;
  checked: boolean;
  badges: Badge[];
  /**
   * Human-readable dep-graph warnings (e.g. "references @{aabbccdd}
   * not selected"). Collapsed behind a chip when length > 0; the
   * full list expands beneath the row on click.
   */
  depWarnings: string[];
  /** 0..n indent levels. Each level adds 16px of left padding. */
  indent?: number;
  /**
   * Entity type for icon + tint. One of: wildcard, fixed_values,
   * combine, derivation, constraint, bundle, category. Optional —
   * when absent, no icon renders.
   */
  kind?: string;
  /** Optional category metadata. When set, renders a small color-tinted
   *  chip with the category name. */
  categoryName?: string;
  categoryColor?: string;
  /** Show the short 8-hex id inline next to the name (muted style).
   *  Defaults to false so existing tests don't regress. */
  showId?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  indent: 0,
  kind: undefined,
  categoryName: undefined,
  categoryColor: undefined,
  showId: false,
});
const emit = defineEmits<{ (e: "update:checked", v: boolean): void }>();

// ---------- Kind icon ----------

const iconClass = computed<string | null>(() =>
  props.kind ? kindIcon(props.kind) : null,
);

const kindMeta = computed<KindMeta | null>(() => {
  if (!props.kind) return null;
  return (
    KIND_META[props.kind] ?? {
      label: props.kind.toUpperCase(),
      color: "var(--wp-text-dim, #8a8a9a)",
    }
  );
});

// ---------- Short id ----------

/**
 * The id passed in is the entity's full id (typically the 8-hex
 * short uuid produced by `engine/modules.py`, but defensive
 * `slice(0, 8)` handles the unlikely case of a longer caller-supplied
 * id — e.g. a legacy 36-char UUID — without breaking layout.
 */
const shortId = computed<string>(() => props.uuid.slice(0, 8));

// ---------- Category chip tint ----------

/**
 * Mix the user-supplied category color with --wp-bg-3 so the chip
 * background stays readable against the row background regardless of
 * how saturated the chosen color is. Mirrors the `color-mix` pattern
 * used by `.wp-bchild[data-selected]` (BundleChildRow.vue:194).
 */
const categoryChipStyle = computed<Record<string, string>>(() => {
  const style: Record<string, string> = {};
  if (props.categoryColor) {
    style["--wp-cat-color"] = props.categoryColor;
  }
  return style;
});

// ---------- Dep warnings disclosure ----------

const warnExpanded = ref<boolean>(false);
/** Stable id for the warnings list so the chip's aria-controls
 *  can reference it. Vue 3.5+ `useId()` gives us one deterministic
 *  id per component instance — same pattern Tier3ChainViz uses. */
const warnBodyId = useId();

const warnChipLabel = computed<string>(
  () => `${props.depWarnings.length} unresolved ref${props.depWarnings.length === 1 ? "" : "s"}`,
);

function toggleWarnExpanded(): void {
  warnExpanded.value = !warnExpanded.value;
}
</script>

<template>
  <div
    class="wp-picker-row"
    :data-uuid="props.uuid"
    :style="{ paddingLeft: `${props.indent * 16}px` }"
  >
    <Checkbox
      class="wp-picker-row__check"
      :model-value="checked"
      :aria-label="name"
      @update:model-value="(v: boolean) => emit('update:checked', v)"
    />
    <span
      v-if="iconClass && kindMeta"
      class="wp-picker-row__kindicon"
      :style="{ '--wp-row-kind': kindMeta.color }"
      :title="kindMeta.label"
      aria-hidden="true"
    >
      <i :class="iconClass" />
    </span>
    <span class="wp-picker-row__name">{{ name }}</span>
    <span
      v-if="props.showId"
      class="wp-picker-row__id"
      data-test="picker-row-id"
    >{{ shortId }}</span>
    <span
      v-if="props.categoryName"
      class="wp-picker-row__cat-chip"
      :style="categoryChipStyle"
      data-test="picker-row-cat-chip"
    >{{ props.categoryName }}</span>
    <span class="wp-picker-row__badges">
      <span
        v-for="b in badges"
        :key="b.label"
        class="wp-picker-row__badge"
        :class="`wp-picker-row__badge--${b.kind}`"
      >{{ b.label }}</span>
    </span>
    <button
      v-if="depWarnings.length > 0"
      type="button"
      class="wp-picker-row__warn-chip"
      :aria-expanded="warnExpanded ? 'true' : 'false'"
      :aria-controls="warnBodyId"
      data-test="dep-warn-chip"
      @click="toggleWarnExpanded"
    >
      <span aria-hidden="true">⚠</span>
      <span>{{ warnChipLabel }}</span>
    </button>
    <ul
      v-if="depWarnings.length > 0 && warnExpanded"
      :id="warnBodyId"
      class="wp-picker-row__warns"
      data-test="dep-warn-list"
    >
      <li
        v-for="(w, idx) in depWarnings"
        :key="idx"
        class="wp-picker-row__warn"
      >⚠ {{ w }}</li>
    </ul>
  </div>
</template>

<style scoped>
.wp-picker-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  font-size: 13px;
  color: var(--wp-text);
}
.wp-picker-row__kindicon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 18px;
  border-radius: var(--wp-radius-sm);
  background: color-mix(in oklab, var(--wp-row-kind) 18%, var(--wp-bg-3));
  color: var(--wp-row-kind);
  font-size: 11px;
  flex: 0 0 auto;
}
.wp-picker-row__name {
  flex: 0 1 auto;
  font-family: var(--wp-font-sans);
}
.wp-picker-row__id {
  font-family: var(--wp-font-mono);
  font-size: 11px;
  color: var(--wp-text-dim);
  letter-spacing: 0.02em;
}
.wp-picker-row__cat-chip {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--wp-cat-color, var(--wp-text-dim)) 18%, var(--wp-bg-3));
  color: var(--wp-cat-color, var(--wp-text-dim));
  border: 1px solid color-mix(in oklab, var(--wp-cat-color, var(--wp-text-dim)) 36%, transparent);
  line-height: 1.4;
}
.wp-picker-row__badges {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.wp-picker-row__badge {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: var(--wp-radius-sm);
  background: var(--wp-bg3);
  color: var(--wp-text2);
  line-height: 1.4;
}
.wp-picker-row__badge--warn {
  background: color-mix(in oklab, var(--wp-warn) 18%, transparent);
  color: var(--wp-warn);
}
.wp-picker-row__badge--error {
  background: color-mix(in oklab, var(--wp-danger) 18%, transparent);
  color: var(--wp-danger);
}
.wp-picker-row__warn-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: color-mix(in oklab, var(--wp-warn) 14%, transparent);
  color: var(--wp-warn);
  border: 1px solid color-mix(in oklab, var(--wp-warn) 36%, transparent);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;
  cursor: pointer;
}
.wp-picker-row__warn-chip:hover {
  background: color-mix(in oklab, var(--wp-warn) 24%, transparent);
}
.wp-picker-row__warns {
  flex-basis: 100%;
  list-style: none;
  margin: 0;
  padding: 0 0 0 24px; /* indent past the checkbox so warnings line up under name */
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wp-picker-row__warn {
  font-size: 11px;
  color: var(--wp-warn);
}
</style>
