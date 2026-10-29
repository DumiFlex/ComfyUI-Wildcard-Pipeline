<script setup lang="ts">
/**
 * A panel that slides in from the side of the page: inspectors, history,
 * settings that sit beside the work instead of over it. Escape closes it,
 * Tab stays inside it and focus goes back where it was. With `modal` off
 * there is no backdrop, Tab moves on to the page and the page stays usable.
 */
import CloseButton from "./CloseButton.vue";
import { ref, useId, useSlots } from "vue";
import { useDialogFocus } from "./useDialogFocus";

interface Props {
  open: boolean;
  title?: string | undefined;
  side?: "right" | "left" | undefined;
  /** Any CSS width; capped at the viewport. */
  width?: string | undefined;
  /** Dim the page and close on a click outside. */
  modal?: boolean | undefined;
}
const props = withDefaults(defineProps<Props>(), { side: "right", width: "420px", modal: true });
const emit = defineEmits<{ (e: "update:open", v: boolean): void }>();

const slots = useSlots();
const panel = ref<HTMLElement | null>(null);
const titleId = `wp-drawer-title-${useId()}`;

function close(): void {
  emit("update:open", false);
}

// The backdrop is a click target only; keyboard users close with Escape.
function bindBackdrop(el: unknown): void {
  if (el instanceof HTMLElement) el.onmousedown = (ev) => { if (ev.target === el) close(); };
}

useDialogFocus(panel, () => props.open, {
  onEscape: close,
  trap: () => props.modal,
  // The first control in the body, not the close button.
  initial: (root, els) => {
    const body = root.querySelector(".wp-drawer__body");
    return els.find((el) => body?.contains(el)) ?? root;
  },
});
</script>

<template>
  <Teleport to="body">
    <Transition name="wp-drawer-fade">
      <div v-if="open && modal" :ref="bindBackdrop" class="wp-drawer__backdrop" data-test="drawer-backdrop" />
    </Transition>
    <Transition :name="`wp-drawer-${side}`">
      <aside
        v-if="open"
        ref="panel"
        class="wp-drawer"
        :class="`wp-drawer--${side}`"
        :style="{ width: `min(${width}, 100vw)` }"
        role="dialog"
        :aria-modal="modal || undefined"
        :aria-labelledby="title ? titleId : undefined"
        tabindex="-1"
      >
        <header v-if="title || slots.header" class="wp-drawer__head">
          <h3 v-if="title" :id="titleId" class="wp-drawer__title">{{ title }}</h3>
          <slot name="header" />
          <span class="wp-spacer" />
          <CloseButton kbd="Esc" data-test="drawer-close" @click="close" />
        </header>
        <div class="wp-drawer__body">
          <slot />
        </div>
        <footer v-if="slots.footer" class="wp-drawer__foot">
          <slot name="footer" />
        </footer>
      </aside>
    </Transition>
  </Teleport>
</template>

<style>
.wp-drawer__backdrop {
  position: fixed;
  inset: 0;
  z-index: 9000;
  background: var(--wp-overlay-bg);
}
.wp-drawer {
  position: fixed;
  top: 0;
  bottom: 0;
  z-index: 9001;
  display: flex;
  flex-direction: column;
  background: var(--wp-bg-1);
  color: var(--wp-text);
  box-shadow: var(--wp-shadow-xl);
  outline: none;
}
.wp-drawer--right { right: 0; border-left: 1px solid var(--wp-border); }
.wp-drawer--left { left: 0; border-right: 1px solid var(--wp-border); }
.wp-drawer__head {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  min-height: 52px;
  padding: 0 var(--wp-space-4) 0 var(--wp-space-5);
  border-bottom: 1px solid var(--wp-border);
}
.wp-drawer__title { margin: 0; font-size: var(--wp-text-md); font-weight: 600; }
.wp-drawer__body { flex: 1; min-height: 0; overflow: auto; padding: var(--wp-space-5); }
.wp-drawer__foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--wp-space-3);
  padding: var(--wp-space-4) var(--wp-space-5);
  border-top: 1px solid var(--wp-border);
}
.wp-drawer-right-enter-active, .wp-drawer-right-leave-active,
.wp-drawer-left-enter-active, .wp-drawer-left-leave-active { transition: transform 180ms ease-out; }
.wp-drawer-right-enter-from, .wp-drawer-right-leave-to { transform: translateX(100%); }
.wp-drawer-left-enter-from, .wp-drawer-left-leave-to { transform: translateX(-100%); }
.wp-drawer-fade-enter-active, .wp-drawer-fade-leave-active { transition: opacity 180ms ease-out; }
.wp-drawer-fade-enter-from, .wp-drawer-fade-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .wp-drawer-right-enter-active, .wp-drawer-right-leave-active,
  .wp-drawer-left-enter-active, .wp-drawer-left-leave-active,
  .wp-drawer-fade-enter-active, .wp-drawer-fade-leave-active { transition: none; }
}
</style>
