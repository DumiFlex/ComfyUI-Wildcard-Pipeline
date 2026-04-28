<script setup lang="ts">
import { computed, onBeforeUnmount, useSlots, watch } from "vue";
import Icon from "./Icon.vue";

interface Props {
  open: boolean;
  title?: string;
  size?: "sm" | "md" | "lg";
  closeOnBackdrop?: boolean;
}
const props = withDefaults(defineProps<Props>(), { size: "md", closeOnBackdrop: true });

const emit = defineEmits<{
  (e: "update:open", v: boolean): void;
}>();

const slots = useSlots();

const modalClasses = computed(() => ["wp-modal", `wp-modal--${props.size}`]);

function close() {
  emit("update:open", false);
}

function onBackdrop() {
  if (props.closeOnBackdrop) close();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}

watch(() => props.open, (v) => {
  if (typeof window === "undefined") return;
  if (v) {
    window.addEventListener("keydown", onKeydown);
  } else {
    window.removeEventListener("keydown", onKeydown);
  }
}, { immediate: true });

onBeforeUnmount(() => {
  if (typeof window !== "undefined") window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="wp-modal__backdrop"
      data-test="modal-backdrop"
      @mousedown.self="onBackdrop"
    >
      <div :class="modalClasses" role="dialog" aria-modal="true" @mousedown.stop>
        <header v-if="title || slots.header" class="wp-modal__head">
          <h3 v-if="title" class="wp-modal__title">{{ title }}</h3>
          <slot name="header" />
          <span class="wp-spacer" />
          <button
            type="button"
            class="wp-topbar__icon-btn"
            aria-label="Close"
            @click="close"
          >
            <Icon name="times" />
          </button>
        </header>
        <div class="wp-modal__body">
          <slot />
        </div>
        <footer v-if="slots.footer" class="wp-modal__foot">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
