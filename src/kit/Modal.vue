<script setup lang="ts">
import CloseButton from "./CloseButton.vue";
import { computed, ref, useId, useSlots } from "vue";
import { useDialogFocus } from "./useDialogFocus";

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
const dialog = ref<HTMLElement | null>(null);
const titleId = `wp-modal-title-${useId()}`;

function close() {
  emit("update:open", false);
}

function onBackdrop() {
  if (props.closeOnBackdrop) close();
}

useDialogFocus(dialog, () => props.open, {
  onEscape: close,
  // The first control in the body, else the dialog itself (the close button
  // would make Enter close it).
  initial: (root, els) => {
    const body = root.querySelector(".wp-modal__body");
    return els.find((el) => body?.contains(el)) ?? root;
  },
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
      <div
        ref="dialog"
        :class="modalClasses"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="title || slots.header ? titleId : undefined"
        tabindex="-1"
        @mousedown.stop
      >
        <header v-if="title || slots.header" class="wp-modal__head">
          <h3 v-if="title" :id="titleId" class="wp-modal__title">{{ title }}</h3>
          <!-- A custom header puts :id="titleId" on its own heading. -->
          <slot name="header" :title-id="titleId" />
          <span class="wp-spacer" />
          <CloseButton kbd="Esc" @click="close" />
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
