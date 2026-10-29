<script setup lang="ts">
/**
 * The manager's toast stack (bottom right). The toast itself is the shared
 * ToastCard, the same one the canvas stack draws.
 */
import { useToast } from "./useToast";
import ToastCard from "./ToastCard.vue";

const { toasts, push, dismiss } = useToast();

async function runAction(id: string, handler: () => void | Promise<void>) {
  try {
    await handler();
  } catch (e) {
    push({
      severity: "error",
      summary: "Undo failed",
      detail: e instanceof Error ? e.message : String(e),
      life: 4000,
    });
  } finally {
    dismiss(id);
  }
}
</script>

<template>
  <div class="wp-toast-stack" aria-live="polite" aria-atomic="true">
    <ToastCard
      v-for="t in toasts"
      :key="t.id"
      :tone="t.severity"
      :summary="t.summary"
      :detail="t.detail"
      :action-label="t.action?.label"
      @action="t.action && runAction(t.id, t.action.run)"
      @dismiss="dismiss(t.id)"
    />
  </div>
</template>
