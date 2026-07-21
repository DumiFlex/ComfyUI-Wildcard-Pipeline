/**
 * Drives an in-place update through ComfyUI Manager's same-origin HTTP
 * API instead of reimplementing git. Flow: queue an install-to-latest
 * for our registry id, start the queue, poll status to completion, then
 * (on an explicit user click) reboot ComfyUI.
 *
 * Security note: `/manager/queue/install` and `/manager/reboot` are gated
 * by ComfyUI Manager's `security_level` (default `normal` → allowed;
 * `strong` → 403). A GET probe can't see that gate, so a 403 surfaces as
 * `errorKind: "forbidden"` from `runUpdate`; the dialog shows the same
 * guidance fallback it shows when Manager is absent.
 */
import { ref } from "vue";

import { COMFY_REGISTRY_ID } from "../config/links";

export type ManagerAvailability = "available" | "absent";
export type UpdatePhase = "idle" | "installing" | "staged" | "restarting" | "error";
export type UpdateErrorKind = "forbidden" | "failed" | null;

const STATUS_POLL_MS = 1000;
const STATUS_MAX_POLLS = 120; // ~2 min ceiling

interface QueueStatus {
  total_count?: number;
  done_count?: number;
  in_progress?: boolean;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function useComfyManagerUpdate(): {
  phase: ReturnType<typeof ref<UpdatePhase>>;
  errorKind: ReturnType<typeof ref<UpdateErrorKind>>;
  errorMessage: ReturnType<typeof ref<string | null>>;
  probe: () => Promise<ManagerAvailability>;
  runUpdate: () => Promise<void>;
  reboot: () => Promise<void>;
  managerUiUrl: string;
} {
  const phase = ref<UpdatePhase>("idle");
  const errorKind = ref<UpdateErrorKind>(null);
  const errorMessage = ref<string | null>(null);

  async function probe(): Promise<ManagerAvailability> {
    try {
      const res = await fetch("/manager/queue/status", { method: "GET" });
      return res.ok ? "available" : "absent";
    } catch {
      return "absent";
    }
  }

  function fail(kind: Exclude<UpdateErrorKind, null>, message: string): void {
    phase.value = "error";
    errorKind.value = kind;
    errorMessage.value = message;
  }

  async function pollUntilDone(): Promise<boolean> {
    for (let i = 0; i < STATUS_MAX_POLLS; i++) {
      try {
        const res = await fetch("/manager/queue/status", { method: "GET" });
        if (res.ok) {
          const s = (await res.json()) as QueueStatus;
          const total = s.total_count ?? 0;
          const done = s.done_count ?? 0;
          const running = s.in_progress ?? false;
          if (!running && (total === 0 || done >= total)) return true;
        }
      } catch {
        /* transient — keep polling until the ceiling */
      }
      await delay(STATUS_POLL_MS);
    }
    return false;
  }

  async function runUpdate(): Promise<void> {
    phase.value = "installing";
    errorKind.value = null;
    errorMessage.value = null;
    try {
      const installRes = await fetch("/manager/queue/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: COMFY_REGISTRY_ID,
          version: __APP_VERSION__,
          selected_version: "latest",
          channel: "default",
          mode: "cache",
        }),
      });
      if (!installRes.ok) {
        const text = await installRes.text().catch(() => "");
        if (installRes.status === 403) {
          fail("forbidden", text || "ComfyUI Manager blocked the update (security level).");
        } else {
          fail("failed", text || `Install request failed (${installRes.status}).`);
        }
        return;
      }
      const startRes = await fetch("/manager/queue/start", { method: "POST" });
      if (!startRes.ok) {
        fail("failed", `Could not start the update queue (${startRes.status}).`);
        return;
      }
      const done = await pollUntilDone();
      if (!done) {
        fail("failed", "The update did not finish in time. Check ComfyUI's console.");
        return;
      }
      phase.value = "staged";
    } catch (e) {
      fail("failed", e instanceof Error ? e.message : "Unexpected update error.");
    }
  }

  async function reboot(): Promise<void> {
    phase.value = "restarting";
    try {
      await fetch("/manager/reboot", { method: "POST" });
    } catch {
      // The server drops the socket while restarting — expected. Stay in
      // `restarting`; the dialog tells the user to reopen ComfyUI.
    }
  }

  const managerUiUrl = "/manager";

  return { phase, errorKind, errorMessage, probe, runUpdate, reboot, managerUiUrl };
}
