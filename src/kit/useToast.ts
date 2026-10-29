import { ref } from "vue";

export type ToastSeverity = "info" | "success" | "warn" | "error";

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface ToastEntry {
  id: string;
  severity: ToastSeverity;
  summary: string;
  detail?: string;
  life?: number;
  /** Optional action button rendered inline with the toast. Click runs the handler
   *  and dismisses the toast. Reserved for Undo flows (Phase 3 bulk actions). */
  action?: ToastAction;
}

const DEFAULT_LIFE = 2400;

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
