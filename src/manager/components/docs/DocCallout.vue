<script setup lang="ts">
withDefaults(defineProps<{ variant?: "tip" | "warn" | "danger" }>(), { variant: "tip" });
const ICON = { tip: "pi pi-info-circle", warn: "pi pi-exclamation-triangle", danger: "pi pi-times-circle" };
</script>
<template>
  <div class="wp-doc-callout" :class="`wp-doc-callout--${variant}`">
    <i :class="ICON[variant]" aria-hidden="true" />
    <div class="wp-doc-callout__body"><slot /></div>
  </div>
</template>
<style scoped>
.wp-doc-callout { display: flex; gap: 11px; padding: 12px 14px; border-radius: var(--wp-radius); font-size: 12.5px; line-height: 1.55; }
.wp-doc-callout .pi { font-size: 15px; margin-top: 1px; }
.wp-doc-callout--tip { background: color-mix(in oklab, var(--wp-info) 9%, transparent); border: 1px solid color-mix(in oklab, var(--wp-info) 28%, transparent); }
.wp-doc-callout--tip .pi { color: var(--wp-info); }
.wp-doc-callout--warn { background: color-mix(in oklab, var(--wp-warn) 10%, transparent); border: 1px solid color-mix(in oklab, var(--wp-warn) 30%, transparent); }
.wp-doc-callout--warn .pi { color: var(--wp-warn); }
.wp-doc-callout--danger { background: color-mix(in oklab, var(--wp-danger) 10%, transparent); border: 1px solid color-mix(in oklab, var(--wp-danger) 30%, transparent); }
.wp-doc-callout--danger .pi { color: var(--wp-danger); }
</style>
