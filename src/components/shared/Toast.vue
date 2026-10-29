<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { toasts, dismissToast, type Toast } from "./toast-store";
import ToastCard from "../../kit/ToastCard.vue";

/** The canvas store says `warning`; the shared card says `warn`. */
function toneOf(s: Toast["severity"]): "info" | "success" | "warn" | "error" {
  return s === "warning" ? "warn" : s;
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
      appear
      class="wp-toast-stack"
      :style="{ top: `${stackTop}px`, right: `${stackRight}px` }"
      aria-live="polite"
    >
      <ToastCard
        v-for="t in toasts"
        :key="t.id"
        :tone="toneOf(t.severity)"
        :summary="t.message"
        :action-label="t.action?.label"
        @action="pickAction(t)"
        @dismiss="dismissToast(t.id)"
      />
    </TransitionGroup>
  </Teleport>
</template>

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
