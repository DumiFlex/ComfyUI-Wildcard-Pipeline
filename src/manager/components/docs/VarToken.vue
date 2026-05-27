<script setup lang="ts">
withDefaults(defineProps<{ kind?: "var" | "ref" | "inline" }>(), { kind: "var" });
</script>
<template><code class="wp-doc-token" :class="`wp-doc-token--${kind}`"><slot /></code></template>
<style scoped>
.wp-doc-token { font-family: var(--wp-font-mono); font-size: 0.92em; padding: 1px 4px; border-radius: 4px; white-space: nowrap; }
.wp-doc-token--var { color: var(--wp-accent-text); background: color-mix(in oklab, var(--wp-accent-500) 12%, transparent); }
.wp-doc-token--ref { color: var(--wp-kind-ref); background: var(--wp-kind-ref-bg); }
.wp-doc-token--inline { color: var(--wp-kind-derivation); background: var(--wp-kind-derivation-bg); }
</style>
