<script setup lang="ts">
import { useToast } from "../../composables/useToast";
import Icon, { ICON_SM } from "./Icon.vue";

const { toasts, dismiss } = useToast();

function severityIcon(s: string): string {
  switch (s) {
    case "success":
      return "check-circle";
    case "warn":
      return "exclamation-triangle";
    case "error":
      return "times-circle";
    default:
      return "info-circle";
  }
}

async function runAction(id: string, handler: () => void | Promise<void>) {
  try { await handler(); } finally { dismiss(id); }
}
</script>

<template>
  <div class="wp-toast-stack" aria-live="polite" aria-atomic="true">
    <div
      v-for="t in toasts"
      :key="t.id"
      :class="['wp-toast', `wp-toast--${t.severity}`]"
      role="status"
      data-test="toast"
    >
      <Icon :name="severityIcon(t.severity)" />
      <div>
        <div class="wp-toast__summary">{{ t.summary }}</div>
        <div v-if="t.detail" class="wp-toast__detail">{{ t.detail }}</div>
      </div>
      <button
        v-if="t.action"
        type="button"
        class="wp-toast__action"
        data-test="toast-action"
        @click="runAction(t.id, t.action.run)"
      >
        {{ t.action.label }}
      </button>
      <button
        type="button"
        class="wp-toast__close"
        aria-label="Dismiss"
        @click="dismiss(t.id)"
      >
        <Icon name="times" :size="ICON_SM" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.wp-toast__action {
  margin-left: auto;
  padding: 4px var(--wp-space-3);
  background: transparent;
  border: 1px solid var(--wp-border-strong, var(--wp-border));
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text);
  font-size: var(--wp-text-xs);
  font-weight: 600;
  cursor: pointer;
}
.wp-toast__action:hover {
  background: var(--wp-bg-3);
}
</style>
