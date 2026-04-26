<template>
  <Teleport to="body">
    <div v-if="visible" class="wp-modal-overlay" @click="$emit('close')">
      <div class="wp-modal-wrapper" role="dialog" aria-modal="true" @click.stop>
        <slot></slot>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { watch, onBeforeUnmount } from "vue";

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

function onKeydown(event: KeyboardEvent) {
  if (props.visible && event.key === "Escape") {
    event.preventDefault();
    emit("close");
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

<style>
@import "./theme.css";
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
  background: rgba(0, 0, 0, 0.62);
  font-family: var(--wp-font-sans, sans-serif);
  cursor: default;
}
.wp-modal-wrapper {
  display: flex;
  justify-content: center;
  width: 100%;
  max-height: 100%;
}
</style>
