import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * Tracks whether the SPA is stale relative to the backend.
 *
 * Backend tags every response with X-WP-Startup-Id (process UUID).
 * The fetch wrapper in api/client.ts compares against its cached first
 * value and dispatches `wp:server-restarted` on mismatch. This store
 * listens once at AppLayout mount and flips `isStale = true`.
 *
 * Render: a banner at the top of AppLayout with a Reload button.
 *
 * Dismissal: explicit only — once stale, stays stale until the user
 * reloads the page. Auto-clearing on next match would risk hiding
 * the prompt if the user happens to receive a response from a still-
 * older startup id race.
 */
export const useStaleStore = defineStore("stale", () => {
  const isStale = ref(false);
  /** Set when the installed pack version differs from the one this page
   *  was built as — the banner then says the pack was updated. */
  const newVersion = ref<string | null>(null);

  function markStale(version?: string): void {
    isStale.value = true;
    if (version && version !== __APP_VERSION__) newVersion.value = version;
  }

  function reload(): void {
    window.location.reload();
  }

  return { isStale, newVersion, markStale, reload };
});
