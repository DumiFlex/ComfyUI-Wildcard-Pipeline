import { describe, it, expect } from "vitest";
import { syncCountToSweep } from "./context_loop";

describe("count widget follows the sweep", () => {
  it("shows the sweep's frame count and locks the widget", () => {
    const w: { value?: unknown; disabled?: boolean } = { value: 4 };
    expect(syncCountToSweep(w, 9)).toBe(true);
    expect(w).toEqual({ value: 9, disabled: true });
    expect(syncCountToSweep(w, 9)).toBe(false);
  });

  it("unlocks it and keeps the value when the sweep turns off", () => {
    const w: { value?: unknown; disabled?: boolean } = { value: 9, disabled: true };
    expect(syncCountToSweep(w, null)).toBe(true);
    expect(w).toEqual({ value: 9, disabled: false });
    expect(syncCountToSweep(w, null)).toBe(false);
  });
});
