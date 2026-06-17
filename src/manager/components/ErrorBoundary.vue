<script setup lang="ts">
/**
 * App-level error boundary.
 *
 * Wraps the active RouterView so a render-time throw in any view
 * (computed crash, missing prop, etc.) lands here instead of taking
 * down the whole manager shell. The captured error stays contained
 * — sidebar + topbar remain interactive so the user can navigate
 * away. Route changes auto-reset the boundary; a one-off crash on
 * /community doesn't strand the user on "Something broke" when they
 * click Dashboard.
 */
import { onErrorCaptured, ref, watch } from "vue";
import { useRoute } from "vue-router";

const error = ref<Error | null>(null);
const showStack = ref(false);
const route = useRoute();

onErrorCaptured((err) => {
  error.value = err instanceof Error ? err : new Error(String(err));
  // eslint-disable-next-line no-console
  console.error("[ErrorBoundary]", err);
  return false;
});

function reset() {
  error.value = null;
  showStack.value = false;
}

function reload() {
  window.location.reload();
}

watch(
  () => route.fullPath,
  () => {
    error.value = null;
    showStack.value = false;
  },
);
</script>

<template>
  <div v-if="error" class="wp-error">
    <div class="wp-error__card">
      <div class="wp-error__icon">
        <i class="pi pi-exclamation-triangle" />
      </div>
      <h1 class="wp-error__title">Something broke</h1>
      <p class="wp-error__copy">
        This view hit an unexpected error while rendering. Your unsaved
        changes were auto-saved as a draft — reload and you'll be offered to
        restore them, or switch to another tab to keep working.
      </p>
      <div class="wp-error__detail">
        <button
          type="button"
          class="wp-btn wp-btn--ghost wp-btn--sm"
          @click="showStack = !showStack"
        >
          <i :class="`pi ${showStack ? 'pi-chevron-up' : 'pi-chevron-down'}`" />
          {{ showStack ? "Hide details" : "Show details" }}
        </button>
        <pre v-if="showStack" class="wp-error__stack">{{ error.message }}
{{ error.stack }}</pre>
      </div>
      <div class="wp-error__actions">
        <button type="button" class="wp-btn wp-btn--primary" @click="reload">
          <i class="pi pi-refresh" />Reload page
        </button>
        <button type="button" class="wp-btn wp-btn--ghost" @click="reset">
          <i class="pi pi-times" />Dismiss
        </button>
      </div>
      <p class="wp-error__path">
        Path: <code>{{ route.fullPath }}</code>
      </p>
    </div>
  </div>
  <slot v-else />
</template>

<style scoped>
.wp-error {
  min-height: 60vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
}
.wp-error__card {
  max-width: 560px;
  width: 100%;
  text-align: center;
  padding: 44px 32px;
  background: var(--wp-bg-2);
  border: 1px solid color-mix(in oklab, var(--wp-danger, #ef4444) 38%, var(--wp-border));
  border-radius: 12px;
}
.wp-error__icon {
  width: 52px;
  height: 52px;
  margin: 0 auto 16px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in oklab, var(--wp-danger, #ef4444) 22%, transparent);
  color: var(--wp-danger, #ef4444);
  font-size: 22px;
}
.wp-error__title {
  font-size: 20px;
  font-weight: 600;
  margin: 0 0 8px;
  color: var(--wp-text);
}
.wp-error__copy {
  color: var(--wp-text-muted);
  font-size: 13.5px;
  margin: 0 0 14px;
  line-height: 1.55;
}
.wp-error__detail {
  margin: 10px 0 18px;
}
.wp-error__stack {
  margin: 12px 0 0;
  padding: 12px 14px;
  background: var(--wp-bg-3);
  border-radius: 6px;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 11px;
  text-align: left;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--wp-text-muted);
  max-height: 280px;
  overflow: auto;
}
.wp-error__actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.wp-error__actions .wp-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.wp-error__path {
  margin: 0;
  font-size: 11.5px;
  color: var(--wp-text-muted);
}
.wp-error__path code {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  background: var(--wp-bg-3);
  padding: 1px 6px;
  border-radius: 3px;
}
</style>
