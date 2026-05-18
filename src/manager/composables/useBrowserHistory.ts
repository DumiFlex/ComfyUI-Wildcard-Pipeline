import { ref } from "vue";
import { useRouter } from "vue-router";

/** Singleton ref shared across all consumers. Module-level so multiple
 *  consumers (AppTopbar, future breadcrumb back button, etc.) see the
 *  same value without duplicate router.afterEach subscriptions. */
const canGoBack = ref(typeof window !== "undefined" && window.history.length > 1);
let installed = false;

/**
 * Reactive `canGoBack` — updates whenever the SPA navigates, instead of
 * being frozen at component-mount time. One router.afterEach hook
 * installed on first call across the whole app.
 */
export function useBrowserHistory() {
  const router = useRouter();
  if (!installed) {
    installed = true;
    router.afterEach(() => {
      canGoBack.value = typeof window !== "undefined" && window.history.length > 1;
    });
  }
  return { canGoBack };
}
