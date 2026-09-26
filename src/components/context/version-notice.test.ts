import { beforeEach, describe, expect, it } from "vitest";
import { version } from "../../../package.json" with { type: "json" };
import { toasts } from "../shared/toast-store";
import { _resetVersionNoticeForTesting, checkInstalledVersion } from "./version-notice";

const res = (v?: string) =>
  new Response(null, { status: 204, headers: v ? { "X-WP-Version": v } : {} });

describe("checkInstalledVersion", () => {
  beforeEach(() => {
    toasts.value = [];
    _resetVersionNoticeForTesting();
  });

  it("does nothing when the installed version matches the loaded one", () => {
    checkInstalledVersion(res(version));
    checkInstalledVersion(res());
    expect(toasts.value).toHaveLength(0);
  });

  it("asks once for a refresh when the pack was updated", () => {
    checkInstalledVersion(res("99.0.0"));
    checkInstalledVersion(res("99.0.0"));
    expect(toasts.value).toHaveLength(1);
    const t = toasts.value[0];
    expect(t.message).toContain("updated to v99.0.0");
    expect(t.severity).toBe("warning");
    expect(t.lifeMs).toBe(0);
    expect(t.action?.label).toBe("Refresh");
  });
});
