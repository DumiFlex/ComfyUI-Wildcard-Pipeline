import { ref, type Ref } from "vue";

/**
 * Tracks the most recent error message thrown by an async fetch.
 *
 * Pattern: views that already had `try { await store.fetchAll() } catch (e) { toast.push(...) }`
 * wrap their call in `run()` instead, which:
 *   - clears `error` before the call (so retry-on-success hides the banner)
 *   - rethrows the error so existing toast handling still runs
 *   - stores the message on `error` so ModuleListView can render the banner
 *
 * Keeping the toast + banner together is intentional: toast is the
 * transient announcement, banner is the persistent reminder that the
 * list is stale.
 */
export function useLoadError(): {
  error: Ref<string | null>;
  run: <T>(fn: () => Promise<T>) => Promise<T>;
  clear: () => void;
} {
  const error = ref<string | null>(null);

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    error.value = null;
    try {
      return await fn();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }

  function clear(): void {
    error.value = null;
  }

  return { error, run, clear };
}
