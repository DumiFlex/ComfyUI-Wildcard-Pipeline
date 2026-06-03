<script setup lang="ts">
/**
 * Sticky banner shown at the top of the SPA when the backend's
 * X-WP-Startup-Id has changed since the page loaded — i.e. ComfyUI
 * restarted. Reload button refreshes the page.
 *
 * Mounted unconditionally in AppLayout. The store flag controls
 * visibility; transition fades it in/out.
 */
import Button from "./ui/Button.vue";
import Icon from "./ui/Icon.vue";
import { useStaleStore } from "../stores/staleStore";

const stale = useStaleStore();
</script>

<template>
  <Transition name="wp-stale-fade">
    <div
      v-if="stale.isStale"
      class="wp-stale"
      role="status"
      aria-live="polite"
      data-test="stale-banner"
    >
      <Icon name="pi-refresh" />
      <span class="wp-stale__msg">
        ComfyUI has restarted. This page may be out of date.
      </span>
      <Button
        variant="primary"
        size="sm"
        icon="pi-refresh"
        data-test="stale-reload"
        @click="() => stale.reload()"
      >Reload page</Button>
    </div>
  </Transition>
</template>

<style scoped>
.wp-stale {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
  padding: var(--wp-space-4) var(--wp-space-6);
  background: color-mix(in oklab, var(--wp-warn) 16%, var(--wp-bg-1));
  border-bottom: 1px solid color-mix(in oklab, var(--wp-warn) 40%, transparent);
  color: var(--wp-text);
  font-size: var(--wp-text-sm);
  box-shadow: var(--wp-elev-1);
}
.wp-stale .pi { color: var(--wp-warn); font-size: 16px; }
.wp-stale__msg { flex: 1; }

.wp-stale-fade-enter-active,
.wp-stale-fade-leave-active {
  transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
              opacity 180ms ease;
}
.wp-stale-fade-enter-from,
.wp-stale-fade-leave-to {
  transform: translateY(-8px);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .wp-stale-fade-enter-active,
  .wp-stale-fade-leave-active { transition: none; }
}
</style>
