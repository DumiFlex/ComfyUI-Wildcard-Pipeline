<script setup lang="ts">
/**
 * Themed confirmation dialog — replaces `window.confirm()` for any
 * action that needs an in-app prompt (reset overrides, save-to-library,
 * reset-from-library, etc.). Consumers control it via v-model:visible
 * plus title/body/confirm-label slots; the dialog emits `confirm` /
 * `cancel` and closes itself on Esc + overlay click + Cancel button.
 *
 * Variants:
 *   - default: accent-coloured Confirm button (constructive actions)
 *   - danger:  red Confirm button (destructive actions, e.g. discard,
 *              reset overrides)
 */
import { onBeforeUnmount, watch } from "vue";

const props = withDefaults(
  defineProps<{
    visible: boolean;
    title: string;
    body?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: "default" | "danger";
  }>(),
  {
    body: "",
    confirmLabel: "Confirm",
    cancelLabel: "Cancel",
    variant: "default",
  },
);

const emit = defineEmits<{
  "confirm": [];
  "cancel": [];
}>();

function onConfirm(): void { emit("confirm"); }
function onCancel(): void { emit("cancel"); }

function onKeydown(ev: KeyboardEvent): void {
  if (!props.visible) return;
  if (ev.key === "Escape") {
    ev.preventDefault();
    emit("cancel");
  } else if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    emit("confirm");
  }
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) window.addEventListener("keydown", onKeydown);
    else window.removeEventListener("keydown", onKeydown);
  },
  { immediate: true },
);

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="wp-modal" appear>
      <div
        v-if="visible"
        class="wp-confirm-overlay"
        data-test="confirm-overlay"
        @click="onCancel"
      >
      <div
        class="wp-confirm"
        role="alertdialog"
        aria-modal="true"
        :class="`wp-confirm--${variant}`"
        @click.stop
      >
        <div class="wp-confirm__head">
          <i
            class="pi"
            :class="variant === 'danger' ? 'pi-exclamation-triangle' : 'pi-info-circle'"
            aria-hidden="true"
          />
          <h3 class="wp-confirm__title" data-test="confirm-title">{{ title }}</h3>
        </div>
        <p v-if="body" class="wp-confirm__body" data-test="confirm-body">{{ body }}</p>
        <div class="wp-confirm__foot">
          <button
            type="button"
            class="wp-confirm__btn"
            data-test="confirm-cancel"
            @click="onCancel"
          >{{ cancelLabel }}</button>
          <button
            type="button"
            class="wp-confirm__btn wp-confirm__btn--primary"
            :class="{ 'wp-confirm__btn--danger': variant === 'danger' }"
            data-test="confirm-confirm"
            @click="onConfirm"
          >{{ confirmLabel }}</button>
        </div>
      </div>
    </div>
    </Transition>
  </Teleport>
</template>

<style>
/* Shared modal open/close transition — overlay fade + panel scale.
 * See `_modal-motion.css` for rules. Imported unscoped so the
 * `wp-modal-*` transition class names match the Vue-emitted classes
 * cleanly (named transitions don't survive Vue's `data-v-...`
 * scoping). */
@import "./_modal-motion.css";
</style>

<style scoped>
.wp-confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--wp-overlay-bg, rgba(0, 0, 0, 0.62));
  font-family: var(--wp-font-sans, sans-serif);
}
.wp-confirm {
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  width: 380px;
  max-width: 100%;
  color: var(--wp-text);
  box-shadow: var(--wp-shadow-lg, 0 12px 40px rgba(0, 0, 0, 0.5));
  overflow: hidden;
}
.wp-confirm__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px 8px;
}
.wp-confirm__head .pi {
  font-size: 16px;
  color: var(--wp-accent-text, var(--wp-text));
}
.wp-confirm--danger .wp-confirm__head .pi {
  color: var(--wp-danger, var(--wp-red));
}
.wp-confirm__title {
  font: 600 13px var(--wp-font-sans);
  color: var(--wp-text);
  margin: 0;
}
.wp-confirm__body {
  font: 12px/1.5 var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
  margin: 0;
  padding: 0 16px 14px;
}
.wp-confirm__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  background: var(--wp-bg3);
  border-top: 1px solid var(--wp-border);
}
.wp-confirm__btn {
  padding: 6px 14px;
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  font: 11px var(--wp-font-sans);
  cursor: pointer;
}
.wp-confirm__btn:hover {
  border-color: var(--wp-border-soft, var(--wp-border));
  color: var(--wp-text);
}
.wp-confirm__btn--primary {
  border-color: var(--wp-accent);
  background: var(--wp-accent);
  color: white;
}
.wp-confirm__btn--primary:hover {
  background: var(--wp-accent2, var(--wp-accent));
  border-color: var(--wp-accent2, var(--wp-accent));
  color: white;
}
.wp-confirm__btn--danger {
  border-color: var(--wp-danger, var(--wp-red));
  background: var(--wp-danger, var(--wp-red));
  color: white;
}
.wp-confirm__btn--danger:hover {
  background: var(--wp-red);
  border-color: var(--wp-red);
}
</style>
