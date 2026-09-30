import { beforeEach, describe, expect, it, vi } from "vitest";

const update = vi.fn(async (p: unknown) => p);
vi.mock("../api/client", () => ({
  api: { serverSettings: { get: vi.fn(async () => ({ max_ref_depth: 8 })), update: (p: unknown) => update(p) } },
}));

import {
  SettingsFileError,
  applySettingsFile,
  collectBrowserSettings,
  parseSettingsFile,
} from "../utils/settings-transfer";

const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}"));

beforeEach(() => {
  localStorage.clear();
  update.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

describe("settings transfer", () => {
  it("exports our preferences but not per-machine state or other extensions' keys", () => {
    localStorage.setItem("wp-theme-mode", "light");
    localStorage.setItem("wp-tweaks-v1", "{}");
    localStorage.setItem("wp.releaseCheck", "{}");
    localStorage.setItem("wp-recent-items", "[]");
    localStorage.setItem("Comfy.Other", "x");
    const out = collectBrowserSettings();
    expect(out).toEqual({ "wp-theme-mode": "light", "wp-tweaks-v1": "{}" });
  });

  it("rejects files that are not ours or come from a newer version", () => {
    expect(() => parseSettingsFile("nope")).toThrow(SettingsFileError);
    expect(() => parseSettingsFile('{"kind":"x"}')).toThrow(/not a Wildcard Pipeline/);
    expect(() => parseSettingsFile('{"kind":"wildcard-pipeline-settings","version":99}')).toThrow(/newer/);
  });

  it("applies each section and ignores keys it does not own", async () => {
    const file = parseSettingsFile(JSON.stringify({
      kind: "wildcard-pipeline-settings",
      version: 1,
      exported_at: "",
      app_version: "2.17.2",
      browser: { "wp-theme-mode": "light", "Comfy.Evil": "x", "wp-last-route": "/x" },
      canvas: { "wildcardPipeline.display.density": "compact", "Comfy.Other": true, "wildcardPipeline.display._playground": null },
      server: { max_ref_depth: 12 },
    }));
    const s = await applySettingsFile(file);
    expect(localStorage.getItem("wp-theme-mode")).toBe("light");
    expect(localStorage.getItem("Comfy.Evil")).toBeNull();
    expect(localStorage.getItem("wp-last-route")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/settings/wildcardPipeline.display.density");
    expect(update).toHaveBeenCalledWith({ max_ref_depth: 12 });
    expect(s).toEqual({ browser: 1, canvas: 1, server: true });
  });
});
