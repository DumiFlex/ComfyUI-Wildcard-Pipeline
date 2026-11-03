<script setup lang="ts">
/**
 * The manager's shell inside the canvas help dialog: just the docs view.
 * No topbar, sidebar, AI chat, command palette or library boot work, so the
 * frame opens fast and never touches the library. See `router/frame-mode.ts`.
 */
import { RouterView } from "vue-router";
import ToastHost from "@/kit/ToastHost.vue";
import ErrorBoundary from "../components/ErrorBoundary.vue";
</script>

<template>
  <div class="wp-frame">
    <main id="wp-main" class="wp-frame__main" tabindex="-1">
      <ErrorBoundary>
        <RouterView v-slot="{ Component, route }">
          <component
            :is="Component"
            :key="typeof route.meta.layoutKey === 'string' ? route.meta.layoutKey : route.path"
          />
        </RouterView>
      </ErrorBoundary>
    </main>
    <ToastHost />
  </div>
</template>

<style scoped>
.wp-frame {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--wp-bg);
  color: var(--wp-text);
}
.wp-frame__main {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  outline: none;
}
</style>
