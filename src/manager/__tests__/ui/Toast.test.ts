import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToast } from "../../composables/useToast";

describe("useToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Drain the singleton stack between tests.
    const { toasts } = useToast();
    toasts.value.splice(0, toasts.value.length);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("push appends an entry to the stack", () => {
    const { toasts, push } = useToast();
    push({ severity: "success", summary: "Saved" });
    expect(toasts.value.length).toBe(1);
    expect(toasts.value[0].summary).toBe("Saved");
  });

  it("auto-removes after life ms", () => {
    const { toasts, push } = useToast();
    push({ severity: "info", summary: "Hi", life: 1000 });
    expect(toasts.value.length).toBe(1);
    vi.advanceTimersByTime(1001);
    expect(toasts.value.length).toBe(0);
  });

  it("dismiss removes by id", () => {
    const { toasts, push, dismiss } = useToast();
    const id = push({ severity: "warn", summary: "Heads up", life: 0 });
    expect(toasts.value.length).toBe(1);
    dismiss(id);
    expect(toasts.value.length).toBe(0);
  });
});
