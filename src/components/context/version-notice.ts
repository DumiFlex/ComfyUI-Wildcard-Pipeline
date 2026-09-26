import { version as loadedVersion } from "../../../package.json" with { type: "json" };
import { pushToast } from "../shared/toast-store";

/**
 * The canvas keeps running the extension JS it loaded, even after the pack
 * is updated and ComfyUI restarts. Every `/wp/*` response carries the pack
 * version installed on disk (`X-WP-Version`); when it differs from the
 * version this bundle was built as, ask once for a page refresh.
 */
let notified = false;

export function checkInstalledVersion(res: Response): void {
  if (notified) return;
  const installed = res.headers.get("X-WP-Version");
  if (!installed || installed === loadedVersion) return;
  notified = true;
  pushToast(
    `Wildcard Pipeline was updated to v${installed}. Refresh the page to load it.`,
    {
      severity: "warning",
      lifeMs: 0,
      singletonKey: "wp-version-updated",
      action: { label: "Refresh", onSelect: () => window.location.reload() },
    },
  );
}

/** Test-only: allow the notice to fire again. */
export function _resetVersionNoticeForTesting(): void {
  notified = false;
}
