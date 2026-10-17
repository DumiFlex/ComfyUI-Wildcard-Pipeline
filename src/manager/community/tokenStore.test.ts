import { beforeEach, describe, expect, it } from "vitest";
import { readLegacyTokens, wipeLegacyTokens } from "./tokenStore";

beforeEach(() => localStorage.clear());

describe("legacy community tokens", () => {
  it("reads the old embed's pair and wipes it", () => {
    localStorage.setItem("wpc.embed.access", "a");
    localStorage.setItem("wpc.embed.refresh", "r");
    localStorage.setItem("wpc.embed.expires_at", "123");
    expect(readLegacyTokens()).toEqual({ access: "a", refresh: "r", expiresAt: 123 });
    wipeLegacyTokens();
    expect(readLegacyTokens()).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it("returns null for a partial or broken pair", () => {
    localStorage.setItem("wpc.embed.access", "a");
    expect(readLegacyTokens()).toBeNull();
    localStorage.setItem("wpc.embed.refresh", "r");
    localStorage.setItem("wpc.embed.expires_at", "soon");
    expect(readLegacyTokens()).toBeNull();
  });
});
