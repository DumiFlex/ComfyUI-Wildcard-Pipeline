<template>
  <Teleport to="body">
    <Transition name="wp-modal" appear>
      <div v-if="visible" ref="overlayEl" class="wp-modal-overlay" @click="$emit('close')">
        <div class="wp-modal-wrapper" role="dialog" aria-modal="true" @click.stop>
          <slot></slot>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
import { useModalKeyShield } from "./useModalKeyShield";

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{
  (e: "close"): void;
  /** Every keydown inside the modal. Consumers MUST use this instead of a
   *  window listener: the shield stops inside-modal keys at the overlay, so a
   *  window listener would never see them. */
  (e: "keydown", ev: KeyboardEvent): void;
}>();

const overlayEl = ref<HTMLElement | null>(null);

function closeOnEscape(event: KeyboardEvent): void {
  if (!props.visible || event.key !== "Escape") return;
  event.preventDefault();
  emit("close");
}

// Keys pressed INSIDE the modal are handled here and stop at the overlay, so
// they never reach ComfyUI's global shortcuts (see useModalKeyShield).
useModalKeyShield(overlayEl, {
  onKey: (ev) => {
    emit("keydown", ev);
    closeOnEscape(ev);
  },
});

// The window listener still covers the case where focus is OUTSIDE the modal
// — clicking the canvas leaves the modal open but unfocused, and Escape should
// still close it. Events from inside never get here; the shield stops them.
function onKeydown(event: KeyboardEvent) {
  closeOnEscape(event);
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

<style>
@import "./theme.css";
@import "./_modal-motion.css";
</style>

<style scoped>
.wp-modal-overlay,
.wp-modal-overlay * {
  box-sizing: border-box;
}
.wp-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--wp-overlay-bg, rgba(0, 0, 0, 0.62));
  font-family: var(--wp-font-sans, sans-serif);
  cursor: default;
}
.wp-modal-wrapper {
  display: flex;
  justify-content: center;
  width: 100%;
  max-height: 100%;
}

/* `wp-modal` open/close transition lives in
 * src/components/shared/_modal-motion.css (imported globally via
 * ContextWidget) so every modal — ModalShell consumers, ConfirmDialog,
 * InjectorBindingModal — animates with the same rules. */
</style>
