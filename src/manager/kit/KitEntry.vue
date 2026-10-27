<script setup lang="ts">
/**
 * One kit entry: name, where it lives, when to use it, a live demo (the
 * default slot) and how to write it. Text comes from `registry.ts`.
 */
import { computed } from "vue";
import { KIT_EXAMPLES, kitEntry } from "./registry";

const props = defineProps<{ id: string }>();
const entry = computed(() => kitEntry(props.id));
const example = computed(() => KIT_EXAMPLES[props.id]);
const SURFACE_LABEL = { manager: "Manager", canvas: "Canvas" } as const;
</script>

<template>
  <article :id="`kit-${entry.id}`" class="wp-kit-entry" :data-kit-entry="entry.id">
    <header class="wp-kit-entry__head">
      <h3 class="wp-kit-entry__name">{{ entry.name }}</h3>
      <span v-for="s in entry.surfaces" :key="s" class="wp-chip" :data-test="`kit-surface-${s}`">{{ SURFACE_LABEL[s] }}</span>
      <code class="wp-kit-entry__file">{{ entry.file }}</code>
    </header>
    <p class="wp-kit-entry__use">{{ entry.use }}</p>
    <p v-if="entry.instead" class="wp-kit-entry__instead">Instead of: {{ entry.instead }}</p>
    <div class="wp-kit-entry__demo">
      <slot />
    </div>
    <pre v-if="example" class="wp-kit-entry__code"><code>{{ example }}</code></pre>
  </article>
</template>

<style scoped>
.wp-kit-entry {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-4);
  padding: var(--wp-space-6);
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg);
  scroll-margin-top: 80px;
  min-width: 0;
}
.wp-kit-entry__head { display: flex; align-items: center; gap: var(--wp-space-3); flex-wrap: wrap; }
.wp-kit-entry__name { margin: 0; font-size: var(--wp-text-md); font-weight: 600; color: var(--wp-text); }
.wp-kit-entry__file {
  margin-left: auto;
  font: var(--wp-text-xs) / 16px var(--wp-font-mono);
  color: var(--wp-text-dim);
  overflow-wrap: anywhere;
}
.wp-kit-entry__use { margin: 0; color: var(--wp-text-muted); font-size: var(--wp-text-base); line-height: 20px; max-width: 76ch; }
.wp-kit-entry__instead { margin: 0; color: var(--wp-text-dim); font-size: var(--wp-text-sm); }
.wp-kit-entry__demo {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--wp-space-4);
  padding: var(--wp-space-6);
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-md, 8px);
  min-width: 0;
}
.wp-kit-entry__code {
  margin: 0;
  padding: var(--wp-space-4) var(--wp-space-5);
  background: var(--wp-bg-2);
  border-radius: var(--wp-radius-md, 8px);
  font: var(--wp-text-xs) / 16px var(--wp-font-mono);
  color: var(--wp-text-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
