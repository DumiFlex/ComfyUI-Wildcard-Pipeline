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
