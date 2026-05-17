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
