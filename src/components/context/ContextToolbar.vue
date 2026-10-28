<script setup lang="ts">
/** Context list toolbar: module count, bulk drift refresh and
 *  collapse / expand / toggle-all. Styles live in `context-widget.css`,
 *  except the drift button's colour below. */
import WpButton from "../shared/WpButton.vue";
import WpIconButton from "../shared/WpIconButton.vue";

defineProps<{ enabledCount: number; totalCount: number; driftedCount: number }>();
defineEmits<{ refresh: []; collapse: []; expand: []; toggleAll: [] }>();
</script>

<template>
  <div class="wp-w-toolbar">
    <span class="wp-w-toolbar-label">modules</span>
    <span class="wp-w-count">{{ enabledCount }} / {{ totalCount }}</span>

    <!-- Bulk-refresh drifted. Visible only when at least one module
         drifted from its library version; orange accent matches the
         per-card drift dot. -->
    <WpButton
      v-if="driftedCount > 0"
      variant="outline"
      icon="pi-refresh"
      class="wp-w-drift"
      :hint="`Refresh ${driftedCount} drifted module(s) from the library.`"
      data-testid="bulk-refresh-drifted"
      @click="$emit('refresh')"
    >refresh {{ driftedCount }} drifted</WpButton>

    <span class="wp-w-toolbar-spacer" />
    <WpIconButton
      icon="pi-chevron-up"
      label="Collapse all modules"
      hint="Collapse all"
      @click="$emit('collapse')"
    />
    <WpIconButton
      icon="pi-chevron-down"
      label="Expand all modules"
      hint="Expand all"
      @click="$emit('expand')"
    />
    <WpIconButton icon="pi-eye" label="Toggle all enabled" @click="$emit('toggleAll')" />
  </div>
</template>

<style scoped>
/* The drift colour matches the per-card drift dot; compound selectors beat
 * WpButton's own scoped outline rules. */
.wp-btn.wp-w-drift {
  border-color: var(--wp-warn);
  color: var(--wp-warn);
  font-family: var(--wp-font-mono, monospace);
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.wp-btn.wp-w-drift:hover:not(:disabled) {
  border-color: var(--wp-warn);
  color: var(--wp-warn);
  background: color-mix(in oklab, var(--wp-warn) 14%, transparent);
}
</style>
