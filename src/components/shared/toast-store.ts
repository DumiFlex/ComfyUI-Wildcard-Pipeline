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

// Setting bridges — provider functions that the settings module
// registers at boot. Kept here as setter-injected hooks (rather than
// importing from settings.ts) to avoid the circular import that would
// otherwise form (settings.ts already imports pushToast for its own
// onChange feedback). Returning sensible defaults when unregistered
// lets the toast store work standalone in tests.
let lifetimeProvider: () => number = () => 5000;
let suppressInfoFilter: () => boolean = () => false;

/**
 * Register a function the toast store calls to get the default
 * lifetime in ms when a caller doesn't pass an explicit `lifeMs`.
 * Settings.ts wires this to the user's `wp.toastLifetime` choice
 * (3s / 5s / 10s / sticky=0). */
export function setLifetimeProvider(fn: () => number): void {
  lifetimeProvider = fn;
}

/**
 * Register a function the toast store calls to decide whether to
 * suppress info-severity toasts. When it returns true, info toasts
 * are dropped silently — warnings + errors always render regardless. */
export function setSuppressInfoFilter(fn: () => boolean): void {
  suppressInfoFilter = fn;
}

interface PushToastOptions {
  severity?: ToastSeverity;
  action?: Toast["action"];
  lifeMs?: number;
  singletonKey?: string;
}

export function pushToast(message: string, options: PushToastOptions = {}): number {
  const severity = options.severity ?? "info";

  // Suppress info-severity toasts when the user has opted into the
  // quiet-mode filter. Warnings + errors always show — those are the
  // toasts users actually NEED to see.
  if (severity === "info" && suppressInfoFilter()) {
    return 0;
  }

  // Honor singletonKey: drop any existing toast with the same key before
  // appending. Resets lifeMs/timer (the new push wins).
  if (options.singletonKey) {
    toasts.value = toasts.value.filter((t) => t.singletonKey !== options.singletonKey);
  }
  const id = nextId++;
  // Default lifeMs comes from the user's setting via the registered
  // provider; explicit options.lifeMs always wins. 0 → sticky toast.
  const lifeMs = options.lifeMs ?? lifetimeProvider();
  const t: Toast = {
    id,
    message,
    severity,
    action: options.action,
    lifeMs,
    createdAt: Date.now(),
    singletonKey: options.singletonKey,
  };
  toasts.value = [...toasts.value, t];
  if (t.lifeMs > 0) {
    window.setTimeout(() => dismissToast(id), t.lifeMs);
  }
  return id;
}

/** Test-only: reset the registered providers so each test starts clean. */
export function _resetToastProvidersForTesting(): void {
  lifetimeProvider = () => 5000;
  suppressInfoFilter = () => false;
}

export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}
