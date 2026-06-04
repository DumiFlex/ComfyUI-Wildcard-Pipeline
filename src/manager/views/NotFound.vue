<script setup lang="ts">
/**
 * 404 surface — landing for any URL that doesn't match a known route.
 * The router previously did `redirect: "/dashboard"` for the
 * pathMatch catch-all; that hard-bounced typos straight to the home
 * tab and made the user think nothing was wrong. Now they land here.
 */
import { RouterLink, useRoute } from "vue-router";

const route = useRoute();
</script>

<template>
  <div class="wp-not-found">
    <div class="wp-not-found__card">
      <div class="wp-not-found__code">404</div>
      <h1 class="wp-not-found__title">Page not found</h1>
      <p class="wp-not-found__copy">
        Nothing lives at <code>{{ route.fullPath }}</code>.
        It may have been moved, deleted, or never existed.
      </p>
      <div class="wp-not-found__actions">
        <RouterLink to="/dashboard" class="wp-btn wp-btn--primary">
          <i class="pi pi-home" />Back to dashboard
        </RouterLink>
        <RouterLink to="/all" class="wp-btn wp-btn--ghost">
          <i class="pi pi-th-large" />Browse library
        </RouterLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wp-not-found {
  min-height: 60vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
}
.wp-not-found__card {
  max-width: 520px;
  text-align: center;
  padding: 48px 36px;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: 12px;
}
.wp-not-found__code {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 64px;
  font-weight: 700;
  letter-spacing: -2px;
  color: var(--wp-accent-text, #d97757);
  line-height: 1;
  margin-bottom: 14px;
}
.wp-not-found__title {
  font-size: 22px;
  font-weight: 600;
  margin: 0 0 10px;
  color: var(--wp-text);
}
.wp-not-found__copy {
  color: var(--wp-text-muted);
  font-size: 13.5px;
  margin: 0 0 22px;
  line-height: 1.55;
}
.wp-not-found__copy code {
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 12.5px;
  background: var(--wp-bg-3);
  padding: 2px 7px;
  border-radius: 4px;
  color: var(--wp-text);
  word-break: break-all;
}
.wp-not-found__actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}
.wp-not-found__actions .wp-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-decoration: none;
}
</style>
