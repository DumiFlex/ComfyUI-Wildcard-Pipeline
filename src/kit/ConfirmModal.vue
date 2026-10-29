<script setup lang="ts">
/**
 * Ask before an action, in the manager's own dialog.
 *
 * A thin wrapper on Modal: the same backdrop, focus trap, Escape and focus
 * return as every other manager dialog, with a Cancel button and a confirm
 * button that names the action. The canvas keeps `ConfirmDialog`, which
 * wears the node colours; this one wears the manager's.
 *
 * Escape, the backdrop, the ✕ and Cancel all emit `cancel`. Enter confirms
 * unless focus is on a button or a text box (which then gets the key itself).
 * The `confirm-*` data-test names match ConfirmDialog's, so a test can drive
 * either.
 */
import { onBeforeUnmount, watch } from "vue";
import Modal from "./Modal.vue";
import Button from "./Button.vue";
import Icon from "./Icon.vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    body?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** `danger` for something that can't be undone: red button, warning mark. */
    tone?: "accent" | "danger";
    loading?: boolean;
  }>(),
  { body: "", confirmLabel: "Confirm", cancelLabel: "Cancel", tone: "accent", loading: false },
);

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

function onOpen(v: boolean): void {
  if (!v) emit("cancel");
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key !== "Enter" || ev.shiftKey || props.loading) return;
  // A focused button (Cancel, ✕) or a text box in the slot keeps its Enter.
  const t = ev.target;
  if (t instanceof HTMLButtonElement || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
  ev.preventDefault();
  emit("confirm");
}

watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener("keydown", onKeydown);
    else window.removeEventListener("keydown", onKeydown);
  },
  { immediate: true },
);
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Modal :open="open" size="sm" @update:open="onOpen">
    <template #header="{ titleId }">
      <span class="wp-confirm-modal__head" :class="`wp-confirm-modal__head--${tone}`">
        <Icon :name="tone === 'danger' ? 'exclamation-triangle' : 'info-circle'" />
        <h3 :id="titleId" class="wp-modal__title" data-test="confirm-title">{{ title }}</h3>
      </span>
    </template>
    <div class="wp-confirm-modal__body">
      <p v-if="body" class="wp-confirm-modal__text" data-test="confirm-body">{{ body }}</p>
      <slot />
    </div>
    <template #footer>
      <Button variant="ghost" data-test="confirm-cancel" @click="emit('cancel')">{{ cancelLabel }}</Button>
      <Button
        :variant="tone === 'danger' ? 'danger' : 'primary'"
        :loading="loading"
        data-test="confirm-confirm"
        @click="emit('confirm')"
      >{{ confirmLabel }}</Button>
    </template>
  </Modal>
</template>

<style scoped>
.wp-confirm-modal__head {
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-3);
  min-width: 0;
  color: var(--wp-accent-text);
}
.wp-confirm-modal__head--danger { color: var(--wp-danger); }
.wp-confirm-modal__head .wp-modal__title { color: var(--wp-text); }
.wp-confirm-modal__text {
  margin: 0;
  color: var(--wp-text-muted);
  line-height: 1.5;
}
</style>
