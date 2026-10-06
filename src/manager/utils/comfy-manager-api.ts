/**
 * ComfyUI ships two incompatible Managers, and an install can have either:
 *
 *   - "v3": the legacy ComfyUI-Manager custom node (`custom_nodes/comfyui-manager`).
 *     Routes live under `/manager/*`; installs go to `/manager/queue/install`.
 *   - "v4": the Manager built into ComfyUI (`comfyui_manager` pip package,
 *     `--enable-manager`). Every route moved under `/v2/manager/*` and installs
 *     are queued as tasks on `/v2/manager/queue/task`.
 *   - "v4-legacy": the built-in Manager started with `--enable-manager-legacy-ui`.
 *     Same `/v2` prefix, but installs go through `/v2/manager/queue/batch`.
 *
 * When v4 is active it disables the v3 custom node, so at most one answers.
 */

export type ManagerFlavor = "v3" | "v4" | "v4-legacy";

export interface ManagerRoutes {
  status: string;
  start: string;
  reboot: string;
  version: string;
}

export const MANAGER_ROUTES: Record<ManagerFlavor, ManagerRoutes> = {
  v3: {
    status: "/manager/queue/status",
    start: "/manager/queue/start",
    reboot: "/manager/reboot",
    version: "/manager/version",
  },
  v4: {
    status: "/v2/manager/queue/status",
    start: "/v2/manager/queue/start",
    reboot: "/v2/manager/reboot",
    version: "/v2/manager/version",
  },
  "v4-legacy": {
    status: "/v2/manager/queue/status",
    start: "/v2/manager/queue/start",
    reboot: "/v2/manager/reboot",
    version: "/v2/manager/version",
  },
};

async function isOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Which Manager answers on this server, or null when none does. */
export async function detectManager(): Promise<ManagerFlavor | null> {
  if (await isOk(MANAGER_ROUTES.v3.status)) return "v3";
  if (!(await isOk(MANAGER_ROUTES.v4.status))) return null;
  try {
    const res = await fetch("/v2/manager/is_legacy_manager_ui", { method: "GET" });
    if (res.ok) {
      const body = (await res.json()) as { is_legacy_manager_ui?: boolean };
      if (body.is_legacy_manager_ui === true) return "v4-legacy";
    }
  } catch {
    /* fall through to the default v4 UI */
  }
  return "v4";
}
