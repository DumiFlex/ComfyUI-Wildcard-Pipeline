<script setup lang="ts">
import { computed } from "vue";
import type { ModuleType } from "../api/types";

const props = defineProps<{ type: ModuleType | "constraint" | "combine" | "derive" }>();

const meta = computed(() => {
  switch (props.type) {
    case "wildcard":
      return { icon: "pi pi-sparkles", label: "Wildcard", cls: "type-pill--wildcard" };
    case "fixed_values":
      return { icon: "pi pi-tag", label: "Fixed values", cls: "type-pill--fixed" };
    case "constraint":
      return { icon: "pi pi-filter", label: "Constraint", cls: "type-pill--constraint" };
    case "combine":
      return { icon: "pi pi-link", label: "Combine", cls: "type-pill--combine" };
    case "derive":
      return { icon: "pi pi-arrow-right-arrow-left", label: "Derive", cls: "type-pill--derive" };
    default:
      return { icon: "pi pi-question", label: String(props.type), cls: "" };
  }
});
</script>

<template>
  <span class="type-pill" :class="meta.cls">
    <i :class="meta.icon" aria-hidden="true" />
    <span>{{ meta.label }}</span>
  </span>
</template>

<style scoped>
.type-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 9px;
  letter-spacing: 0.3px;
}
.type-pill--wildcard   { color: var(--wp-violet); background: var(--wp-violet-bg); }
.type-pill--fixed      { color: var(--wp-rose);   background: var(--wp-rose-bg); }
.type-pill--constraint { color: var(--wp-amber);  background: var(--wp-amber-bg); }
.type-pill--combine    { color: var(--wp-teal);   background: var(--wp-teal-bg); }
.type-pill--derive     { color: var(--wp-green);  background: var(--wp-green-bg); }
</style>
