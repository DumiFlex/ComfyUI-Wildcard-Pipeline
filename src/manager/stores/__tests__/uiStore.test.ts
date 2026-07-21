import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useUiStore } from "../uiStore";

describe("uiStore checkOnLaunch", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("defaults to true when unset", () => {
    const ui = useUiStore();
    expect(ui.checkOnLaunch).toBe(true);
  });

  it("persists and reloads from localStorage", () => {
    const ui = useUiStore();
    ui.setCheckOnLaunch(false);
    expect(ui.checkOnLaunch).toBe(false);
    expect(localStorage.getItem("wp-update-check-on-launch")).toBe("false");
    // Fresh store instance reads the stored value.
    setActivePinia(createPinia());
    const ui2 = useUiStore();
    expect(ui2.checkOnLaunch).toBe(false);
  });
});
