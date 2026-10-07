import { ref } from "vue";

// Module-scoped reactive singleton: the "current editing frame" cursor, shared
// across every ContextWidget + ContextLoopWidget Vue app on the page. Each node
// mounts its own app, so provide/inject can't span them — a shared module import
// is the cross-app channel (same pattern as context/drag-store.ts). `null` = base
// (no frame). Session-only — never serialized into the workflow.
export const currentFrame = ref<number | null>(null);

export function setFrame(frame: number | null): void {
  currentFrame.value = frame;
}

/** Back to base when the cursor sits on a frame past `count` (the count went
 *  down, or a sweep now runs fewer combinations). */
export function clampFrame(count: number): void {
  if (currentFrame.value !== null && currentFrame.value >= count) currentFrame.value = null;
}
