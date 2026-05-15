<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { toasts, dismissToast, type Toast } from "./toast-store";

function severityIcon(s: Toast["severity"]): string {
  if (s === "success") return "pi-check-circle";
  if (s === "warning") return "pi-exclamation-triangle";
  if (s === "error") return "pi-times-circle";
  return "pi-info-circle";
}

function pickAction(t: Toast) {
  t.action?.onSelect();
  dismissToast(t.id);
}

// Anchor the stack relative to ComfyUI's graph canvas container, matching
// the native PrimeVue Toast positioning. Reading GlobalToast.js: top = rect.top
// + 100px (clears the menu bar), right = innerWidth - rect.right + 20px (sits
// just inside the canvas right edge). Updates on resize + canvas mutations.
const stackTop = ref<number>(56);
const stackRight = ref<number>(16);

function updatePosition() {
  const canvas = document.querySelector<HTMLElement>(".graph-canvas-container");
  if (!canvas) return;
  const r = canvas.getBoundingClientRect();
  stackTop.value = r.top + 100;
  stackRight.value = Math.max(8, window.innerWidth - (r.left + r.width) + 20);
}

let observer: ResizeObserver | null = null;
onMounted(() => {
  updatePosition();
  window.addEventListener("resize", updatePosition);
  // Recompute when the canvas resizes (sidebar toggle, panel resize, etc.).
  const canvas = document.querySelector(".graph-canvas-container");
  if (canvas && typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(updatePosition);
    observer.observe(canvas);
  }
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", updatePosition);
  observer?.disconnect();
});
</script>

<template>
  <Teleport to="body">
    <TransitionGroup
      tag="div"
      name="wp-toast"
      class="wp-toast-stack"
      :style="{ top: `${stackTop}px`, right: `${stackRight}px` }"
      aria-live="polite"
    >
      <div
        v-for="t in toasts"
        :key="t.id"
        class="wp-toast"
        :class="`wp-toast--${t.severity}`"
        role="status"
      >
        <i :class="['pi', severityIcon(t.severity), 'wp-toast__icon']" aria-hidden="true"></i>
        <span class="wp-toast__msg">{{ t.message }}</span>
        <button
          v-if="t.action"
          type="button"
          class="wp-toast__action"
          @click="pickAction(t)"
        >{{ t.action.label }}</button>
        <button
          type="button"
          class="wp-toast__close"
          aria-label="Dismiss"
          @click="dismissToast(t.id)"
        ><i class="pi pi-times" aria-hidden="true"></i></button>
      </div>
    </TransitionGroup>
  </Teleport>
</template>

<style>
@import "./theme.css";
</style>

<style scoped>
.wp-toast-stack {
  position: fixed;
  /* top + right set inline so we mirror ComfyUI's native toast anchor —
   * relative to .graph-canvas-container so sidebars don't push us off. */
  z-index: 10001;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  max-width: min(420px, calc(100vw - 32px));
  pointer-events: none;
}
.wp-toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-left: 3px solid var(--wp-accent);
  border-radius: var(--wp-radius-sm);
  box-shadow: var(--wp-shadow-sm, 0 4px 16px rgba(0, 0, 0, 0.4));
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  color: var(--wp-text);
}
.wp-toast--success { border-left-color: var(--wp-green); }
.wp-toast--warning { border-left-color: var(--wp-amber); }
.wp-toast--error { border-left-color: var(--wp-red); }

.wp-toast__icon {
  font-size: 14px;
  flex-shrink: 0;
}
.wp-toast--info .wp-toast__icon { color: var(--wp-accent); }
.wp-toast--success .wp-toast__icon { color: var(--wp-green); }
.wp-toast--warning .wp-toast__icon { color: var(--wp-amber); }
.wp-toast--error .wp-toast__icon { color: var(--wp-red); }

.wp-toast__msg {
  flex: 1;
  min-width: 0;
}
.wp-toast__action {
  background: var(--wp-accent-glow);
  border: 1px solid var(--wp-accent);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-accent);
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  cursor: pointer;
  transition: filter var(--wp-motion-quick);
  flex-shrink: 0;
}
.wp-toast__action:hover { filter: brightness(1.2); }
.wp-toast__close {
  background: none;
  border: none;
  color: var(--wp-text3);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
  flex-shrink: 0;
}
.wp-toast__close:hover { color: var(--wp-text); }

/* Slide-in from the right; quick fade-out on dismiss. The leave leg
 * stays shorter than the enter so dismiss still feels snappy — the
 * point of the fade is to soften the abrupt vanish, not stretch it.
 * `move` keeps neighbouring toasts gliding into the freed slot rather
 * than jumping. */
.wp-toast-enter-active { transition: opacity var(--wp-motion-swap), transform var(--wp-motion-swap); }
.wp-toast-enter-from { opacity: 0; transform: translateX(20px); }
.wp-toast-leave-active {
  transition: opacity var(--wp-motion-quick) ease, transform var(--wp-motion-quick) ease;
  position: absolute;
  right: 0;
}
.wp-toast-leave-to { opacity: 0; transform: translateX(12px); }
.wp-toast-move { transition: transform var(--wp-motion-swap) ease-out; }
</style>
