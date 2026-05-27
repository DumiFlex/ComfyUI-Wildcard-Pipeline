<script setup lang="ts">
import { useRouter } from "vue-router";
import { toneVar, type DocTone } from "../../docs/registry";
export interface CrossLink { id: string; label: string; icon: string; tone: DocTone }
defineProps<{ links: CrossLink[] }>();
const router = useRouter();
</script>
<template>
  <div class="wp-doc-xlinks">
    <button v-for="l in links" :key="l.id" type="button" class="wp-doc-xlink" data-test="doc-xlink"
      :style="{ '--doc-tone': toneVar(l.tone) }" @click="router.push(`/docs/${l.id}`)">
      <i :class="l.icon" aria-hidden="true" /> {{ l.label }}
    </button>
  </div>
</template>
<style scoped>
.wp-doc-xlinks { display: flex; gap: 8px; flex-wrap: wrap; }
.wp-doc-xlink { display: inline-flex; align-items: center; gap: 8px; padding: 6px 11px; border-radius: 999px; background: var(--wp-bg-2); border: 1px solid var(--wp-border); color: var(--wp-text); font-size: 12px; font-family: inherit; cursor: pointer; }
.wp-doc-xlink:hover { border-color: var(--wp-border-strong); background: var(--wp-bg-3); }
.wp-doc-xlink .pi { font-size: 12px; color: var(--doc-tone); }
</style>
