import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * Detects + drives the ComfyUI Manager `/manager/reboot` endpoint.
 *
 * Detection: a single GET probe at `/manager/version` (a harmless
 * read-only endpoint Manager exposes for build identification). Used
 * instead of HEAD'ing `/manager/reboot` directly because the reboot
 * route is registered POST-only — aiohttp's response to HEAD on a
 * POST-only path is server/middleware-dependent (404 in our setup).
 * `version` is always there when Manager is, and harmless either way.
 * The resulting status is cached in `canRestart` for the rest of the
 * session.
 *
 * Restart flow:
 *   1. Set `restarting = true`.
 *   2. Fire POST /manager/reboot (the same effective request Manager's
 *      restart button uses). Connection will drop mid-flight — that's
 *      normal; the `catch` swallows it.
 *   3. Wait 2s head start, then poll `/wp/api/database/config` once a
 *      second. First 2xx response means server is back.
 *   4. window.location.reload() — fresh JS bundle + new startup id.
 *
 * If the server doesn't come back within `RESTART_TIMEOUT_MS`, surface
 * `restartError` so the UI can show a "couldn't restart" message and
 * let the user reload manually.
 */
export const useSystemStore = defineStore("system", () => {
  /** null = not yet probed; true/false = result. */
  const canRestart = ref<boolean | null>(null);
  const restarting = ref(false);
  const restartError = ref<string | null>(null);

  async function detectRestartCapability(): Promise<void> {
    if (canRestart.value !== null) return;  // probe once per session
    try {
      const resp = await fetch("/manager/version", { method: "GET" });
      canRestart.value = resp.ok;
    } catch {
      canRestart.value = false;
    }
  }

  const RESTART_HEAD_START_MS = 2000;
  const RESTART_POLL_INTERVAL_MS = 1000;
  const RESTART_TIMEOUT_MS = 60_000;

  async function waitForServerBack(): Promise<boolean> {
    await new Promise<void>((r) => setTimeout(r, RESTART_HEAD_START_MS));
    const deadline = Date.now() + RESTART_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const resp = await fetch("/wp/api/database/config", { method: "GET" });
        if (resp.ok) return true;
      } catch {
        /* server still down or in transit — keep polling */
      }
      await new Promise<void>((r) => setTimeout(r, RESTART_POLL_INTERVAL_MS));
    }
    return false;
  }

  async function restart(): Promise<void> {
    restarting.value = true;
    restartError.value = null;
    try {
      await fetch("/manager/reboot", { method: "POST" });
    } catch {
      /* expected — connection drops as server shuts down */
    }
    const back = await waitForServerBack();
    if (!back) {
      restarting.value = false;
      restartError.value = "Server did not come back within 60s. Reload manually.";
      return;
    }
    window.location.reload();
  }

  return {
    canRestart,
    restarting,
    restartError,
    detectRestartCapability,
    restart,
  };
});
