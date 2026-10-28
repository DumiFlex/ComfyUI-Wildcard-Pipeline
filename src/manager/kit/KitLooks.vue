<script setup lang="ts">
/**
 * Shows a shared piece at both sides' sizes: the canvas size (`sm`) and the
 * manager size (`md`). Both wear the manager's colours here (the manager never
 * loads the canvas sheet); on the canvas the same piece reads the canvas
 * colours from the shared tokens. The slot gets the size to pass on:
 *
 *   <KitLooks v-slot="{ size }"><WpSwitch v-model="on" :size="size" /></KitLooks>
 */
const LOOKS = [
  { id: "canvas", label: "Canvas size (sm)", size: "sm" },
  { id: "manager", label: "Manager size (md)", size: "md" },
] as const;
</script>

<template>
  <div class="wp-kit-looks">
    <section v-for="l in LOOKS" :key="l.id" class="wp-kit-looks__side" :data-kit-look="l.id">
      <span class="wp-kit-looks__label">{{ l.label }}</span>
      <div class="wp-kit-looks__body">
        <slot :size="l.size" :surface="l.id" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.wp-kit-looks { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--wp-space-4); width: 100%; }
.wp-kit-looks__side {
  display: flex; flex-direction: column; gap: var(--wp-space-3); min-width: 0;
  padding: var(--wp-space-4); border: 1px solid var(--wp-border); border-radius: var(--wp-radius);
  background: var(--wp-bg-1); color: var(--wp-text);
}
.wp-kit-looks__label {
  font: 600 var(--wp-text-xs) / 16px var(--wp-font-sans); letter-spacing: .06em; text-transform: uppercase; color: var(--wp-text-dim);
}
.wp-kit-looks__body { display: flex; flex-wrap: wrap; align-items: center; gap: var(--wp-space-4); }
</style>
