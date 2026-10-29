<script setup lang="ts">
/**
 * One toast: the look both toast stacks share.
 *
 * The manager (`ui/ToastHost.vue`, fed by `useToast()`) and the canvas
 * (`shared/Toast.vue`, fed by `toast-store`) used to draw toasts two ways:
 * different surfaces, borders, icons and action buttons. Now each host keeps
 * only its own store and its own place on screen, and renders this card.
 * It reads only SHARED_TOKENS, so it wears the colours of the side it is on.
 *
 * `tone` follows the kit's names; the canvas store's `warning` maps to
 * `warn` in its host.
 */
const props = defineProps<{
  tone: "info" | "success" | "warn" | "error";
  summary: string;
  detail?: string;
  /** Label of the inline action (Undo, Open…); emits `action`. */
  actionLabel?: string;
}>();

const emit = defineEmits<{ action: []; dismiss: [] }>();

const ICONS = {
  info: "pi-info-circle",
  success: "pi-check-circle",
  warn: "pi-exclamation-triangle",
  error: "pi-times-circle",
} as const;
</script>

<template>
  <div :class="['wp-toast', `wp-toast--${props.tone}`]" role="status" data-test="toast">
    <i :class="['pi', ICONS[props.tone], 'wp-toast__icon']" aria-hidden="true" />
    <div class="wp-toast__text">
      <div class="wp-toast__summary">{{ summary }}</div>
      <div v-if="detail" class="wp-toast__detail">{{ detail }}</div>
    </div>
    <button
      v-if="actionLabel"
      type="button"
      class="wp-toast__action"
      data-test="toast-action"
      @click="emit('action')"
    >{{ actionLabel }}</button>
    <button
      type="button"
      class="wp-toast__close"
      aria-label="Dismiss"
      @click="emit('dismiss')"
    ><i class="pi pi-times" aria-hidden="true" /></button>
  </div>
</template>

<style scoped>
.wp-toast {
  --toast-tone: var(--wp-info);
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
  min-width: 220px;
  max-width: 420px;
  padding: var(--wp-space-4) var(--wp-space-4) var(--wp-space-4) var(--wp-space-5);
  /* Slightly see-through with a blur, so it reads as floating over
     whatever is underneath without a heavy shadow. */
  background: color-mix(in oklab, var(--wp-bg-3) 94%, transparent);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--wp-border-strong);
  border-left: 3px solid var(--toast-tone);
  border-radius: var(--wp-radius-md);
  box-shadow: var(--wp-shadow-md);
  color: var(--wp-text);
  font-family: var(--wp-font-sans);
  font-size: var(--wp-text-sm);
  line-height: 1.4;
}
.wp-toast--success { --toast-tone: var(--wp-success); }
.wp-toast--warn { --toast-tone: var(--wp-warn); }
.wp-toast--error { --toast-tone: var(--wp-danger); }

.wp-toast__icon { flex-shrink: 0; font-size: 14px; color: var(--toast-tone); }
.wp-toast__text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.wp-toast__summary { font-weight: 600; }
.wp-toast__detail { margin-top: 1px; color: var(--wp-text-muted); font-size: var(--wp-text-xs); }

.wp-toast__action {
  flex-shrink: 0;
  height: var(--wp-control-h-sm);
  padding: 0 var(--wp-space-4);
  background: transparent;
  border: 1px solid var(--wp-border-strong);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text);
  font: 600 var(--wp-text-xs) var(--wp-font-sans);
  cursor: pointer;
  transition: background var(--wp-motion-quick), border-color var(--wp-motion-quick);
}
.wp-toast__action:hover { background: var(--wp-bg-4); border-color: var(--wp-accent-500); }

.wp-toast__close {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  padding: 0;
  background: none;
  border: 0;
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text-dim);
  cursor: pointer;
}
.wp-toast__close .pi { font-size: 10px; }
.wp-toast__close:hover { color: var(--wp-text); background: var(--wp-bg-4); }
.wp-toast__action:focus-visible,
.wp-toast__close:focus-visible { outline: none; box-shadow: var(--wp-focus-ring); }
</style>
