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
 *
 * `requireType` makes the user type that exact text before Confirm works
 * (deleting an account); `confirmDisabled` holds Confirm off for a gate the
 * page owns (a required reason in the slot). `warn` asks about something
 * that can be undone but matters: an outlined button and an info mark.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Modal from "./Modal.vue";
import Button from "./Button.vue";
import Icon from "./Icon.vue";
import Input from "./Input.vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    body?: string | undefined;
    confirmLabel?: string | undefined;
    cancelLabel?: string | undefined;
    /** `danger` for something that can't be undone: red button, warning
     *  mark. `warn` for something that matters but can be undone. */
    tone?: "accent" | "warn" | "danger" | undefined;
    loading?: boolean | undefined;
    /** The text the user must type before Confirm works. */
    requireType?: string | undefined;
    /** Hold Confirm off (a required field in the slot is empty). */
    confirmDisabled?: boolean | undefined;
  }>(),
  { body: "", confirmLabel: "Confirm", cancelLabel: "Cancel", tone: "accent", loading: false, requireType: "", confirmDisabled: false },
);

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

function onOpen(v: boolean): void {
  if (!v) emit("cancel");
}

const typed = ref("");
const blocked = computed(
  () => props.loading || props.confirmDisabled || (!!props.requireType && typed.value !== props.requireType),
);
const confirmVariant = computed(() => (props.tone === "danger" ? "danger" : props.tone === "warn" ? "outline" : "primary"));

function confirm(): void {
  if (!blocked.value) emit("confirm");
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key !== "Enter" || ev.shiftKey || blocked.value) return;
  // A focused button (Cancel, ✕) or a text box in the slot keeps its Enter.
  const t = ev.target;
  if (t instanceof HTMLButtonElement || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
  ev.preventDefault();
  emit("confirm");
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      typed.value = "";
      window.addEventListener("keydown", onKeydown);
    }
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
      <label v-if="requireType" class="wp-confirm-modal__gate">
        <span>Type <code>{{ requireType }}</code> to confirm:</span>
        <Input v-model="typed" autocomplete="off" spellcheck="false" data-test="confirm-type" />
      </label>
    </div>
    <template #footer>
      <Button variant="ghost" :disabled="loading" data-test="confirm-cancel" @click="emit('cancel')">{{ cancelLabel }}</Button>
      <Button
        :variant="confirmVariant"
        :loading="loading"
        :disabled="blocked && !loading"
        data-test="confirm-confirm"
        @click="confirm"
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
.wp-confirm-modal__head--warn { color: var(--wp-warn); }
.wp-confirm-modal__head .wp-modal__title { color: var(--wp-text); }
.wp-confirm-modal__text {
  margin: 0;
  color: var(--wp-text-muted);
  line-height: 1.5;
}
.wp-confirm-modal__gate {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-2);
  margin-top: var(--wp-space-5);
  color: var(--wp-text-muted);
  font-size: var(--wp-text-sm);
}
.wp-confirm-modal__gate code {
  padding: 0 4px;
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-3);
  color: var(--wp-text);
  font-family: var(--wp-font-mono);
}
</style>
