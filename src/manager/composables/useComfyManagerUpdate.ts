/**
 * Drives an in-place update through ComfyUI Manager's same-origin HTTP
 * API instead of reimplementing git. Flow: queue an install-to-latest
 * for our registry id, start the queue, poll status to completion, then
 * (on an explicit user click) reboot ComfyUI, wait for it to come back,
 * confirm the new version is the one running and reload the page.
 *
 * Works with both Managers ComfyUI can ship (see `comfy-manager-api.ts`):
 * the legacy custom node (`/manager/*`) and the built-in one (`/v2/manager/*`).
 *
 * Security note: `/manager/queue/install` and `/manager/reboot` are gated
 * by ComfyUI Manager's `security_level` (default `normal` → allowed;
 * `strong` → 403). A GET probe can't see that gate, so a 403 surfaces as
 * `errorKind: "forbidden"` from `runUpdate`; the dialog shows the same
 * guidance fallback it shows when Manager is absent.
 */
import { ref } from "vue";

import { COMFY_REGISTRY_ID } from "../config/links";
import { detectManager, MANAGER_ROUTES, type ManagerFlavor } from "../utils/comfy-manager-api";

export type ManagerAvailability = "available" | "absent";
export type UpdatePhase = "idle" | "installing" | "staged" | "restarting" | "error";
export type UpdateErrorKind = "forbidden" | "failed" | "not_applied" | null;

const STATUS_POLL_MS = 1000;
const STATUS_MAX_POLLS = 120; // ~2 min ceiling
const RESTART_HEAD_START_MS = 2000;
const RESTART_POLL_MS = 1000;
const RESTART_MAX_POLLS = 90; // ~1.5 min ceiling

interface QueueStatus {
  total_count?: number;
  done_count?: number;
  is_processing?: boolean;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Parse a `1.2.3` version into numeric segments (prerelease ignored). */
function parseSemver(v: string): number[] {
  return v.split("-")[0].split(".").map((n) => Number.parseInt(n, 10) || 0);
}

/** True when `target` is a strictly newer version than `current`. Used as a
 *  downgrade guard so a mis-resolved target can never install an older
 *  build over a newer one. */
function isStrictlyNewer(target: string, current: string): boolean {
  const t = parseSemver(target);
  const c = parseSemver(current);
  for (let i = 0; i < 3; i++) {
    const diff = (t[i] ?? 0) - (c[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/** Body for the Manager's install call. Pins the EXACT target version, not
 *  "latest" (we already know it), and `mode: "remote"` resolves it against
 *  the live registry catalog instead of the Manager's stale cache. */
function installParams(targetVersion: string) {
  return {
    id: COMFY_REGISTRY_ID,
    version: __APP_VERSION__,
    selected_version: targetVersion,
    channel: "default",
    mode: "remote",
  };
}

function newUiId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `wp-update-${Date.now()}`;
}

/** Queue the install on whichever Manager is present. Returns the failed
 *  response, or null once the install is queued. */
async function queueInstall(flavor: ManagerFlavor, targetVersion: string): Promise<Response | null> {
  const headers = { "Content-Type": "application/json" };
  const params = installParams(targetVersion);
  if (flavor === "v3") {
    const res = await fetch("/manager/queue/install", { method: "POST", headers, body: JSON.stringify(params) });
    return res.ok ? null : res;
  }
  if (flavor === "v4-legacy") {
    // The batch call queues AND starts; per-item refusals come back in `failed`.
    const res = await fetch("/v2/manager/queue/batch", {
      method: "POST",
      headers,
      body: JSON.stringify({ install: [{ ...params, ui_id: newUiId() }] }),
    });
    if (!res.ok) return res;
    const body = (await res.json().catch(() => ({}))) as { failed?: string[] };
    if (body.failed?.includes(COMFY_REGISTRY_ID)) {
      return new Response("ComfyUI Manager refused the install. Check the ComfyUI console.", { status: 403 });
    }
    return null;
  }
  const res = await fetch("/v2/manager/queue/task", {
    method: "POST",
    headers,
    body: JSON.stringify({ ui_id: newUiId(), client_id: "wildcard-pipeline", kind: "install", params }),
  });
  return res.ok ? null : res;
}

interface ServerIdentity {
  /** Changes on every ComfyUI start (`X-WP-Startup-Id`). */
  startupId: string;
  /** The pack version the process loaded (`X-WP-Version`). */
  version: string;
}

/** Who is answering `/wp` right now, or null while the server is down. */
async function serverIdentity(): Promise<ServerIdentity | null> {
  try {
    const res = await fetch("/wp/api/database/config", { method: "GET", cache: "no-store" });
    if (!res.ok) return null;
    return {
      startupId: res.headers.get("X-WP-Startup-Id") ?? "",
      version: res.headers.get("X-WP-Version") ?? "",
    };
  } catch {
    return null;
  }
}

export function useComfyManagerUpdate(): {
  phase: ReturnType<typeof ref<UpdatePhase>>;
  errorKind: ReturnType<typeof ref<UpdateErrorKind>>;
  errorMessage: ReturnType<typeof ref<string | null>>;
  probe: () => Promise<ManagerAvailability>;
  runUpdate: (targetVersion: string) => Promise<void>;
  reboot: () => Promise<void>;
  managerUiUrl: string;
} {
  const phase = ref<UpdatePhase>("idle");
  const errorKind = ref<UpdateErrorKind>(null);
  const errorMessage = ref<string | null>(null);
  let flavor: ManagerFlavor | null = null;
  let target: string | null = null;

  async function probe(): Promise<ManagerAvailability> {
    flavor = await detectManager();
    return flavor ? "available" : "absent";
  }

  function fail(kind: Exclude<UpdateErrorKind, null>, message: string): void {
    phase.value = "error";
    errorKind.value = kind;
    errorMessage.value = message;
  }

  async function pollUntilDone(statusUrl: string): Promise<boolean> {
    for (let i = 0; i < STATUS_MAX_POLLS; i++) {
      try {
        const res = await fetch(statusUrl, { method: "GET" });
        if (res.ok) {
          const s = (await res.json()) as QueueStatus;
          const total = s.total_count ?? 0;
          const done = s.done_count ?? 0;
          const running = s.is_processing ?? false;
          if (!running && (total === 0 || done >= total)) return true;
        }
      } catch {
        /* transient — keep polling until the ceiling */
      }
      await delay(STATUS_POLL_MS);
    }
    return false;
  }

  async function runUpdate(targetVersion: string): Promise<void> {
    phase.value = "installing";
    errorKind.value = null;
    errorMessage.value = null;
    // Downgrade guard. `targetVersion` is the exact release the update check
    // found (e.g. "2.10.1"). Never proceed unless it is strictly newer than
    // what's installed. This is the fix for the 2.10.0 downgrade bug, where
    // `selected_version:"latest"` + `mode:"cache"` let ComfyUI Manager
    // resolve "latest" against its STALE cached catalog and install an older
    // version over a newer one.
    if (!targetVersion || !isStrictlyNewer(targetVersion, __APP_VERSION__)) {
      fail("failed", `Refusing to install "${targetVersion || "unknown"}" — it is not newer than the installed ${__APP_VERSION__}.`);
      return;
    }
    try {
      flavor ??= await detectManager();
      if (!flavor) {
        fail("failed", "ComfyUI Manager isn't available.");
        return;
      }
      const routes = MANAGER_ROUTES[flavor];
      const refused = await queueInstall(flavor, targetVersion);
      if (refused) {
        const text = await refused.text().catch(() => "");
        if (refused.status === 403) {
          fail("forbidden", text || "ComfyUI Manager blocked the update (security level).");
        } else {
          fail("failed", text || `Install request failed (${refused.status}).`);
        }
        return;
      }
      if (flavor !== "v4-legacy") {
        const startRes = await fetch(routes.start, { method: "POST" });
        if (!startRes.ok) {
          fail("failed", `Could not start the update queue (${startRes.status}).`);
          return;
        }
      }
      const done = await pollUntilDone(routes.status);
      if (!done) {
        fail("failed", "The update did not finish in time. Check ComfyUI's console.");
        return;
      }
      target = targetVersion;
      phase.value = "staged";
    } catch (e) {
      fail("failed", e instanceof Error ? e.message : "Unexpected update error.");
    }
  }

  /** Restart ComfyUI, wait for the NEW process to answer and check which
   *  version it loaded. On the target version the page reloads so it runs
   *  the new frontend; otherwise the dialog says the update didn't apply
   *  instead of leaving a page that looks updated but isn't. */
  async function reboot(): Promise<void> {
    phase.value = "restarting";
    const routes = MANAGER_ROUTES[flavor ?? "v3"];
    const before = await serverIdentity();
    try {
      await fetch(routes.reboot, { method: "POST" });
    } catch {
      // The server drops the socket while restarting — expected.
    }
    await delay(RESTART_HEAD_START_MS);
    for (let i = 0; i < RESTART_MAX_POLLS; i++) {
      const now = await serverIdentity();
      // Same startup id = the old process hasn't gone down yet.
      const restarted = now !== null && (!before?.startupId || now.startupId !== before.startupId);
      if (restarted) {
        if (!target || !now.version || now.version === target) {
          window.location.reload();
          return;
        }
        fail(
          "not_applied",
          `ComfyUI restarted, but Wildcard Pipeline is still v${now.version}. `
            + "The Manager may have refused the install; check the ComfyUI console.",
        );
        return;
      }
      await delay(RESTART_POLL_MS);
    }
    fail("failed", "ComfyUI didn't come back after the restart. Reload the page once it's running.");
  }

  const managerUiUrl = "/manager";

  return { phase, errorKind, errorMessage, probe, runUpdate, reboot, managerUiUrl };
}
