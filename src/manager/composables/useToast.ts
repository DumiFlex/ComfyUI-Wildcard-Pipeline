import { ref } from "vue";

export type ToastSeverity = "info" | "success" | "warn" | "error";

export interface ToastEntry {
  id: string;
  severity: ToastSeverity;
  summary: string;
  detail?: string;
  life?: number;
}

const DEFAULT_LIFE = 2400;

// Module-level singleton — every call to useToast() shares the same stack so
// any view can push and the single <ToastHost /> mounted in App.vue renders.
const toasts = ref<ToastEntry[]>([]);

let nextId = 0;
function makeId() {
  nextId += 1;
  return `t${Date.now().toString(36)}_${nextId}`;
}

function dismiss(id: string) {
  const i = toasts.value.findIndex((t) => t.id === id);
  if (i >= 0) toasts.value.splice(i, 1);
}

function push(entry: Omit<ToastEntry, "id">): string {
  const id = makeId();
  const life = entry.life ?? DEFAULT_LIFE;
  toasts.value.push({ ...entry, id });
  if (life > 0) {
    setTimeout(() => dismiss(id), life);
  }
  return id;
}

export function useToast() {
  return { toasts, push, dismiss };
}
