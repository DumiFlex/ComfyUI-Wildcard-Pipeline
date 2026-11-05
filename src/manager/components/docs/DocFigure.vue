<script setup lang="ts">
import DocFigureText from "./DocFigureText.vue";

/** `figure`: key of its written description in `docs/figures.ts`. */
defineProps<{ caption?: string; figure?: string }>();
</script>
<template>
  <figure class="wp-doc-figure">
    <div class="wp-doc-figure__frame"><slot /></div>
    <figcaption v-if="caption" class="wp-doc-figure__cap">{{ caption }}</figcaption>
  </figure>
  <DocFigureText :figure="figure" :caption="caption" />
</template>
<style scoped>
.wp-doc-figure { margin: 0; display: flex; flex-direction: column; gap: 7px; }
.wp-doc-figure__frame { background: var(--wp-bg-1); border: 1px solid var(--wp-border); border-radius: var(--wp-radius-lg); padding: 22px 20px; }
.wp-doc-figure__cap { font-size: 11.5px; color: var(--wp-text-dim); text-align: center; }
</style>
