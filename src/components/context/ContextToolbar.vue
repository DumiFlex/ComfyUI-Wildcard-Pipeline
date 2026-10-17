<script setup lang="ts">
/** Context list toolbar: module count, bulk drift refresh and
 *  collapse / expand / toggle-all. Styles live in `context-widget.css`. */
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
    <button
      v-if="driftedCount > 0"
      type="button"
      class="wp-section-label__bulk wp-section-label__bulk--drift"
      :title="`Refresh ${driftedCount} drifted module(s) from the library.`"
      data-testid="bulk-refresh-drifted"
      @click="$emit('refresh')"
    >
      <i class="pi pi-refresh" aria-hidden="true"></i>
      <span>refresh {{ driftedCount }} drifted</span>
    </button>

    <span class="wp-w-toolbar-spacer" />
    <button
      type="button"
      class="wp-btn--icon-sm"
      title="Collapse all"
      aria-label="Collapse all modules"
      @click="$emit('collapse')"
    ><i class="pi pi-chevron-up" /></button>
    <button
      type="button"
      class="wp-btn--icon-sm"
      title="Expand all"
      aria-label="Expand all modules"
      @click="$emit('expand')"
    ><i class="pi pi-chevron-down" /></button>
    <button
      type="button"
      class="wp-btn--icon-sm"
      title="Toggle all enabled"
      aria-label="Toggle all enabled"
      @click="$emit('toggleAll')"
    ><i class="pi pi-eye" /></button>
  </div>
</template>
