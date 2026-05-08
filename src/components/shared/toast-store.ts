import { ref } from "vue";

export type ToastSeverity = "info" | "success" | "warning" | "error";

export interface Toast {
  id: number;
  message: string;
  severity: ToastSeverity;
  /** Optional inline action — e.g. "Undo" with a callback. */
  action?: { label: string; onSelect: () => void };
  /** Auto-dismiss after this many ms. 0 = sticky (must be dismissed manually). */
  lifeMs: number;
  createdAt: number;
  /**
   * Optional grouping key — at most one toast with a given singletonKey
   * lives in the stack at a time. Pushing a second toast with the same key
   * dismisses the first. Used for rapidly-repeating notifications like
   * a11y toggle confirmations where stacking creates spam.
   */
  singletonKey?: string;
}

let nextId = 1;
export const toasts = ref<Toast[]>([]);

interface PushToastOptions {
  severity?: ToastSeverity;
  action?: Toast["action"];
  lifeMs?: number;
  singletonKey?: string;
}

export function pushToast(message: string, options: PushToastOptions = {}): number {
  // Honor singletonKey: drop any existing toast with the same key before
  // appending. Resets lifeMs/timer (the new push wins).
  if (options.singletonKey) {
    toasts.value = toasts.value.filter((t) => t.singletonKey !== options.singletonKey);
  }
  const id = nextId++;
  const t: Toast = {
    id,
    message,
    severity: options.severity ?? "info",
    action: options.action,
    lifeMs: options.lifeMs ?? 5000,
    createdAt: Date.now(),
    singletonKey: options.singletonKey,
  };
  toasts.value = [...toasts.value, t];
  if (t.lifeMs > 0) {
    window.setTimeout(() => dismissToast(id), t.lifeMs);
  }
  return id;
}

export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}
