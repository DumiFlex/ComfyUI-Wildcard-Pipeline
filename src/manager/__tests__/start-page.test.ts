import { beforeEach, describe, expect, it } from "vitest";
import { rememberRoute, shouldShowWhatsNew, startPagePath } from "../router/start-page";
import type { RouteLocationNormalized } from "vue-router";

const route = (fullPath: string, name = "x") => ({ fullPath, name }) as unknown as RouteLocationNormalized;

beforeEach(() => localStorage.clear());

describe("start page", () => {
  it("defaults to the dashboard", () => {
    expect(startPagePath()).toBe("/dashboard");
  });

  it("opens the chosen page", () => {
    localStorage.setItem("wp-start-page", "test");
    expect(startPagePath()).toBe("/test");
  });

  it("reopens the last page, but never a 404 or What's new", () => {
    localStorage.setItem("wp-start-page", "last");
    expect(startPagePath()).toBe("/dashboard");
    rememberRoute(route("/wildcards/abc/edit"));
    expect(startPagePath()).toBe("/wildcards/abc/edit");
    rememberRoute(route("/nope", "not-found"));
    rememberRoute(route("/whats-new"));
    expect(startPagePath()).toBe("/wildcards/abc/edit");
  });
});

describe("What's new after an update", () => {
  it("never fires on a first run, fires once per new version", () => {
    expect(shouldShowWhatsNew("2.17.2")).toBe(false);
    expect(shouldShowWhatsNew("2.17.2")).toBe(false);
    expect(shouldShowWhatsNew("2.18.0")).toBe(true);
    expect(shouldShowWhatsNew("2.18.0")).toBe(false);
  });

  it("respects the setting but still records the version", () => {
    shouldShowWhatsNew("1.0.0");
    localStorage.setItem("wp-whats-new-after-update", "0");
    expect(shouldShowWhatsNew("1.1.0")).toBe(false);
    localStorage.setItem("wp-whats-new-after-update", "1");
    expect(shouldShowWhatsNew("1.1.0")).toBe(false);
  });
});
