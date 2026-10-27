<script setup lang="ts">
/**
 * Shows a shared piece twice: as the canvas draws it (inside
 * `wp-canvas-scope`, the canvas colours, size `sm`) and as the manager draws
 * it (size `md`). The slot gets the size to pass on:
 *
 *   <KitLooks v-slot="{ size }"><WpSwitch v-model="on" :size="size" /></KitLooks>
 */
const LOOKS = [
  { id: "canvas", label: "Canvas", size: "sm", scope: "wp-canvas-scope" },
  { id: "manager", label: "Manager", size: "md", scope: "" },
] as const;
</script>

<template>
  <div class="wp-kit-looks">
    <section v-for="l in LOOKS" :key="l.id" class="wp-kit-looks__side" :class="l.scope" :data-kit-look="l.id">
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
