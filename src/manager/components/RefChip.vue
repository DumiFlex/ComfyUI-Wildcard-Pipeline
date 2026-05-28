<!-- src/manager/components/RefChip.vue -->
<script setup lang="ts">
import { computed } from "vue";
import { KIND_ICON_MAP } from "../../components/shared/kind-icons";

/** Module kind for the `moduleKind` prop. Mirrors `ModuleKind` in
 *  `src/manager/cascade/resolveChip.ts` — duplicated as a local literal
 *  union so this component stays free of cascade-layer imports. */
type ChipModuleKind =
  | "wildcard" | "fixed_values" | "combine" | "derivation" | "constraint" | "bundle";

interface Props {
  /** "ref" → @{uuid} chip, "var" → $name chip. */
  kind: "ref" | "var";
  /** Display name. For unresolved refs this is empty; uuid is shown instead. */
  name: string;
  /** UUID of the wildcard library entry (ref-kind only). */
  uuid?: string;
  /** True when the name resolved against the catalog / surface. False → render as red `?` chip. */
  resolved: boolean;
  /** Sub-category filter (ref-kind only). Empty list = unfiltered. */
  subCategories?: string[];
  /** Module kind the resolved uuid points at — drives the chip's color
   *  (CSS custom property `--wp-refchip-tone`) + the leading PrimeIcon.
   *  Defaults to `wildcard` so existing callers that pass no `moduleKind`
   *  keep the legacy violet wildcard styling. Only honoured when the
   *  chip is `kind="ref"` AND `resolved` — unresolved chips stay red
   *  regardless. Var chips ignore this prop entirely. */
  moduleKind?: ChipModuleKind;
}

const props = withDefaults(defineProps<Props>(), {
  uuid: "",
  subCategories: () => [],
  moduleKind: "wildcard",
});

const emit = defineEmits<{
  /** Fired when a ref-kind chip body is clicked. The MouseEvent
   *  payload lets the parent read the chip's bounding rect (via
   *  `ev.currentTarget`) so it can anchor a popover near the chip
   *  instead of centred on screen. Var-kind chips don't emit. */
  "click": [event: MouseEvent];
}>();

const isRef = computed(() => props.kind === "ref");
const isFiltered = computed(() => isRef.value && props.subCategories.length > 0);

/** Render the sub-category suffix list. The reserved `"null"` keyword
 *  means EXCLUDE the wildcard's null option (2026-05-25 inverted
 *  semantic). Render it as `!null` so the negation reads at a glance
 *  rather than looking like a sub-cat selection. */
const subCategoriesLabel = computed(() =>
  props.subCategories.map((s) => (s === "null" ? "!null" : s)).join(", "),
);

const label = computed(() => {
  if (!props.resolved) {
    // Unresolved refs prefer the cached `#name` (kept on the ref atom
    // from the `@{uuid#name}` syntax) so a broken reference still
    // tells the user which wildcard was originally there. Falls back
    // to the uuid when no cached name is available (legacy bare-uuid
    // refs / older workflows). Vars keep showing the bare name.
    if (props.kind === "ref") {
      return props.name && props.name.length > 0 ? props.name : props.uuid;
    }
    return props.name;
  }
  return (isRef.value ? "@" : "$") + props.name;
});

/** Per-kind color CSS variable used as the chip's `--wp-refchip-tone`.
 *  `wildcard` keeps the legacy `--wp-kind-wildcard` (kind-aware path
 *  skipped). `bundle` has no `--wp-kind-bundle` token — falls back to
 *  text-muted, matching `toneVar("bundle")` in docs/registry.ts. */
const KIND_TONE: Record<ChipModuleKind, string> = {
  wildcard:     "var(--wp-kind-wildcard)",
  fixed_values: "var(--wp-kind-fixed)",
  combine:      "var(--wp-kind-combine)",
  derivation:   "var(--wp-kind-derivation)",
  constraint:   "var(--wp-kind-constraint)",
  bundle:       "var(--wp-text-muted)",
};

const isKindAware = computed(() =>
  isRef.value && props.resolved && props.moduleKind !== "wildcard",
);

const toneStyle = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {};
  if (isKindAware.value) out["--wp-refchip-tone"] = KIND_TONE[props.moduleKind];
  return out;
});

const kindIconCls = computed(() =>
  isKindAware.value ? KIND_ICON_MAP[props.moduleKind] : "",
);

const icon = computed(() => {
  if (!props.resolved) return "?";
  return isRef.value ? "✦" : "⌘";
});

function onClick(ev: MouseEvent): void {
  // Only ref-kind chips have a click-to-edit affordance. Var-kind chips
  // are pure visual marks — no picker to open.
  if (isRef.value && props.resolved) emit("click", ev);
}
</script>

<template>
  <span
    class="wp-refchip"
    :class="{
      'wp-refchip--var': kind === 'var',
      'wp-refchip--ref': kind === 'ref',
      'wp-refchip--unresolved': !resolved,
      'wp-refchip--filtered': isFiltered,
    }"
    :style="toneStyle"
    contenteditable="false"
    @click.stop="onClick"
  >
    <i
      v-if="kindIconCls"
      class="wp-refchip__icon wp-refchip__icon--pi"
      :class="kindIconCls"
      aria-hidden="true"
    ></i>
    <span v-else class="wp-refchip__icon" aria-hidden="true">{{ icon }}</span>
    <span class="wp-refchip__label">{{ label }}</span>
    <span v-if="isFiltered" class="wp-refchip__suffix">
      ·&nbsp;{{ subCategoriesLabel }}
    </span>
  </span>
</template>

<style scoped>
.wp-refchip {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  padding: 0 5px;
  margin: 1px 1px;
  border-radius: 3px;
  border: 1px solid;
  font: 10px/1.4 var(--wp-font-mono);
  user-select: none;
  cursor: default;
  vertical-align: baseline;
}
.wp-refchip--var {
  background: color-mix(in srgb, var(--wp-success, #22c55e) 15%, transparent);
  border-color: color-mix(in srgb, var(--wp-success, #22c55e) 50%, transparent);
  color: var(--wp-success);
}
/* Ref chip tone is sourced from `--wp-refchip-tone` — set per-instance
 * via inline style when `moduleKind` differs from `wildcard`. The
 * fallback to `--wp-kind-wildcard` keeps legacy (no-prop) callers on
 * the original violet palette. */
.wp-refchip--ref {
  background: color-mix(in srgb, var(--wp-refchip-tone, var(--wp-kind-wildcard, #a855f7)) 15%, transparent);
  border-color: color-mix(in srgb, var(--wp-refchip-tone, var(--wp-kind-wildcard, #a855f7)) 50%, transparent);
  color: var(--wp-refchip-tone, var(--wp-kind-wildcard));
  cursor: pointer;
}
.wp-refchip--ref:hover { background: color-mix(in srgb, var(--wp-refchip-tone, var(--wp-kind-wildcard, #a855f7)) 25%, transparent); }
.wp-refchip--unresolved {
  background: color-mix(in srgb, var(--wp-danger, #ef4444) 15%, transparent);
  border-color: color-mix(in srgb, var(--wp-danger, #ef4444) 50%, transparent);
  color: var(--wp-danger);
  cursor: help;
}
.wp-refchip__icon { font-size: 8px; opacity: 0.75; }
/* PrimeIcon variant (moduleKind set) — sized to align with the unicode glyph baseline. */
.wp-refchip__icon--pi { font-size: 9px; line-height: 1; }
.wp-refchip__suffix { color: var(--wp-status-modified, #fbbf24); font-size: 9px; opacity: 0.9; }
</style>
