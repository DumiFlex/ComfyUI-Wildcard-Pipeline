<script setup lang="ts">
withDefaults(defineProps<{ kind?: "var" | "ref" | "inline" }>(), { kind: "var" });
</script>
<template><code class="wp-doc-token" :class="`wp-doc-token--${kind}`"><slot /></code></template>
<style scoped>
/* Tokens are inline-code chips: `white-space: nowrap` keeps each token whole
   (a 12-char `{N$$sep$$a|b|c}` doesn't shatter mid-syntax just because the
   column is tight), and `box-decoration-break: clone` is a safety net so any
   token that DOES happen to break (e.g. wrapped multiword content in a long
   example) carries its background + padding onto the continuation line
   instead of leaving a one-sided "cutoff" highlight. */
.wp-doc-token { font-family: var(--wp-font-mono); font-size: 0.92em; padding: 1px 4px; border-radius: 4px; white-space: nowrap; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.wp-doc-token--var { color: var(--wp-accent-text); background: color-mix(in oklab, var(--wp-accent-500) 12%, transparent); }
.wp-doc-token--ref { color: var(--wp-kind-ref); background: var(--wp-kind-ref-bg); }
.wp-doc-token--inline { color: var(--wp-kind-derivation); background: var(--wp-kind-derivation-bg); }
</style>
