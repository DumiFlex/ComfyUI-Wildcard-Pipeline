<script setup lang="ts">
/**
 * The module-type chip: `wildcard`, `fixed_values`, `combine`, `constraint`,
 * `derivation` or `bundle`, in the kind colour the extension uses for that
 * type everywhere (`--wp-kind-*`; bundles are slate, `--wp-bundle-default`).
 *
 *   <KindChip kind="module" subtype="wildcard" />
 *   <KindChip kind="bundle" />
 *
 * A module with no subtype reads as `fixed_values`, the oldest type.
 */
import { computed } from "vue";

export type KindChipSubtype = "fixed_values" | "combine" | "wildcard" | "constraint" | "derivation";

const props = defineProps<{
  kind: "module" | "bundle";
  /** A `"bundle"` subtype reads as a bundle too (some APIs report it so). */
  subtype?: KindChipSubtype | "bundle" | null | undefined;
}>();

const type = computed(() => (props.kind === "bundle" ? "bundle" : (props.subtype ?? "fixed_values")));
</script>

<template>
  <span class="wp-kind-chip" :data-type="type">{{ type }}</span>
</template>

<style scoped>
.wp-kind-chip {
  --kind-chip-c: var(--wp-text-muted);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: var(--wp-radius-cap, 999px);
  font-family: var(--wp-font-mono);
  font-size: 11px;
  font-weight: 500;
  line-height: 14px;
  letter-spacing: -0.01em;
  white-space: nowrap;
  color: var(--kind-chip-c);
  background: color-mix(in oklab, var(--kind-chip-c) 14%, transparent);
  border: 1px solid color-mix(in oklab, var(--kind-chip-c) 38%, transparent);
}
.wp-kind-chip[data-type="fixed_values"] { --kind-chip-c: var(--wp-kind-fixed); }
.wp-kind-chip[data-type="combine"] { --kind-chip-c: var(--wp-kind-combine); }
.wp-kind-chip[data-type="wildcard"] { --kind-chip-c: var(--wp-kind-wildcard); }
.wp-kind-chip[data-type="constraint"] { --kind-chip-c: var(--wp-kind-constraint); }
.wp-kind-chip[data-type="derivation"] { --kind-chip-c: var(--wp-kind-derivation); }
.wp-kind-chip[data-type="bundle"] { --kind-chip-c: var(--wp-bundle-default); }
</style>
