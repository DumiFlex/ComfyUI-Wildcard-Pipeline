import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * Detects + drives the ComfyUI Manager `/manager/reboot` endpoint.
 *
 * Detection: a single HEAD probe at app mount. Manager's `/manager/reboot`
 * accepts GET; we use HEAD (Manager's aiohttp route accepts it implicitly
 * when GET is registered) so the probe itself never triggers a restart.
 * The resulting status is cached in `canRestart` for the rest of the session.
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
      const resp = await fetch("/manager/reboot", { method: "HEAD" });
      // 2xx, 3xx, or 405 (method allowed on path but not for HEAD) — Manager present.
      canRestart.value = resp.status < 400 || resp.status === 405;
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
